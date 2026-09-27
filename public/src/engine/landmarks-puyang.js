// 濮阳（五县一区）精细地标：全部按 OSM / Overture 实测轮廓落位（public/src/data/puyang-geo.js）。
// 造型依据公开资料概括，未掌握细部的建筑（如剧院外立面）以示意方式表现，并在景点介绍中说明。
import * as THREE from 'three';
import { hall, prism, rampart, canvasTexture, mergeGeometries, rod, ensureCCW } from './modelkit.js';
import { PY_GEO } from '../data/puyang-geo.js';
import { rng } from '../core/geo.js';
import { pointInPolygon } from '../core/poly.js';

const D2R = Math.PI / 180;

/** 经纬度 → 相对锚点的局部坐标 [x(东), z(南)] */
const loc = (frame, anchor, [lo, la]) => {
  const p = frame.toLocal(lo, la);
  return [p.x - anchor.x, p.z - anchor.z];
};
/** 局部 [x, z] 环 → 足迹（东, 北） */
const toEN = (ring) => ring.map(([x, z]) => [x, -z]);

function shadowAll(obj) {
  obj.traverse((o) => {
    if (o.isMesh || o.isInstancedMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return obj;
}

/** 按长宽与朝向把多边形环向内收缩 d 米（简单的质心缩放，适用于近凸轮廓） */
function inset(ring, d) {
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return ring.map(([x, z]) => {
    const r = Math.hypot(x - cx, z - cz);
    const k = r > d ? (r - d) / r : 1;
    return [cx + (x - cx) * k, cz + (z - cz) * k];
  });
}

/** 沿折线每隔 step 米插点 */
function densify(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// ============================================================== 戚城遗址（华龙区）
function qicheng({ kit, frame, anchor, groundAt, templeGroup }) {
  const g = new THREE.Group();
  const ring = PY_GEO.qicheng.poly.map((p) => loc(frame, anchor, p));
  // 春秋卫国戚邑夯土城垣：沿景区边界内收 14 m，覆草土垣，底宽 24 m、残高约 8 m
  const wall = densify(inset(ring, 14), 10);
  const geo = rampart(wall, { base: 24, top: 9, height: 8, groundAt: (x, z) => groundAt(x + anchor.x, z + anchor.z) - anchor.y });
  const m = new THREE.Mesh(geo, kit.grass());
  g.add(m);
  const side = new THREE.Mesh(geo, kit.earth());
  side.scale.set(1, 0.999, 1);
  g.add(side);
  // 园内陈列馆、长廊等仿古建筑：按 OSM / 影像实测轮廓生成歇山殿宇
  const t = templeGroup(kit, frame, anchor, PY_GEO.qicheng.halls, groundAt, { tiles: 'gray', highlight: {} });
  g.add(t.object);
  return { object: shadowAll(g), height: 14, footprints: t.footprints };
}

// ============================================================== 西水坡 · 中华第一龙（濮阳县）
/** 在形状函数内按抖动网格撒蚌壳（InstancedMesh） */
function shellField(inside, bounds, spacing, rand, tint) {
  const pts = [];
  for (let x = bounds[0]; x <= bounds[2]; x += spacing) {
    for (let z = bounds[1]; z <= bounds[3]; z += spacing) {
      const px = x + (rand() - 0.5) * spacing * 0.7;
      const pz = z + (rand() - 0.5) * spacing * 0.7;
      if (inside(px, pz)) pts.push([px, pz]);
    }
  }
  const shell = new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.05, color: 0xffffff });
  const inst = new THREE.InstancedMesh(shell, mat, pts.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  pts.forEach(([x, z], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
    const s = spacing * (0.42 + rand() * 0.12);
    m4.compose(new THREE.Vector3(x, 0.32, z), q, new THREE.Vector3(s, s * 0.35, s * 0.72));
    inst.setMatrixAt(i, m4);
    col.setRGB(tint[0] - rand() * 0.08, tint[1] - rand() * 0.08, tint[2] - rand() * 0.1);
    inst.setColorAt(i, col);
  });
  return inst;
}

/** 龙/虎身体：沿中心线的变宽带 + 四肢，返回点是否在形内 */
function beastShape({ x0, dir, len, width, head, legs, arch }) {
  // 中心线：t∈[0,1] 自尾（南）至头（北），拱背朝外（dir=+1 向东）
  const cl = (t) => [x0 + dir * arch * Math.sin(Math.PI * t) - dir * arch * 0.3 * Math.sin(2 * Math.PI * t), len / 2 - t * len];
  const samples = [];
  for (let i = 0; i <= 80; i++) samples.push(cl(i / 80));
  return (x, z) => {
    // 最近中心线点
    let best = Infinity;
    let bt = 0;
    for (let i = 0; i <= 80; i++) {
      const d = (x - samples[i][0]) ** 2 + (z - samples[i][1]) ** 2;
      if (d < best) {
        best = d;
        bt = i / 80;
      }
    }
    const w = width(bt) + (bt > 1 - head.len ? head.w * Math.sin((Math.PI * (bt - 1 + head.len)) / head.len) : 0);
    if (best < w * w) return true;
    // 四肢：从身体向内侧伸出的短肢
    for (const t of legs) {
      const [lx, lz] = cl(t);
      const ex = lx - dir * 4.2;
      const ez = lz + 1.2;
      const ux = ex - lx;
      const uz = ez - lz;
      const u = Math.max(0, Math.min(1, ((x - lx) * ux + (z - lz) * uz) / (ux * ux + uz * uz)));
      const dx = x - (lx + ux * u);
      const dz = z - (lz + uz * u);
      if (dx * dx + dz * dz < 0.55 * 0.55) return true;
    }
    return false;
  };
}

function xishuipoDragon({ kit }) {
  const g = new THREE.Group();
  const rand = rng(6400);
  // 展示广场与墓坑（M45 墓坑南北长约 4 m，此处放大 10 倍展示）
  const plaza = new THREE.Mesh(new THREE.BoxGeometry(72, 0.6, 58), kit.stone('#cfc6b4', 'py-plaza'));
  plaza.position.y = -0.1;
  g.add(plaza);
  const pit = new THREE.Mesh(new THREE.BoxGeometry(48, 0.3, 40), kit.std('py-loess', { color: '#8a6a45', roughness: 0.95 }));
  pit.position.y = 0.2;
  g.add(pit);
  const rim = new THREE.Mesh(new THREE.BoxGeometry(50, 0.5, 42), kit.stone('#a79e8d', 'py-rim'));
  rim.position.y = 0.05;
  g.add(rim);
  // 墓主（示意）居中，头南足北；龙在东、虎在西，均头北背外
  const person = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 13, 4, 8), kit.stone('#e9e2cf', 'py-bone'));
  person.rotation.x = Math.PI / 2;
  person.position.set(0, 0.55, 0);
  g.add(person);
  const dragon = beastShape({ x0: 7.5, dir: 1, len: 17.8, arch: 2.4, width: (t) => 0.5 + 0.75 * Math.sin(Math.PI * Math.min(1, t * 1.3)), head: { len: 0.14, w: 1.1 }, legs: [0.28, 0.62] });
  g.add(shellField(dragon, [4, -11, 13.5, 11], 0.34, rand, [0.97, 0.95, 0.9]));
  const tiger = beastShape({ x0: -7.2, dir: -1, len: 13.9, arch: 1.6, width: (t) => 0.9 + 0.8 * Math.sin(Math.PI * Math.min(1, t * 1.15)), head: { len: 0.2, w: 1.3 }, legs: [0.22, 0.7] });
  g.add(shellField(tiger, [-12, -9, -3, 9], 0.34, rand, [0.95, 0.93, 0.88]));
  // 南侧石碑“中华第一龙”
  const tex = canvasTexture(256, 640, (x, w, h) => {
    x.fillStyle = '#2b2a28';
    x.fillRect(0, 0, w, h);
    x.fillStyle = '#d9c38a';
    x.font = 'bold 96px "Noto Serif SC", "Songti SC", serif';
    x.textAlign = 'center';
    '中华第一龙'.split('').forEach((c, i) => x.fillText(c, w / 2, 110 + i * 112));
  });
  const stele = new THREE.Mesh(new THREE.BoxGeometry(2.2, 5.6, 0.7), [kit.stone('#3a3835', 'py-stele'), kit.stone('#3a3835', 'py-stele'), kit.stone('#3a3835', 'py-stele'), kit.stone('#3a3835', 'py-stele'), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }), kit.stone('#3a3835', 'py-stele')]);
  stele.position.set(0, 3.1, 25);
  g.add(stele);
  const base = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.6, 1.6), kit.stone('#6d665c', 'py-stele-base'));
  base.position.set(0, 0.3, 25);
  g.add(base);
  // 碰撞/避树范围取墓坑外沿：游客可绕坑参观
  return { object: shadowAll(g), height: 6, footprints: [[[-25, -21], [25, -21], [25, 21], [-25, 21]]] };
}

// ============================================================== 张挥公园 · 张氏宗祠（濮阳县）
function zhanghui({ kit, frame, anchor, groundAt }) {
  const g = new THREE.Group();
  const h = PY_GEO.zhangshi.halls[0];
  const [cx, cz] = loc(frame, anchor, h.c);
  const comp = new THREE.Group();
  comp.position.set(cx, groundAt(cx + anchor.x, cz + anchor.z) - anchor.y, cz);
  // 院落长轴（实测 65×23 m）→ 轴线；南起山门、正殿、寝殿，中间两进院
  comp.rotation.y = (h.ang - 90) * D2R;
  const L = h.len;
  const W = h.wid;
  const wallMat = kit.hallWall('#8f3326', 'py-wall');
  for (const s of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.8, 4, L), wallMat);
    side.position.set((s * W) / 2, 2, 0);
    comp.add(side);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, L + 0.8), kit.glazedTiles('#5d6267', 'gray'));
    cap.position.set((s * W) / 2, 4.3, 0);
    comp.add(cap);
  }
  const back = new THREE.Mesh(new THREE.BoxGeometry(W, 4, 0.8), wallMat);
  back.position.set(0, 2, -L / 2);
  comp.add(back);
  const halls = [
    { z: L / 2 - 4, w: W - 3, d: 6, h: 5 }, // 山门
    { z: 0, w: W - 1, d: 14, h: 7.5, double: true }, // 正殿
    { z: -L / 2 + 7, w: W - 3, d: 10, h: 6 }, // 寝殿
  ];
  for (const it of halls) {
    const o = hall(kit, { w: it.w, d: it.d, h: it.h, podium: 1.2, double: !!it.double, tiles: 'gray' });
    o.position.z = it.z;
    comp.add(o);
  }
  // 南侧石牌坊（三间四柱）
  const pf = new THREE.Group();
  const stone = kit.stone('#d8d0c0', 'py-paifang');
  for (const x of [-7, -2.5, 2.5, 7]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.9, 8, 0.9), stone);
    col.position.set(x, 4, 0);
    pf.add(col);
  }
  for (const [x, w, y] of [[0, 5.8, 8.4], [-4.75, 5.2, 7.2], [4.75, 5.2, 7.2]]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w, 1.2, 1.1), stone);
    beam.position.set(x, y, 0);
    pf.add(beam);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 1, 0.5, 2.2), kit.glazedTiles('#5d6267', 'gray'));
    roof.position.set(x, y + 0.9, 0);
    pf.add(roof);
  }
  pf.position.z = L / 2 + 30;
  comp.add(pf);
  g.add(comp);
  // 足迹：院落矩形（东, 北）
  const c = Math.cos(comp.rotation.y);
  const s = Math.sin(comp.rotation.y);
  const rect = [[-W / 2, -L / 2], [W / 2, -L / 2], [W / 2, L / 2], [-W / 2, L / 2]].map(([u, v]) => [cx + u * c + v * s, -(cz - u * s + v * c)]);
  return { object: shadowAll(g), height: 16, footprints: [rect] };
}

// ============================================================== 濮阳县城隍庙
function pyChenghuang({ kit, frame, anchor, groundAt, templeGroup }) {
  const t = templeGroup(kit, frame, anchor, PY_GEO.pyChenghuang.halls, groundAt, { tiles: 'gray', highlight: {} });
  return { object: shadowAll(t.object), height: 12, footprints: t.footprints };
}

// ============================================================== 水秀国际大剧院（杂技，华龙区）
function shuixiu({ kit, frame, anchor }) {
  const g = new THREE.Group();
  const ring = PY_GEO.shuixiu.ring.map((p) => loc(frame, anchor, p));
  if (ring.length > 3 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
  // prism 以（东, 北）逆时针为正，局部 z 向南需取反
  const en = ensureCCW(toEN(ring));
  const shrink = (k) => {
    const cx = en.reduce((s, p) => s + p[0], 0) / en.length;
    const cy = en.reduce((s, p) => s + p[1], 0) / en.length;
    return en.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
  };
  g.add(new THREE.Mesh(prism(shrink(1.03), -1, 1.2, { uvMode: 'run', uScale: 3, vScale: 3 }), kit.stone('#d6d2ca', 'py-sx-podium')));
  const glass = kit.glow(kit.glass('py-sx-glass', '#5f7f93', { night: '#ffd49a' }), 0.9);
  g.add(new THREE.Mesh(prism(shrink(0.97), 1.2, 7.5, { uvMode: 'run', uScale: 6, vScale: 6.3 }), glass));
  const finTex = canvasTexture(256, 256, (x, w, h) => {
    x.fillStyle = '#f1efe9';
    x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(40,60,80,0.55)';
    for (let i = 0; i < 8; i++) x.fillRect(i * 32 + 22, 0, 6, h);
  });
  g.add(new THREE.Mesh(prism(en, 7.5, 21, { uvMode: 'run', uScale: 8, vScale: 13.5 }), new THREE.MeshStandardMaterial({ map: finTex, roughness: 0.55 })));
  g.add(new THREE.Mesh(prism(shrink(1.05), 21, 22.4, { uvMode: 'run', uScale: 6, vScale: 1.4 }), kit.paint('#e6e3dc', 'py-sx-cornice')));
  // 夜间灯带：随演出氛围的暖金色
  const band = new THREE.Mesh(prism(shrink(1.052), 19.6, 20.4, { uvMode: 'run', uScale: 4, vScale: 1, top: false }), kit.glow(new THREE.MeshStandardMaterial({ color: '#c9a36a', emissive: new THREE.Color('#ffb347'), emissiveIntensity: 0 }), 2.2));
  g.add(band);
  return { object: shadowAll(g), height: 23, footprints: [shrink(1.03)] };
}

// ============================================================== 范县 · 万亩荷花生态园
function fanLotus({ kit, frame, anchor, groundAt }) {
  const g = new THREE.Group();
  const ring = PY_GEO.lotus.poly.map((p) => loc(frame, anchor, p));
  const en = ensureCCW(toEN(ring));
  // 水面
  const shape = new THREE.Shape(en.map(([x, y]) => new THREE.Vector2(x, y)));
  const wgeo = new THREE.ShapeGeometry(shape);
  wgeo.rotateX(-Math.PI / 2);
  // 水位：取园内地形最高处，保证整片水面不被起伏的滩区地面遮住；塘岸从水位下探到最低处
  let hi = -Infinity;
  let lo = Infinity;
  for (const [x, z] of densify([...ring, ring[0]], 25).concat([[0, 0]])) {
    const h = groundAt(x + anchor.x, z + anchor.z) - anchor.y;
    hi = Math.max(hi, h);
    lo = Math.min(lo, h);
  }
  const level = hi + 0.35;
  const g2 = new THREE.Group();
  g2.position.y = level;
  g.add(g2);
  const water = new THREE.Mesh(wgeo, new THREE.MeshStandardMaterial({ color: '#3d5a52', roughness: 0.12, metalness: 0.35, envMapIntensity: 1.2 }));
  water.receiveShadow = true;
  g2.add(water);
  const bank = new THREE.Mesh(prism(en, lo - level - 1, 0.25, { top: false, uvMode: 'run', uScale: 4, vScale: 1 }), kit.earth());
  g2.add(bank);
  // 荷叶：成片分布（低频噪声决定疏密，留出水道），叶面略高于水面，部分挺水
  const rand = rng(5210);
  let minx = Infinity;
  let maxx = -Infinity;
  let minz = Infinity;
  let maxz = -Infinity;
  for (const [x, z] of ring) {
    minx = Math.min(minx, x);
    maxx = Math.max(maxx, x);
    minz = Math.min(minz, z);
    maxz = Math.max(maxz, z);
  }
  const noise = (x, z) => Math.sin(x * 0.021 + 1.3) * Math.cos(z * 0.017 - 0.4) + 0.5 * Math.sin((x + z) * 0.043);
  // 栈道：折线穿过荷塘中部
  const walkPts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    walkPts.push([minx + 40 + (maxx - minx - 80) * t, (minz + maxz) / 2 + (i % 2 ? 26 : -26)]);
  }
  const nearWalk = (x, z) => {
    for (let i = 0; i < walkPts.length - 1; i++) {
      const [ax, az] = walkPts[i];
      const [bx, bz] = walkPts[i + 1];
      const ux = bx - ax;
      const uz = bz - az;
      const u = Math.max(0, Math.min(1, ((x - ax) * ux + (z - az) * uz) / (ux * ux + uz * uz)));
      if (Math.hypot(x - ax - ux * u, z - az - uz * u) < 3) return true;
    }
    return false;
  };
  const leaves = [];
  const flowers = [];
  const step = 2.6;
  for (let x = minx; x < maxx; x += step) {
    for (let z = minz; z < maxz; z += step) {
      const px = x + (rand() - 0.5) * step;
      const pz = z + (rand() - 0.5) * step;
      if (!pointInPolygon(px, pz, ring) || nearWalk(px, pz)) continue;
      const n = noise(px, pz);
      if (n < -0.35 || rand() > 0.55 + n * 0.3) continue;
      leaves.push([px, pz, 0.55 + rand() * 0.6, rand() < 0.35 ? 0.4 + rand() * 0.9 : 0.05, rand()]);
      if (rand() < 0.045) flowers.push([px + (rand() - 0.5), pz + (rand() - 0.5), 0.9 + rand() * 0.6]);
    }
  }
  const leafGeo = new THREE.ConeGeometry(1, 0.22, 12, 1, true);
  leafGeo.rotateX(Math.PI);
  const leafInst = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ roughness: 0.6, side: THREE.DoubleSide }), leaves.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  leaves.forEach(([x, z, s, h, r], i) => {
    q.setFromEuler(new THREE.Euler((r - 0.5) * 0.35, r * 6.3, (r - 0.5) * 0.3));
    m4.compose(new THREE.Vector3(x, 0.06 + h, z), q, new THREE.Vector3(s, s, s));
    leafInst.setMatrixAt(i, m4);
    col.setHSL(0.27 + r * 0.05, 0.45 + r * 0.2, 0.26 + r * 0.12);
    leafInst.setColorAt(i, col);
  });
  g2.add(leafInst);
  const flowerGeo = new THREE.SphereGeometry(0.28, 8, 6);
  flowerGeo.scale(1, 1.35, 1);
  const flowerInst = new THREE.InstancedMesh(flowerGeo, new THREE.MeshStandardMaterial({ roughness: 0.5 }), flowers.length);
  flowers.forEach(([x, z, h], i) => {
    m4.compose(new THREE.Vector3(x, h, z), q.identity(), new THREE.Vector3(1, 1, 1));
    flowerInst.setMatrixAt(i, m4);
    col.setHSL(0.93 + rand() * 0.05, 0.6, 0.72 + rand() * 0.12);
    flowerInst.setColorAt(i, col);
  });
  g2.add(flowerInst);
  // 木栈道 + 观荷亭
  const wood = kit.std('py-wood', { color: '#8a6446', roughness: 0.8 });
  const deck = [];
  for (let i = 0; i < walkPts.length - 1; i++) {
    const [ax, az] = walkPts[i];
    const [bx, bz] = walkPts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const b = new THREE.BoxGeometry(2.4, 0.2, len + 2.4);
    b.rotateY(Math.atan2(bx - ax, bz - az));
    b.translate((ax + bx) / 2, 1.0, (az + bz) / 2);
    deck.push(b.toNonIndexed());
    for (const s of [-1, 1]) {
      const nx = ((bz - az) / len) * 1.15 * s;
      const nz = (-(bx - ax) / len) * 1.15 * s;
      deck.push(rod(new THREE.Vector3(ax + nx, 1.9, az + nz), new THREE.Vector3(bx + nx, 1.9, bz + nz), 0.06, 4).toNonIndexed());
    }
  }
  g2.add(new THREE.Mesh(mergeGeometries(deck), wood));
  const mid = walkPts[4];
  const pav = hall(kit, { w: 6, d: 6, h: 3.2, podium: 1.1, tiles: 'gray', wall: 'wood' });
  pav.position.set(mid[0], 0, mid[1]);
  g2.add(pav);
  return { object: shadowAll(g), height: 6, footprints: [en] };
}

// ============================================================== 台前 · 将军渡黄河浮桥
function jiangjunduBridge({ kit, frame, anchor }) {
  const g = new THREE.Group();
  const [a, b] = PY_GEO.pontoon.map((p) => loc(frame, anchor, p));
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const bridge = new THREE.Group();
  bridge.rotation.y = -ang;
  bridge.position.set((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2);
  const hull = kit.paint('#34485a', 'py-pontoon-hull', 0.6);
  const deckMat = kit.metal('py-pontoon-deck', '#8c9196', 0.6);
  const rail = kit.paint('#d23b2f', 'py-rail', 0.5);
  const seg = 10;
  const n = Math.max(3, Math.round(len / seg));
  const L = len / n;
  const rails = [];
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + L * (i + 0.5);
    // 两端引桥略高，中段浮箱随水面
    const ramp = i === 0 || i === n - 1;
    const boat = new THREE.Mesh(new THREE.BoxGeometry(L - 0.6, 1.6, 9), hull);
    boat.position.set(x, 0.1, 0);
    bridge.add(boat);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(L - 0.1, 0.25, 8.2), deckMat);
    deck.position.set(x, ramp ? 1.2 : 1.0, 0);
    bridge.add(deck);
    for (const s of [-1, 1]) rails.push(rod(new THREE.Vector3(x - L / 2, 2.1, s * 4), new THREE.Vector3(x + L / 2, 2.1, s * 4), 0.06, 4).toNonIndexed());
    for (const s of [-1, 1]) rails.push(new THREE.BoxGeometry(0.12, 1, 0.12).translate(x - L / 2 + 0.1, 1.6, s * 4).toNonIndexed());
  }
  bridge.add(new THREE.Mesh(mergeGeometries(rails), rail));
  g.add(bridge);
  const c = Math.cos(-ang);
  const s = Math.sin(-ang);
  const rect = [[-len / 2, -4.5], [len / 2, -4.5], [len / 2, 4.5], [-len / 2, 4.5]].map(([u, v]) => [bridge.position.x + u * c + v * s, -(bridge.position.z - u * s + v * c)]);
  return { object: shadowAll(g), height: 3, footprints: [rect] };
}

/** 注册到 MODEL_BUILDERS（templeGroup 由 landmarks.js 注入，避免循环依赖） */
export function puyangBuilders(templeGroup) {
  const wrap = (fn) => (args) => fn({ ...args, templeGroup });
  return {
    qicheng: wrap(qicheng),
    xishuipo: wrap(xishuipoDragon),
    zhanghui: wrap(zhanghui),
    pyChenghuang: wrap(pyChenghuang),
    shuixiu: wrap(shuixiu),
    fanLotus: wrap(fanLotus),
    jiangjundu: wrap(jiangjunduBridge),
  };
}

/** 各模型需要剔除的 OSM / 补充建筑（局部坐标多边形或圆） */
export function puyangExclusions(id, frame) {
  const poly = (ring, grow = 0) => {
    const pts = ring.map(([lo, la]) => {
      const p = frame.toLocal(lo, la);
      return [p.x, p.z];
    });
    if (!grow) return { poly: pts };
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return { poly: pts.map(([x, z]) => [cx + (x - cx) * (1 + grow), cz + (z - cz) * (1 + grow)]) };
  };
  const circle = ([lo, la], r) => {
    const p = frame.toLocal(lo, la);
    return { x: p.x, z: p.z, r };
  };
  switch (id) {
    case 'qicheng':
      return [poly(PY_GEO.qicheng.poly)];
    case 'pyChenghuang':
      return [poly(PY_GEO.pyChenghuang.poly, 0.35)];
    case 'zhanghui':
      return [poly(PY_GEO.zhangshi.poly, 0.1)];
    case 'shuixiu':
      return [poly(PY_GEO.shuixiu.ring, 0.05)];
    case 'fanLotus':
      return [poly(PY_GEO.lotus.poly)];
    case 'xishuipo':
      return [circle(PY_GEO.xishuipo.plaza, 42)];
    default:
      return [];
  }
}
