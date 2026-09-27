// 纯函数回归测试：node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalFrame, lonLatToTile, tileBounds, wgs84ToGcj02, gcj02ToWgs84, haversine, rng } from '../public/src/core/geo.js';
import { centroid, signedArea, pointInPolygon, elongation } from '../public/src/core/poly.js';
import { processBuildings, estimateHeight, joinRings } from '../server/osm.mjs';
import { parseWikivoyage, cleanWikitext } from '../server/providers.mjs';

// 二七纪念塔 OSM 轮廓（way 730973930）
const ERQI = [[113.660298, 34.753382], [113.660371, 34.753386], [113.660448, 34.753374], [113.660515, 34.753349], [113.660501, 34.753287], [113.660428, 34.753282], [113.66035, 34.753293], [113.660284, 34.753321]];

test('小多边形在经纬度下的质心不因数值相消而漂移', () => {
  const [lon, lat] = centroid(ERQI);
  // 修复前该轮廓质心偏到 113.659587, 34.753085（约 80 m 外）
  assert.ok(haversine(lon, lat, 113.6604, 34.75333) < 3, `centroid ${lon},${lat}`);
});

test('多边形面积、质心、点在多边形内', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(signedArea(sq), 100);
  assert.equal(signedArea(sq.slice().reverse()), -100);
  assert.deepEqual(centroid(sq), [5, 5]);
  assert.ok(pointInPolygon(5, 5, sq));
  assert.ok(!pointInPolygon(11, 5, sq));
  const slab = [[0, 0], [60, 0], [60, 12], [0, 12]];
  assert.ok(elongation(slab).ratio > 4);
});

test('局部坐标系往返误差 < 1 cm，东为 +x、南为 +z', () => {
  const f = new LocalFrame(113.69, 34.765);
  const p = f.toLocal(113.6604, 34.75333);
  const back = f.toLonLat(p.x, p.z);
  assert.ok(haversine(back.lon, back.lat, 113.6604, 34.75333) < 0.01);
  assert.ok(p.x < 0 && p.z > 0, '二七塔在中心的西南');
  // 局部距离与大圆距离一致（城市尺度 < 0.5%）
  const d = Math.hypot(p.x, p.z);
  const g = haversine(113.69, 34.765, 113.6604, 34.75333);
  assert.ok(Math.abs(d - g) / g < 0.005, `${d} vs ${g}`);
});

test('瓦片号与边界互相一致', () => {
  const t = lonLatToTile(113.6604, 34.75333, 14);
  const b = tileBounds(14, t.x, t.y);
  assert.ok(113.6604 >= b.w && 113.6604 < b.e && 34.75333 >= b.s && 34.75333 < b.n);
  const f = new LocalFrame(113.69, 34.765);
  const p = f.toLocal(113.6604, 34.75333);
  assert.deepEqual(f.localToTile(p.x, p.z, 14), t);
});

test('GCJ-02 往返误差 < 0.5 m，偏移量级 100~700 m', () => {
  const g = wgs84ToGcj02(113.6604, 34.75333);
  const off = haversine(113.6604, 34.75333, g.lon, g.lat);
  assert.ok(off > 100 && off < 700, `offset ${off}`);
  const w = gcj02ToWgs84(g.lon, g.lat);
  assert.ok(haversine(w.lon, w.lat, 113.6604, 34.75333) < 0.5);
});

function wayEl(id, ring, tags) {
  return { type: 'way', id, tags, geometry: ring.map(([lon, lat]) => ({ lon, lat })) };
}
const tileOf = (lon, lat) => lonLatToTile(lon, lat, 14);

test('建筑清洗：地下站房被丢弃，实测高度被保留，质心决定瓦片归属', () => {
  const t = tileOf(113.6604, 34.75333);
  const shift = (r, dl) => r.map(([a, b]) => [a + dl, b]);
  const osm = {
    elements: [
      wayEl(1, ERQI, { building: 'yes', name: '二七纪念塔', 'building:levels': '13' }),
      wayEl(2, shift(ERQI, -0.0012), { building: 'train_station', layer: '-1', location: 'underground', name: '二七广场' }),
      wayEl(3, shift(ERQI, 0.0012), { building: 'commercial', height: '181.35' }),
      wayEl(4, shift(ERQI, 0.0024), { building: 'no' }),
    ],
  };
  const out = processBuildings(osm, 14, t.x, t.y);
  const ids = out.b.map((b) => b.i).sort();
  assert.deepEqual(ids, [1, 3]);
  const tower = out.b.find((b) => b.i === 1);
  assert.ok(haversine(tower.cx, tower.cy, 113.6604, 34.75333) < 3);
  assert.equal(out.b.find((b) => b.i === 3).h, 181.4);
});

test('估高：乡镇低密度区不会生成高层，城区点式楼多为高层', () => {
  let r = 0.37;
  const rand = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  const rural = Array.from({ length: 200 }, () => estimateHeight({ building: 'yes' }, { area: 800, ratio: 1.3 }, rand, 0.1).h);
  const urban = Array.from({ length: 200 }, () => estimateHeight({ building: 'yes' }, { area: 800, ratio: 1.3 }, rand, 1).h);
  assert.ok(Math.max(...rural) < 20, `rural max ${Math.max(...rural)}`);
  assert.ok(urban.filter((h) => h > 45).length > 100);
  assert.equal(estimateHeight({ building: 'yes', height: '63 m' }, { area: 200, ratio: 1 }, rand).h, 63);
});

test('多段 way 拼接成闭合环', () => {
  const rings = joinRings([
    [[0, 0], [1, 0]],
    [[1, 1], [1, 0]],
    [[1, 1], [0, 1], [0, 0]],
  ]);
  assert.equal(rings.length, 1);
  assert.equal(rings[0].length, 5);
});

test('Wikivoyage 解析：章节、列表项与内联标记', () => {
  const wt = `{{pagebanner}}'''郑州'''是[[河南]]省会。\n==景点==\n* {{see | name=河南博物院 | address=农业路8号 | content=馆藏丰富 [[贾湖骨笛]]}}\n==用餐==\n* 郑州烩面\n<!-- 注释 -->`;
  const secs = parseWikivoyage(wt);
  assert.equal(secs[0].title, '概述');
  assert.match(secs[0].text, /郑州是河南省会/);
  const see = secs.find((s) => s.title === '景点');
  assert.equal(see.items[0].name, '河南博物院');
  assert.equal(see.items[0].content, '馆藏丰富 贾湖骨笛');
  assert.equal(secs.find((s) => s.title === '用餐').text, '• 郑州烩面');
  assert.equal(cleanWikitext("[[File:x.jpg|缩略图|说明]]A[http://a.b 链接]'''B'''"), 'A链接B');
});

test('补充建筑：与 OSM 建筑重叠的轮廓被剔除，其余并入', async () => {
  const { mergeSupplement } = await import('../server/osm.mjs');
  const sq = (x, y, d) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]].map(([lon, lat]) => ({ lon, lat }));
  const osm = { elements: [{ type: 'way', id: 1, tags: { building: 'yes' }, geometry: sq(115, 35.8, 0.0003) }] };
  const supp = {
    elements: [
      { type: 'way', id: 5e15 + 1, tags: { building: 'yes' }, geometry: sq(115.0001, 35.8001, 0.0001) }, // 在 OSM 楼内 → 剔除
      { type: 'way', id: 5e15 + 2, tags: { building: 'yes' }, geometry: sq(115.001, 35.801, 0.0001) }, // 空地 → 保留
    ],
  };
  const out = mergeSupplement(osm, supp);
  assert.deepEqual(out.elements.map((e) => e.id), [1, 5e15 + 2]);
  assert.equal(mergeSupplement(osm, null), osm);
});

test('补充建筑数据：每个瓦片的要素质心都落在该瓦片内，id 不与 OSM 冲突', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const { gunzipSync } = await import('node:zlib');
  const dir = new URL('../data/buildings-supplement/14/', import.meta.url);
  const files = readdirSync(dir);
  assert.ok(files.length > 50);
  for (const f of files.slice(0, 12)) {
    const [x, y] = f.replace('.json.gz', '').split('_').map(Number);
    const tb = tileBounds(14, x, y);
    for (const el of JSON.parse(gunzipSync(readFileSync(new URL(f, dir)))).elements.slice(0, 200)) {
      assert.ok(el.id >= 5e15 && el.id < 2 ** 53);
      const g = el.geometry || el.members.find((m) => m.role === 'outer').geometry;
      const [cx, cy] = centroid(g.map((p) => [p.lon, p.lat]));
      assert.ok(cx >= tb.w - 1e-4 && cx <= tb.e + 1e-4 && cy >= tb.s - 1e-4 && cy <= tb.n + 1e-4, `${f} ${el.id}`);
    }
  }
});

test('影像识别轮廓估高：县城以多层/低层为主，高层占少数', () => {
  const r = rng(11);
  let high = 0;
  let low = 0;
  const n = 3000;
  for (let i = 0; i < n; i++) {
    const e = estimateHeight({ building: 'yes', source: 'imagery-footprint' }, { area: [80, 200, 450, 800, 2500][i % 5], ratio: i % 3 ? 1.5 : 3 }, r, 1);
    if (e.lv >= 11) high++;
    if (e.lv <= 3) low++;
    assert.ok(e.lv >= 1 && e.lv <= 33);
  }
  assert.ok(high / n < 0.2, `high-rise share ${high / n}`);
  assert.ok(low / n > 0.3, `low-rise share ${low / n}`);
});
