#!/usr/bin/env python3
"""离线开发数据：从 Overture Maps（AWS S3 公共桶）提取 OSM 来源的建筑与道路，写成服务端的原始 Overpass 缓存。

仅用于无法访问 Overpass 的受限网络（如云端开发容器）做浏览器视觉验证；线上服务仍直接使用 Overpass。
Overture 的 buildings / transportation 主题保留了 OSM 要素 id（sources[].record_id = "w123@4"），
本脚本只保留 dataset == 'OpenStreetMap' 的要素，把字段映射回 OSM 标签，交给 server/osm.mjs 的
processBuildings / processFeatures 按现有规则清洗、估高。

输出：<cache>/osm/raw-b14/<x>_<y>.json.gz 与 raw-f14（与 server.mjs 的 rawOverpass 同格式）。
已存在的原始缓存会被覆盖（相邻范围请合并成一个 bbox 一次生成，分次运行会覆盖交界瓦片），请勿对生产缓存目录运行。

依赖：pip install pyarrow shapely
用法：python3 tools/overture-osm-cache.py --bbox 113.55,34.70,113.80,34.82 [--cache cache] [--release 2026-09-23.0]
"""
import argparse
import gzip
import io
import json
import math
import os
import re
import ssl
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import pyarrow.compute as pc
import pyarrow.parquet as pq
from shapely import wkb

BASE = 'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/'
Z = 14
HIGHWAYS = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'pedestrian'}


def opener():
    handlers = []
    proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
    if proxy:
        handlers.append(urllib.request.ProxyHandler({'https': proxy}))
    ca = os.environ.get('SSL_CERT_FILE') or os.environ.get('REQUESTS_CA_BUNDLE')
    handlers.append(urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=ca) if ca else ssl.create_default_context()))
    return urllib.request.build_opener(*handlers)


OP = opener()


class RangeFile(io.RawIOBase):
    """只按需读取 Parquet 的页脚与命中的行组（HTTP Range），避免下载整个 500 MB 文件。"""

    def __init__(self, key, size):
        self.key, self.size, self.pos = key, size, 0

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def read(self, n=-1):
        if n < 0:
            n = self.size - self.pos
        if n == 0 or self.pos >= self.size:
            return b''
        end = min(self.size, self.pos + n) - 1
        for attempt in range(4):
            try:
                req = urllib.request.Request(BASE + self.key, headers={'Range': f'bytes={self.pos}-{end}'})
                data = OP.open(req, timeout=120).read()
                break
            except Exception:
                if attempt == 3:
                    raise
        self.pos += len(data)
        return data

    def readinto(self, b):
        d = self.read(len(b))
        b[: len(d)] = d
        return len(d)


def list_keys(prefix):
    out, token = [], None
    while True:
        url = BASE + '?list-type=2&prefix=' + urllib.parse.quote(prefix) + ('&continuation-token=' + urllib.parse.quote(token) if token else '')
        x = OP.open(url, timeout=60).read().decode()
        out += list(zip(re.findall('<Key>([^<]*)', x), map(int, re.findall('<Size>([^<]*)', x))))
        m = re.search('<NextContinuationToken>([^<]*)', x)
        if not m:
            return [k for k in out if k[0].endswith('.parquet')]
        token = m.group(1)


def read_theme(release, theme, bbox):
    W, S, E, N = bbox

    def hits(ks):
        key, size = ks
        md = pq.ParquetFile(RangeFile(key, size)).metadata
        idx = {md.schema.column(i).path: i for i in range(md.num_columns)}
        groups = []
        for g in range(md.num_row_groups):
            st = lambda n: md.row_group(g).column(idx[n]).statistics
            if st('bbox.xmin').min <= E and st('bbox.xmax').max >= W and st('bbox.ymin').min <= N and st('bbox.ymax').max >= S:
                groups.append(g)
        return key, size, groups

    keys = list_keys(f'release/{release}/{theme}/')
    with ThreadPoolExecutor(24) as ex:
        found = [h for h in ex.map(hits, keys) if h[2]]
    rows = []
    for key, size, groups in found:
        t = pq.ParquetFile(RangeFile(key, size)).read_row_groups(groups)
        b = t.column('bbox')
        inside = pc.and_(
            pc.and_(pc.less_equal(pc.struct_field(b, 'xmin'), E), pc.greater_equal(pc.struct_field(b, 'xmax'), W)),
            pc.and_(pc.less_equal(pc.struct_field(b, 'ymin'), N), pc.greater_equal(pc.struct_field(b, 'ymax'), S)),
        )
        rows += t.filter(inside).to_pylist()
    print(f'{theme}: {len(rows)} rows from {len(found)} file(s)', file=sys.stderr)
    return rows


def tile_of(lon, lat):
    n = 2**Z
    la = math.radians(lat)
    return int((lon + 180) / 360 * n), int((1 - math.log(math.tan(la) + 1 / math.cos(la)) / math.pi) / 2 * n)


def osm_ref(row):
    src = next((s for s in row.get('sources') or [] if s['dataset'] == 'OpenStreetMap'), None)
    if not src:
        return None, None
    rid = src['record_id'].split('@')[0]
    kind = {'w': 'way', 'r': 'relation'}.get(rid[:1])
    return (kind, int(rid[1:])) if kind else (None, None)


def geom(ring):
    return [{'lat': round(y, 7), 'lon': round(x, 7)} for x, y in ring.coords]


def supplement_id(row):
    """影像识别轮廓没有 OSM id：由 Overture GERS id 派生稳定的整数 id（5e15 起，避开 OSM id 空间，< 2^53）。"""
    return 5 * 10**15 + int(row['id'].replace('-', '')[:13], 16) % (4 * 10**15)


def building_element(row, part, supplement=False):
    kind, oid = osm_ref(row)
    if supplement:
        # 只收录 OSM 没有的轮廓；OSM 要素仍由 Overpass 提供
        if kind:
            return None
        kind, oid = 'way', supplement_id(row)
    if not kind:
        return None
    t = {('building:part' if part else 'building'): row.get('class') or 'yes'}
    for src, dst in (('num_floors', 'building:levels'), ('height', 'height'), ('min_height', 'min_height'), ('min_floor', 'building:min_level'), ('roof_shape', 'roof:shape'), ('roof_height', 'roof:height'), ('facade_color', 'building:colour'), ('roof_color', 'roof:colour')):
        if row.get(src):
            t[dst] = str(row[src])
    if row.get('is_underground'):
        t['location'] = 'underground'
    if row.get('level') is not None and row['level'] < 0:
        t['layer'] = str(row['level'])
    if (row.get('names') or {}).get('primary'):
        t['name'] = row['names']['primary']
    g = wkb.loads(row['geometry'])
    polys = list(g.geoms) if g.geom_type == 'MultiPolygon' else [g] if g.geom_type == 'Polygon' else []
    if not polys:
        return None
    if kind == 'way' and len(polys) == 1 and not polys[0].interiors:
        el = {'type': 'way', 'id': oid, 'tags': t, 'geometry': geom(polys[0].exterior)}
    else:
        members = []
        for p in polys:
            members.append({'type': 'way', 'ref': 0, 'role': 'outer', 'geometry': geom(p.exterior)})
            members += [{'type': 'way', 'ref': 0, 'role': 'inner', 'geometry': geom(i)} for i in p.interiors]
        el = {'type': 'relation', 'id': oid, 'tags': t, 'members': members}
    c = g.centroid
    return tile_of(c.x, c.y), el


def road_elements(row):
    if row.get('subtype') != 'road' or row.get('class') not in HIGHWAYS:
        return []
    kind, oid = osm_ref(row)
    if kind != 'way':
        return []
    t = {'highway': row['class'] + ('_link' if row.get('subclass') == 'link' else '')}
    flags = set()
    for f in row.get('road_flags') or []:
        if not f.get('between'):
            flags |= set(f['values'])
    if 'is_bridge' in flags:
        t['bridge'] = 'yes'
    if 'is_tunnel' in flags:
        t['tunnel'] = 'yes'
    if (row.get('names') or {}).get('primary'):
        t['name'] = row['names']['primary']
    g = wkb.loads(row['geometry'])
    out = []
    for line in list(g.geoms) if g.geom_type == 'MultiLineString' else [g]:
        el = {'type': 'way', 'id': oid, 'tags': t, 'geometry': geom(line)}
        # Overpass 返回与瓦片范围相交的所有 way：写入每个有顶点落入的瓦片
        out += [(k, el) for k in {tile_of(x, y) for x, y in line.coords}]
    return out


def write(cache, kind, tiles, release, bbox):
    # 范围内没有要素的瓦片也写空结果，离线时不再回落到 Overpass
    (x0, y1), (x1, y0) = tile_of(bbox[0], bbox[1]), tile_of(bbox[2], bbox[3])
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            tiles.setdefault((x, y), [])
    d = os.path.join(cache, 'osm', f'raw-{kind}{Z}')
    os.makedirs(d, exist_ok=True)
    for (x, y), els in tiles.items():
        with gzip.open(os.path.join(d, f'{x}_{y}.json.gz'), 'wt') as fh:
            json.dump({'version': 0.6, 'generator': f'overture {release} (OpenStreetMap subset)', 'elements': els}, fh)
    print(f'raw-{kind}{Z}: {len(tiles)} tiles, {sum(map(len, tiles.values()))} elements', file=sys.stderr)


def write_supplement(out, release, bbox):
    tiles = {}
    for row in read_theme(release, 'theme=buildings/type=building', bbox):
        r = building_element(row, False, supplement=True)
        # 只收录质心在 bbox 内的，分多次生成相邻范围时不会产生残缺瓦片
        if r:
            c = wkb.loads(row['geometry']).centroid
            if bbox[0] <= c.x <= bbox[2] and bbox[1] <= c.y <= bbox[3]:
                tiles.setdefault(r[0], []).append(r[1])
    d = os.path.join(out, str(Z))
    os.makedirs(d, exist_ok=True)
    total = 0
    for (x, y), els in tiles.items():
        f = os.path.join(d, f'{x}_{y}.json.gz')
        old = json.load(gzip.open(f))['elements'] if os.path.exists(f) else []
        merged = {e['id']: e for e in old}
        for e in els:
            e['tags']['source'] = 'imagery-footprint'
            # 精度 1e-6°（约 0.1 m）足够，控制仓库体积
            for p in e.get('geometry') or []:
                p['lat'], p['lon'] = round(p['lat'], 6), round(p['lon'], 6)
            merged[e['id']] = e
        with gzip.open(f, 'wt', compresslevel=9) as fh:
            json.dump({'generator': f'overture {release} (non-OSM building footprints)', 'license': 'ODbL-1.0 (Overture Maps Foundation buildings)', 'elements': list(merged.values())}, fh, separators=(',', ':'))
        total += len(els)
    print(f'supplement: {len(tiles)} tiles, {total} buildings', file=sys.stderr)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--bbox', required=True, help='west,south,east,north')
    ap.add_argument('--cache', default=os.path.join(os.path.dirname(__file__), '..', 'cache'))
    ap.add_argument('--release', default='2026-09-23.0')
    ap.add_argument('--no-roads', action='store_true')
    ap.add_argument('--supplement', metavar='DIR', help='改为输出补充建筑（仅 OSM 没有的轮廓）到 DIR/14/，与已有文件按 id 合并；服务端会与 Overpass 结果合并')
    a = ap.parse_args()
    bbox = tuple(map(float, a.bbox.split(',')))
    if a.supplement:
        write_supplement(a.supplement, a.release, bbox)
        return
    tiles = {}
    for theme, part in (('theme=buildings/type=building', False), ('theme=buildings/type=building_part', True)):
        for row in read_theme(a.release, theme, bbox):
            r = building_element(row, part)
            if r:
                tiles.setdefault(r[0], []).append(r[1])
    write(a.cache, 'b', tiles, a.release, bbox)
    if not a.no_roads:
        tiles = {}
        for row in read_theme(a.release, 'theme=transportation/type=segment', bbox):
            for k, el in road_elements(row):
                tiles.setdefault(k, []).append(el)
        write(a.cache, 'f', tiles, a.release, bbox)


if __name__ == '__main__':
    main()
