// 建模工具：程序化贴图 + 常用几何（多边形棱柱、飞檐、庑殿顶、宝塔、旋转体、夯土墙）。
// 坐标约定：x 向东、z 向南、y 向上；轮廓用（东, 北）二维点且逆时针。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from '../core/geo.js';
import { signedArea } from '../core/poly.js';

export const EN = (e, n) => [e, n];

// ---------------------------------------------------------------- 贴图
export function canvasTexture(w, h, draw, { srgb = true, repeat = [1, 1], aniso = 8 } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  return t;
}

function speckle(ctx, w, h, amount, seed, alpha = 0.08) {
  const r = rng(seed);
  for (let i = 0; i < amount; i++) {
    const v = Math.floor(r() * 255);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * r()})`;
    ctx.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
  }
}

export class Kit {
  constructor(aniso = 8) {
    this.aniso = aniso;
    this.cache = new Map();
    this.nightMats = []; // {mat, color, intensity}
    this.timeUniform = { value: 0 };
    this.nightUniform = { value: 0 };
  }
  once(key, fn) {
    if (!this.cache.has(key)) this.cache.set(key, fn());
    return this.cache.get(key);
  }
  /** 夜间自发光材质登记：setNight 时按强度点亮 */
  glow(mat, intensity = 1) {
    this.nightMats.push({ mat, intensity });
    return mat;
  }
  setNight(n) {
    this.nightUniform.value = n;
    for (const { mat, intensity } of this.nightMats) mat.emissiveIntensity = n * intensity;
  }

  // ------ 常用材质 ------
  std(key, params) {
    return this.once(`std:${key}`, () => new THREE.MeshStandardMaterial(params));
  }
  glazedTiles(color = '#2f7d4f', key = 'green') {
    return this.once(`tiles:${key}`, () => {
      const map = canvasTexture(256, 256, (x, w, h) => {
        const base = new THREE.Color(color);
        x.fillStyle = base.getStyle();
        x.fillRect(0, 0, w, h);
        const cols = 8;
        for (let i = 0; i < cols; i++) {
          const g = x.createLinearGradient((i * w) / cols, 0, ((i + 1) * w) / cols, 0);
          g.addColorStop(0, base.clone().multiplyScalar(0.55).getStyle());
          g.addColorStop(0.5, base.clone().lerp(new THREE.Color('#ffffff'), 0.25).getStyle());
          g.addColorStop(1, base.clone().multiplyScalar(0.6).getStyle());
          x.fillStyle = g;
          x.fillRect((i * w) / cols, 0, w / cols, h);
        }
        x.fillStyle = 'rgba(0,0,0,0.25)';
        for (let j = 0; j < 8; j++) x.fillRect(0, (j * h) / 8, w, 3);
        speckle(x, w, h, 900, 3, 0.1);
      }, { aniso: this.aniso });
      return new THREE.MeshStandardMaterial({ map, roughness: 0.35, metalness: 0.05, side: THREE.DoubleSide, envMapIntensity: 1.2 });
    });
  }
  hallWall(color = '#9b2f25', key = 'red') {
    return this.once(`hallwall:${key}`, () => {
      const map = canvasTexture(256, 128, (x, w, h) => {
        x.fillStyle = color;
        x.fillRect(0, 0, w, h);
        // 柱子与格扇门窗
        for (let i = 0; i < 4; i++) {
          const cx = (i * w) / 4;
          x.fillStyle = new THREE.Color(color).multiplyScalar(0.7).getStyle();
          x.fillRect(cx, 0, w * 0.04, h);
          x.fillStyle = '#3b2418';
          x.fillRect(cx + w * 0.07, h * 0.2, w * 0.15, h * 0.7);
          x.strokeStyle = 'rgba(210,170,90,0.55)';
          x.lineWidth = 1;
          for (let k = 0; k < 6; k++) {
            x.beginPath();
            x.moveTo(cx + w * 0.07, h * (0.22 + k * 0.1));
            x.lineTo(cx + w * 0.22, h * (0.22 + k * 0.1));
            x.stroke();
          }
        }
        // 额枋彩画
        x.fillStyle = '#23527a';
        x.fillRect(0, 0, w, h * 0.12);
        x.fillStyle = '#c9a74a';
        x.fillRect(0, h * 0.12, w, h * 0.03);
        speckle(x, w, h, 600, 9, 0.08);
      }, { aniso: this.aniso });
      return new THREE.MeshStandardMaterial({ map, roughness: 0.8 });
    });
  }
  stone(color = '#c9c2b4', key = 'light') {
    return this.once(`stone:${key}`, () => {
      const map = canvasTexture(256, 256, (x, w, h) => {
        x.fillStyle = color;
        x.fillRect(0, 0, w, h);
        speckle(x, w, h, 4000, 11, 0.12);
        x.strokeStyle = 'rgba(0,0,0,0.12)';
        for (let j = 0; j < 4; j++) {
          x.beginPath();
          x.moveTo(0, (j * h) / 4);
          x.lineTo(w, (j * h) / 4);
          x.stroke();
        }
      }, { aniso: this.aniso });
      return new THREE.MeshStandardMaterial({ map, roughness: 0.9 });
    });
  }
  rock(key = 'granite', color = '#a39a8a') {
    return this.once(`rock:${key}`, () => {
      const map = canvasTexture(512, 512, (x, w, h) => {
        x.fillStyle = color;
        x.fillRect(0, 0, w, h);
        const r = rng(21);
        for (let i = 0; i < 260; i++) {
          x.fillStyle = `rgba(${60 + r() * 60},${55 + r() * 50},${45 + r() * 40},${0.05 + r() * 0.12})`;
          x.beginPath();
          x.ellipse(r() * w, r() * h, 4 + r() * 40, 2 + r() * 14, r() * 3, 0, Math.PI * 2);
          x.fill();
        }
        speckle(x, w, h, 12000, 5, 0.18);
      }, { aniso: this.aniso });
      return new THREE.MeshStandardMaterial({ map, roughness: 0.95, color: 0xffffff });
    });
  }
  earth() {
    return this.once('earth', () => {
      const map = canvasTexture(256, 256, (x, w, h) => {
        x.fillStyle = '#8a7556';
        x.fillRect(0, 0, w, h);
        // 夯土层理
        for (let j = 0; j < 16; j++) {
          x.fillStyle = `rgba(${j % 2 ? 70 : 150},${j % 2 ? 58 : 128},${j % 2 ? 40 : 95},0.18)`;
          x.fillRect(0, (j * h) / 16, w, h / 32);
        }
        speckle(x, w, h, 5000, 17, 0.15);
      }, { aniso: this.aniso });
      return new THREE.MeshStandardMaterial({ map, roughness: 1 });
    });
  }
  grass() {
    return this.once('grass', () => {
      const map = canvasTexture(256, 256, (x, w, h) => {
        x.fillStyle = '#5f7a3f';
        x.fillRect(0, 0, w, h);
        const r = rng(4);
        for (let i = 0; i < 3000; i++) {
          x.fillStyle = `rgba(${60 + r() * 60},${90 + r() * 60},${30 + r() * 30},0.35)`;
          x.fillRect(r() * w, r() * h, 1, 2 + r() * 3);
        }
      }, { aniso: this.aniso });
      return new THREE.MeshStandardMaterial({ map, roughness: 1 });
    });
  }
  glass(key = 'blue', color = '#6d8ea3', opts = {}) {
    return this.once(`glass:${key}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.08, metalness: 0.6, envMapIntensity: 1.6, emissive: new THREE.Color(opts.night || '#ffd9a0'), emissiveIntensity: 0, ...opts.params }));
  }
  metal(key = 'steel', color = '#b9bec4', rough = 0.35) {
    return this.once(`metal:${key}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.85, envMapIntensity: 1.3 }));
  }
  paint(color, key = color, rough = 0.7) {
    return this.once(`paint:${key}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough }));
  }
}

// ---------------------------------------------------------------- 几何
export function ensureCCW(ring) {
  return signedArea(ring) < 0 ? ring.slice().reverse() : ring;
}

/**
 * 多边形棱柱。uvMode='face'：每个立面 u∈[0,1]；'run'：u 按周长米数 / uScale；v = 高度 / vScale。
 */
export function prism(ring, y0, y1, { uvMode = 'run', uScale = 4, vScale = 4, top = true, bottom = false } = {}) {
  ring = ensureCCW(ring);
  const pos = [];
  const uv = [];
  const idx = [];
  let run = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [ae, an] = ring[i];
    const [be, bn] = ring[(i + 1) % n];
    const len = Math.hypot(be - ae, bn - an);
    const u0 = uvMode === 'face' ? 0 : run / uScale;
    const u1 = uvMode === 'face' ? 1 : (run + len) / uScale;
    const b = pos.length / 3;
    pos.push(ae, y0, -an, be, y0, -bn, be, y1, -bn, ae, y1, -an);
    uv.push(u0, y0 / vScale, u1, y0 / vScale, u1, y1 / vScale, u0, y1 / vScale);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    run += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const parts = [g.toNonIndexed()];
  if (top) parts.push(cap(ring, y1, true));
  if (bottom) parts.push(cap(ring, y0, false));
  const m = mergeGeometries(
    parts.map((p) => {
      const q = p.index ? p.toNonIndexed() : p;
      q.deleteAttribute('normal');
      return q;
    }),
  );
  m.computeVertexNormals();
  return m;
}

export function cap(ring, y, up = true) {
  ring = ensureCCW(ring);
  const tris = THREE.ShapeUtils.triangulateShape(ring.map(([e, n]) => new THREE.Vector2(e, n)), []);
  const pos = [];
  const uv = [];
  for (const t of tris) {
    const [a, b, c] = t.map((i) => ring[i]);
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const order = (cross > 0) === up ? [a, b, c] : [a, c, b];
    for (const [e, n] of order) {
      pos.push(e, y, -n);
      uv.push(e / 10, n / 10);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** 顶点处外扩方向（斜接），凹角自动内收 */
function miter(ring, i, d) {
  const n = ring.length;
  const p = ring[(i - 1 + n) % n];
  const c = ring[i];
  const q = ring[(i + 1) % n];
  const n1 = norm([c[1] - p[1], -(c[0] - p[0])]);
  const n2 = norm([q[1] - c[1], -(q[0] - c[0])]);
  const m = norm([n1[0] + n2[0], n1[1] + n2[1]]);
  const k = Math.max(0.35, m[0] * n1[0] + m[1] * n1[1]);
  // 逆时针环：转向为左（叉积>0）即凸角
  const convex = (c[0] - p[0]) * (q[1] - c[1]) - (c[1] - p[1]) * (q[0] - c[0]) > 1e-9;
  return { off: [c[0] + (m[0] * d) / k, c[1] + (m[1] * d) / k], convex };
}
function norm(v) {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

/** 飞檐：从墙顶向外下斜的屋面环，凸角起翘；外沿加一条朱红封檐板 */
export function eave(ring, y, { overhang = 1.2, drop = 0.9, lift = 0.5, fascia = 0.25 } = {}) {
  ring = ensureCCW(ring);
  const n = ring.length;
  const outer = ring.map((_, i) => miter(ring, i, overhang));
  const pos = [];
  const uv = [];
  const fpos = [];
  let run = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = ring[i];
    const b = ring[j];
    const A = outer[i];
    const B = outer[j];
    const yA = y - drop + (A.convex ? lift : 0);
    const yB = y - drop + (B.convex ? lift : 0);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // 两个三角形：内沿(a,b) 外沿(A,B)
    pos.push(a[0], y, -a[1], A.off[0], yA, -A.off[1], B.off[0], yB, -B.off[1]);
    pos.push(a[0], y, -a[1], B.off[0], yB, -B.off[1], b[0], y, -b[1]);
    const u0 = run / 2;
    const u1 = (run + len) / 2;
    uv.push(u0, 1, u0, 0, u1, 0, u0, 1, u1, 0, u1, 1);
    run += len;
    if (fascia) {
      fpos.push(A.off[0], yA, -A.off[1], A.off[0], yA - fascia, -A.off[1], B.off[0], yB - fascia, -B.off[1]);
      fpos.push(A.off[0], yA, -A.off[1], B.off[0], yB - fascia, -B.off[1], B.off[0], yB, -B.off[1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const f = new THREE.BufferGeometry();
  f.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3));
  f.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((fpos.length / 3) * 2).fill(0), 2));
  f.computeVertexNormals();
  return { roof: g, fascia: f };
}

/**
 * 中式庑殿顶（凹曲面 + 翼角起翘），底面中心在原点，长边沿 x。
 * W、D 为檐口外沿尺寸，H 为举高。
 */
export function hipRoof(W, D, H, { lift = 0.9, segs = 8, ridgeRatio = null } = {}) {
  const R = ridgeRatio != null ? W * ridgeRatio : Math.max(0.1, W - D * 0.9);
  const f = (s) => Math.pow(s, 1.7); // 凹曲线：檐口缓、脊部陡
  const corner = (u) => {
    const k = Math.max(0, Math.abs(2 * u - 1) - 0.55) / 0.45;
    return k * k;
  };
  const pos = [];
  const uv = [];
  const quadFace = (eave0, eave1, top0, top1, eaveLen, slopeLen) => {
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < segs; j++) {
        const pts = [
          [i / segs, j / segs],
          [(i + 1) / segs, j / segs],
          [(i + 1) / segs, (j + 1) / segs],
          [i / segs, (j + 1) / segs],
        ].map(([u, s]) => {
          const ex = eave0[0] + (eave1[0] - eave0[0]) * u;
          const ez = eave0[1] + (eave1[1] - eave0[1]) * u;
          const tx = top0[0] + (top1[0] - top0[0]) * u;
          const tz = top0[1] + (top1[1] - top0[1]) * u;
          const x = ex + (tx - ex) * s;
          const z = ez + (tz - ez) * s;
          const y = H * f(s) + lift * corner(u) * (1 - s) * (1 - s);
          return [x, y, z, (u * eaveLen) / 1.2, (s * slopeLen) / 1.2];
        });
        for (const k of [0, 1, 2, 0, 2, 3]) {
          pos.push(pts[k][0], pts[k][1], pts[k][2]);
          uv.push(pts[k][3], pts[k][4]);
        }
      }
    }
  };
  const hw = W / 2;
  const hd = D / 2;
  const hr = R / 2;
  const slope = Math.hypot(hd, H);
  // 南坡（+z）与北坡：檐口从西到东，脊从西到东
  quadFace([-hw, hd], [hw, hd], [-hr, 0], [hr, 0], W, slope);
  quadFace([hw, -hd], [-hw, -hd], [hr, 0], [-hr, 0], W, slope);
  // 东西两端三角坡
  quadFace([hw, hd], [hw, -hd], [hr, 0], [hr, 0], D, Math.hypot(hw - hr, H));
  quadFace([-hw, -hd], [-hw, hd], [-hr, 0], [-hr, 0], D, Math.hypot(hw - hr, H));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return { geo: g, ridge: R };
}

/**
 * 中式殿堂：台基 + 殿身 + 庑殿顶（可重檐）+ 正脊。
 */
export function hall(kit, { w, d, h = 5, podium = 1, roofH = null, eaveOut = 1.6, double = false, wall = 'red', tiles = 'gray', ridgeColor = '#4a4d52' }) {
  const g = new THREE.Group();
  const tileMat = tiles === 'gray' ? kit.glazedTiles('#5d6267', 'gray') : tiles === 'yellow' ? kit.glazedTiles('#c8952b', 'yellow') : kit.glazedTiles('#2f7d4f', 'green');
  const wallMat = kit.hallWall(wall === 'red' ? '#962d22' : '#8a3b2a', wall);
  const pod = new THREE.Mesh(new THREE.BoxGeometry(w + 2.4, podium, d + 2.4), kit.stone('#bdb5a6', 'podium'));
  pod.position.y = podium / 2;
  g.add(pod);
  const bodyGeo = new THREE.BoxGeometry(w, h, d);
  // 按米数设置 UV，保证格扇比例
  const uvA = bodyGeo.attributes.uv;
  const p = bodyGeo.attributes.position;
  for (let i = 0; i < uvA.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const y = p.getY(i);
    const horiz = Math.abs(Math.abs(x) - w / 2) < 1e-3 ? z : x;
    uvA.setXY(i, horiz / 4, (y + h / 2) / h);
  }
  const body = new THREE.Mesh(bodyGeo, wallMat);
  body.position.y = podium + h / 2;
  g.add(body);
  const rh = roofH ?? Math.min(w, d) * 0.42;
  const addRoof = (y, W, D, H) => {
    const { geo, ridge } = hipRoof(W, D, H, { lift: Math.min(1.4, D * 0.07) });
    const r = new THREE.Mesh(geo, tileMat);
    r.position.y = y;
    g.add(r);
    const rg = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.6, ridge + 0.6), Math.max(0.35, D * 0.035), 0.5), kit.paint(ridgeColor, `ridge-${ridgeColor}`));
    rg.position.y = y + H + 0.1;
    g.add(rg);
    // 正吻
    for (const s of [-1, 1]) {
      const cw = new THREE.Mesh(new THREE.BoxGeometry(0.5, Math.max(0.8, D * 0.06), 0.6), rg.material);
      cw.position.set((s * Math.max(0.6, ridge + 0.6)) / 2, y + H + 0.4, 0);
      g.add(cw);
    }
  };
  const top = podium + h;
  if (double) {
    addRoof(top - h * 0.35, w + eaveOut * 2 + 1.5, d + eaveOut * 2 + 1.5, rh * 0.3);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(w * 0.82, h * 0.45, d * 0.78), wallMat);
    upper.position.y = top + h * 0.1;
    g.add(upper);
    addRoof(top + h * 0.3, w * 0.82 + eaveOut * 2, d * 0.78 + eaveOut * 2, rh);
  } else addRoof(top, w + eaveOut * 2, d + eaveOut * 2, rh);
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}

/** 密檐砖塔（塔林用），六角或方形 */
export function pagoda(kit, { height = 10, base = 2.4, sides = 6, levels = 7, seed = 1 }) {
  const r = rng(seed);
  const parts = [];
  const brick = r() < 0.5 ? '#a89a86' : '#b3a28a';
  const rad0 = base / 2 / Math.cos(Math.PI / sides);
  const pedestal = new THREE.CylinderGeometry(rad0 * 1.25, rad0 * 1.35, height * 0.12, sides);
  pedestal.translate(0, height * 0.06, 0);
  parts.push(pedestal);
  const bodyH = height * 0.3;
  const body = new THREE.CylinderGeometry(rad0, rad0 * 1.02, bodyH, sides);
  body.translate(0, height * 0.12 + bodyH / 2, 0);
  parts.push(body);
  let y = height * 0.12 + bodyH;
  const lh = (height * 0.48) / levels;
  for (let i = 0; i < levels; i++) {
    const k = 1 - (i / levels) * 0.45;
    const e = new THREE.CylinderGeometry(rad0 * k * 1.28, rad0 * k * 1.28, lh * 0.28, sides);
    e.translate(0, y + lh * 0.14, 0);
    parts.push(e);
    const s = new THREE.CylinderGeometry(rad0 * k * 0.92, rad0 * k * 0.95, lh * 0.72, sides);
    s.translate(0, y + lh * 0.28 + lh * 0.36, 0);
    parts.push(s);
    y += lh;
  }
  const finial = new THREE.ConeGeometry(rad0 * 0.4, height * 0.1, sides);
  finial.translate(0, y + height * 0.05, 0);
  parts.push(finial);
  const geo = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, kit.paint(brick, `pagoda-${brick}`, 0.95));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** 自定义旋转体：profile 为 [半径, 高度]；v 按真实高度 / vScale，u 绕一圈 = uRepeat */
export function lathe(profile, { segments = 96, uRepeat = 1, vScale = 1 } = {}) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let j = 0; j < profile.length; j++) {
    const [r, y] = profile[j];
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pos.push(Math.sin(a) * r, y, Math.cos(a) * r);
      uv.push((i / segments) * uRepeat, y / vScale);
    }
  }
  const row = segments + 1;
  for (let j = 0; j < profile.length - 1; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * row + i;
      const b = a + row;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 平滑轮廓：Catmull-Rom 插值 */
export function smoothProfile(pts, n = 60) {
  const curve = new THREE.SplineCurve(pts.map(([r, y]) => new THREE.Vector2(r, y)));
  return curve.getSpacedPoints(n).map((v) => [Math.max(0, v.x), v.y]);
}

/** 沿折线挤出梯形截面（夯土城墙），points 为 [x,z] 局部坐标 */
export function rampart(points, { base = 18, top = 8, height = 6, groundAt }) {
  const pos = [];
  const uv = [];
  const idx = [];
  const prof = [
    [-base / 2, 0],
    [-top / 2, height],
    [top / 2, height],
    [base / 2, 0],
  ];
  let run = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const t = norm([b[0] - a[0], b[1] - a[1]]);
    const nrm = [-t[1], t[0]];
    if (i > 0) run += Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]);
    const gy = groundAt(p[0], p[1]);
    for (const [o, y] of prof) {
      pos.push(p[0] + nrm[0] * o, gy + y - (y === 0 ? 1.5 : 0), p[1] + nrm[1] * o);
      uv.push(run / 8, (y + Math.abs(o)) / 8);
    }
  }
  for (let i = 0; i < points.length - 1; i++) {
    for (let k = 0; k < 3; k++) {
      const a = i * 4 + k;
      const b = a + 4;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 两点之间的细杆（拉索、钢管） */
export function rod(a, b, radius, radial = 6) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(radius, radius, len, radial, 1, true);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}

export function star5(outer = 1, inner = 0.4, depth = 0.3) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: depth * 0.3, bevelThickness: depth * 0.3, bevelSegments: 1 });
  g.translate(0, 0, -depth / 2);
  return g;
}

export { mergeGeometries };
