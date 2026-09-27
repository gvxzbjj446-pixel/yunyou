// 建筑网格生成 Worker：拉取 OSM 建筑瓦片 → 投影到局部坐标 → 墙体/屋顶/屋顶设备几何 → 传回类型化数组。
import { ShapeUtils, Vector2 } from '../../vendor/three/build/three.core.js';
import { LocalFrame, rng } from '../core/geo.js';
import { signedArea, pointInPolygon } from '../core/poly.js';

// 与 textures.js 中 FACADES 顺序一致
const STYLE = { tower: 0, walkup: 1, office: 2, commercial: 3, low: 4 };
const TILE_W = [13.2, 14.4, 9.0, 18, 10.5];
const TILE_H = [12.4, 11.6, 15.6, 10, 6.4];
// 墙面乘色：米黄、浅灰、暖白、砖红、灰褐、深灰（贴图本身为浅色）
const WALL_TINTS = [
  [0.96, 0.9, 0.8], [0.92, 0.84, 0.72], [0.86, 0.86, 0.86], [0.98, 0.96, 0.92], [0.84, 0.7, 0.6], [0.78, 0.72, 0.64],
  [0.7, 0.72, 0.75], [0.95, 0.86, 0.78], [0.9, 0.9, 0.88], [0.62, 0.6, 0.58], [0.88, 0.78, 0.66], [0.8, 0.82, 0.84],
];

function pickStyle(b, rand) {
  const k = b.k || 'yes';
  if (['office', 'commercial', 'hotel', 'government', 'bank'].includes(k) && b.h > 30) return STYLE.office;
  if (b.h > 90) return rand() < 0.55 ? STYLE.office : STYLE.tower;
  if (['retail', 'commercial', 'supermarket', 'mall', 'train_station', 'transportation', 'hospital', 'school', 'university', 'civic', 'public'].includes(k)) return b.h > 40 ? STYLE.office : STYLE.commercial;
  if (b.h <= 9) return STYLE.low;
  if (b.h > 36) return rand() < 0.12 ? STYLE.office : STYLE.tower;
  if (b.a > 3000) return STYLE.commercial;
  return STYLE.walkup;
}

class Buf {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.lit = [];
    this.idx = [];
  }
  get count() {
    return this.pos.length / 3;
  }
  vert(x, y, z, nx, ny, nz, u, v, c, lit) {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(c[0], c[1], c[2]);
    this.lit.push(lit);
    return this.count - 1;
  }
  pack() {
    return {
      position: new Float32Array(this.pos),
      normal: new Float32Array(this.nor),
      uv: new Float32Array(this.uv),
      color: new Float32Array(this.col),
      aLit: new Float32Array(this.lit),
      index: this.count > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx),
    };
  }
}

function sampleDem(dem, x, z) {
  if (!dem) return 0;
  const u = (x - dem.x0) / (dem.x1 - dem.x0);
  const v = (z - dem.z0) / (dem.z1 - dem.z0);
  const n = dem.size;
  const fx = Math.min(n - 1, Math.max(0, u * n - 0.5));
  const fy = Math.min(n - 1, Math.max(0, v * n - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(n - 1, x0 + 1);
  const y1 = Math.min(n - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const h = dem.h;
  return (h[y0 * n + x0] * (1 - tx) + h[y0 * n + x1] * tx) * (1 - ty) + (h[y1 * n + x0] * (1 - tx) + h[y1 * n + x1] * tx) * ty;
}

/** 墙体：每条边一个四边形，UV 以米为单位映射到立面贴图 */
function addWalls(buf, ring, y0, y1, style, uOff, tint, lit) {
  const tw = TILE_W[style];
  const th = TILE_H[style];
  let run = uOff * tw;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % n];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    // 环已保证为（东,北）逆时针：外法线 = (-dz, 0, dx)/len
    const nx = -(bz - az) / len;
    const nz = (bx - ax) / len;
    const u0 = run / tw;
    const u1 = (run + len) / tw;
    // 贴图 v：从地面起算，保证楼层线跨建筑一致
    const v0 = y0 / th;
    const v1 = y1 / th;
    const a = buf.vert(ax, 0, az, nx, 0, nz, u0, v0, tint, lit);
    const b = buf.vert(bx, 0, bz, nx, 0, nz, u1, v0, tint, lit);
    const c = buf.vert(bx, 0, bz, nx, 0, nz, u1, v1, tint, lit);
    const d = buf.vert(ax, 0, az, nx, 0, nz, u0, v1, tint, lit);
    buf._wall.push([a, b, c, d, y0, y1]);
    buf.idx.push(a, b, c, a, c, d);
    run += len;
  }
}

function addRoof(buf, ring, holes, y, tint) {
  const contour = ring.map(([x, z]) => new Vector2(x, -z));
  const hs = holes.map((h) => h.map(([x, z]) => new Vector2(x, -z)));
  let tris;
  try {
    tris = ShapeUtils.triangulateShape(contour, hs);
  } catch {
    return;
  }
  const all = ring.concat(...holes);
  const base = buf.count;
  for (const [x, z] of all) buf.vert(x, y, z, 0, 1, 0, x / 24, z / 24, tint, 0);
  for (const [i, j, k] of tris) {
    // 保证俯视逆时针（朝上）
    const [ax, az] = all[i];
    const [bx, bz] = all[j];
    const [cx, cz] = all[k];
    const cross = (bx - ax) * (-(cz - az)) - (-(bz - az)) * (cx - ax);
    if (cross >= 0) buf.idx.push(base + i, base + j, base + k);
    else buf.idx.push(base + i, base + k, base + j);
  }
}

function addBox(buf, cx, cz, w, d, ang, y0, h, tint) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const pts = [
    [-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2],
  ].map(([x, z]) => [cx + x * c - z * s, cz + x * s + z * c]);
  // 转为（东,北）逆时针
  const en = pts.map(([x, z]) => [x, -z]);
  if (signedArea(en) < 0) pts.reverse();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[(i + 1) % n];
    const len = Math.hypot(bx - ax, bz - az);
    const nx = -(bz - az) / len;
    const nz = (bx - ax) / len;
    const a = buf.vert(ax, y0, az, nx, 0, nz, 0, 0, tint, 0);
    const b = buf.vert(bx, y0, bz, nx, 0, nz, len / 24, 0, tint, 0);
    const cc = buf.vert(bx, y0 + h, bz, nx, 0, nz, len / 24, h / 24, tint, 0);
    const dd = buf.vert(ax, y0 + h, az, nx, 0, nz, 0, h / 24, tint, 0);
    buf.idx.push(a, b, cc, a, cc, dd);
  }
  const top = pts.map(([x, z]) => buf.vert(x, y0 + h, z, 0, 1, 0, x / 24, z / 24, tint, 0));
  buf.idx.push(top[0], top[1], top[2], top[0], top[2], top[3]);
  // 顶面朝向校正
  const t = buf.idx.length;
  const [i0, i1, i2] = [buf.idx[t - 6], buf.idx[t - 5], buf.idx[t - 4]];
  const P = buf.pos;
  const cross = (P[i1 * 3] - P[i0 * 3]) * -(P[i2 * 3 + 2] - P[i0 * 3 + 2]) - -(P[i1 * 3 + 2] - P[i0 * 3 + 2]) * (P[i2 * 3] - P[i0 * 3]);
  if (cross < 0) {
    buf.idx[t - 5] = i2;
    buf.idx[t - 4] = i1;
    buf.idx[t - 2] = top[3];
    buf.idx[t - 1] = top[2];
  }
}

function build(data, { lon0, lat0, dem, exclusions }) {
  const frame = new LocalFrame(lon0, lat0);
  const walls = [0, 1, 2, 3, 4].map(() => {
    const b = new Buf();
    b._wall = [];
    return b;
  });
  const roof = new Buf();
  const footprints = [];
  let skipped = 0;
  for (const b of data.b || []) {
    const ring = [];
    for (let i = 0; i < b.p.length; i += 2) {
      const p = frame.toLocal(b.p[i], b.p[i + 1]);
      ring.push([p.x, p.z]);
    }
    if (ring.length < 3) continue;
    const c = frame.toLocal(b.cx, b.cy);
    if (exclusions?.some((e) => (e.ids ? e.ids.includes(b.i) : e.poly ? pointInPolygon(c.x, c.z, e.poly) : Math.hypot(c.x - e.x, c.z - e.z) < e.r))) {
      skipped++;
      continue;
    }
    // 统一为（东,北）平面逆时针
    const en = ring.map(([x, z]) => [x, -z]);
    if (signedArea(en) < 0) ring.reverse();
    const holes = (b.ho || []).map((h) => {
      const r = [];
      for (let i = 0; i < h.length; i += 2) {
        const p = frame.toLocal(h[i], h[i + 1]);
        r.push([p.x, p.z]);
      }
      return r;
    });
    let ground = Infinity;
    for (const [x, z] of ring) ground = Math.min(ground, sampleDem(dem, x, z));
    if (!Number.isFinite(ground)) ground = 0;
    const rand = rng((b.i * 2654435761) >>> 0);
    const style = pickStyle(b, rand);
    const t = WALL_TINTS[Math.floor(rand() * WALL_TINTS.length)];
    const shade = 0.8 + rand() * 0.2;
    const tint = [t[0] * shade, t[1] * shade, t[2] * shade];
    const lit = rand() < 0.12 ? 0.15 : 0.6 + rand() * 0.4;
    const y0 = b.mh || 0;
    const y1 = Math.max(y0 + 2, b.h);
    const wb = walls[style];
    const startWall = wb._wall.length;
    addWalls(wb, ring, y0, y1, style, Math.floor(rand() * 8), tint, lit);
    for (const h of holes) {
      const hen = h.map(([x, z]) => [x, -z]);
      if (signedArea(hen) > 0) h.reverse(); // 内环顺时针，法线朝向天井
      addWalls(wb, h, y0, y1, style, 0, tint, lit);
    }
    // 把墙体顶点的 y 设为 地面 + 高度（墙底再下沉 2m 以免坡地露缝）
    for (let k = startWall; k < wb._wall.length; k++) {
      const [a, bb, cc, d, yy0, yy1] = wb._wall[k];
      wb.pos[a * 3 + 1] = ground + (yy0 > 0 ? yy0 : -2);
      wb.pos[bb * 3 + 1] = ground + (yy0 > 0 ? yy0 : -2);
      wb.pos[cc * 3 + 1] = ground + yy1;
      wb.pos[d * 3 + 1] = ground + yy1;
    }
    const rt = 0.6 + rand() * 0.3;
    const roofTint = [rt * 1.02, rt, rt * 0.95];
    addRoof(roof, ring, holes, ground + y1, roofTint);
    // 高层屋顶机房/水箱
    if (y1 > 28 && b.a > 180 && !b.part) {
      const bw = Math.min(10, Math.sqrt(b.a) * 0.32);
      addBox(roof, c.x, c.z, bw, bw * (0.6 + rand() * 0.5), rand() * Math.PI, ground + y1, 3 + rand() * 3, [0.86, 0.86, 0.84]);
    }
    let minx = Infinity;
    let minz = Infinity;
    let maxx = -Infinity;
    let maxz = -Infinity;
    for (const [x, z] of ring) {
      minx = Math.min(minx, x);
      maxx = Math.max(maxx, x);
      minz = Math.min(minz, z);
      maxz = Math.max(maxz, z);
    }
    footprints.push({ ring: new Float32Array(ring.flat()), minx, minz, maxx, maxz, top: ground + y1, bottom: ground + y0, name: b.n, id: b.i });
  }
  return { walls: walls.map((w) => (w.count ? w.pack() : null)), roof: roof.count ? roof.pack() : null, footprints, count: footprints.length, skipped };
}

self.onmessage = async (e) => {
  const { id, url, opts } = e.data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const out = build(data, opts);
    const transfer = [];
    for (const g of [...out.walls, out.roof]) if (g) for (const k in g) transfer.push(g[k].buffer);
    for (const f of out.footprints) transfer.push(f.ring.buffer);
    self.postMessage({ id, ok: true, out }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err.message || err) });
  }
};
