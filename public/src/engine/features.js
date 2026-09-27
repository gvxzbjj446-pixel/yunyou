// 城市要素图层（OSM 道路）：夜间路灯光网 + 近景行道树。与建筑图层同样按 z14 瓦片流式加载。
import * as THREE from 'three';
import { DEM_Z } from './terrain.js';
import { rng } from '../core/geo.js';

const Z = 14;
const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);

function glowSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,220,160,0.8)');
  g.addColorStop(1, 'rgba(255,180,90,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function treeGeometry() {
  const trunk = new THREE.CylinderGeometry(0.16, 0.22, 2.6, 5);
  trunk.translate(0, 1.3, 0);
  const crown = new THREE.IcosahedronGeometry(2.0, 1);
  {
    const p = crown.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = 0.82 + 0.3 * Math.abs(Math.sin(p.getX(i) * 3.1 + p.getZ(i) * 2.3 + p.getY(i) * 1.7));
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 1.1, p.getZ(i) * k);
    }
  }
  crown.translate(0, 4.2, 0);
  // 顶点色区分树干与树冠
  const color = (g, c) => {
    const arr = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) arr.set(c, i);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g.toNonIndexed();
  };
  const parts = [color(trunk, [0.3, 0.23, 0.17]), color(crown, [0.2, 0.3, 0.13])];
  const merged = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const arrs = parts.map((p) => p.attributes[name].array);
    const total = arrs.reduce((s, a) => s + a.length, 0);
    const out = new Float32Array(total);
    let off = 0;
    for (const a of arrs) {
      out.set(a, off);
      off += a.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(out, 3));
  }
  return merged;
}

export class FeatureLayer {
  constructor({ scene, frame, terrain, blocked = null }) {
    this.blocked = blocked; // (x, z) → 该点是否在建筑内
    this.frame = frame;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'features';
    scene.add(this.group);
    this.tiles = new Map();
    this.inflight = 0;
    this.night = 0;
    this.lampMat = new THREE.PointsMaterial({ size: 9, map: glowSprite(), color: 0xffc27a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, opacity: 0, fog: true });
    this.roadMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.treeGeo = treeGeometry();
    this.treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    this.stats = { tiles: 0, loading: 0 };
    this.radius = 3200;
    this.treeRadius = 900;
  }

  setNight(n) {
    this.night = n;
    this.lampMat.opacity = Math.min(1, n * 1.3);
    this.roadMat.opacity = n * 0.8;
    for (const t of this.tiles.values()) {
      if (t.lamps) t.lamps.visible = n > 0.02;
      if (t.lines) t.lines.visible = n > 0.02;
    }
  }

  update(camera) {
    const g = this.terrain.heightAt(camera.position.x, camera.position.z, 100);
    const alt = camera.position.y - g;
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const f = camera.position.clone();
    if (dir.y < -0.05) f.addScaledVector(dir, Math.min(alt / -dir.y, 4000) * 0.6);
    // 夜间高空时扩大范围（路灯网是夜景主体）；白天只在低空加载（行道树）
    const wantLights = this.night > 0.02;
    const R = wantLights ? THREE.MathUtils.clamp(alt * 2.2, 2500, 9000) : alt < 200 ? this.treeRadius : 0;
    const need = [];
    if (R > 0) {
      const a = this.frame.localToTile(f.x - R, f.z - R, Z);
      const b = this.frame.localToTile(f.x + R, f.z + R, Z);
      for (let x = a.x; x <= b.x; x++) {
        for (let y = a.y; y <= b.y; y++) {
          const key = `${x}/${y}`;
          const t = this.tiles.get(key);
          if (t) {
            t.seen = performance.now();
            continue;
          }
          const r = this.frame.tileRect(Z, x, y);
          const d = Math.hypot(Math.max(r.x0 - f.x, 0, f.x - r.x1), Math.max(r.z0 - f.z, 0, f.z - r.z1));
          if (d < R) need.push({ key, x, y, d });
        }
      }
    }
    need.sort((p, q) => p.d - q.d);
    for (const n of need) {
      if (this.inflight >= 2) break;
      this.load(n.key, n.x, n.y);
    }
    // 行道树只在街面附近显示（高空时卫星图本身已有树冠）
    const showTrees = alt < 160;
    for (const [key, t] of this.tiles) {
      if (t.trees) t.trees.visible = showTrees;
      if (performance.now() - t.seen > 20000 && R > 0) {
        const r = t.rect;
        const d = Math.hypot(Math.max(r.x0 - f.x, 0, f.x - r.x1), Math.max(r.z0 - f.z, 0, f.z - r.z1));
        if (d > R * 1.8) this.unload(key);
      }
    }
    this.stats.tiles = this.tiles.size;
    this.stats.loading = this.inflight;
  }

  async load(key, x, y) {
    const tile = { key, rect: this.frame.tileRect(Z, x, y), seen: performance.now() };
    this.tiles.set(key, tile);
    this.inflight++;
    try {
      const s = 2 ** (Z - DEM_Z);
      await this.terrain.loadDem(DEM_Z, Math.floor(x / s), Math.floor(y / s));
      const res = await fetch(`api/osm/features/${Z}/${x}/${y}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (this.tiles.get(key) !== tile) return;
      this.build(tile, data, x * 73856093 ^ y * 19349663);
    } catch (e) {
      tile.failed = true;
      setTimeout(() => this.tiles.get(key) === tile && this.tiles.delete(key), 60000);
    } finally {
      this.inflight--;
    }
  }

  build(tile, data, seed) {
    const lamp = [];
    const line = [];
    const lineCol = [];
    const trees = [];
    const treeCells = new Set();
    const rand = rng(seed >>> 0);
    const h = (x, z) => this.terrain.heightAt(x, z, 100);
    for (const r of data.roads || []) {
      if (r.br) continue;
      const pts = [];
      for (let i = 0; i < r.p.length; i += 2) {
        const p = this.frame.toLocal(r.p[i], r.p[i + 1]);
        pts.push([p.x, p.z]);
      }
      const major = MAJOR.has(r.k);
      const spacing = major ? 32 : 45;
      let carry = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i];
        const [bx, bz] = pts[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.5) continue;
        const ux = (bx - ax) / len;
        const uz = (bz - az) / len;
        line.push(ax, h(ax, az) + 1.2, az, bx, h(bx, bz) + 1.2, bz);
        // 按道路等级区分亮度：快速路/主干道暖白偏亮，支路昏暗
        const k = { motorway: 0.75, trunk: 0.75, primary: 0.6, secondary: 0.42, tertiary: 0.3 }[r.k] ?? 0.14;
        lineCol.push(k, k * 0.62, k * 0.3, k, k * 0.62, k * 0.3);
        const off = r.w / 2 + 1.5;
        for (let d = carry; d < len; d += spacing) {
          const px = ax + ux * d;
          const pz = az + uz * d;
          const gy = h(px, pz);
          for (const side of major ? [-1, 1] : [1]) lamp.push(px - uz * off * side, gy + 9, pz + ux * off * side);
        }
        // 行道树：主次干道两侧，约 9 m 一棵
        if (major || r.k === 'residential') {
          for (let d = rand() * 12; d < len; d += 11 + rand() * 4) {
            const px = ax + ux * d;
            const pz = az + uz * d;
            for (const side of [-1, 1]) {
              const o = off + 1.2 + rand() * 0.8;
              const tx = px - uz * o * side;
              const tz = pz + ux * o * side;
              // 双向分幅道路在 OSM 里是两条线，用 7 m 网格去重，避免重复成排
              const cell = `${Math.round(tx / 7)},${Math.round(tz / 7)}`;
              if (treeCells.has(cell) || this.blocked?.(tx, tz)) continue;
              treeCells.add(cell);
              trees.push(tx, tz, 0.7 + rand() * 0.45, rand() * Math.PI * 2);
            }
          }
        }
        carry = (carry + spacing - (len % spacing)) % spacing;
      }
    }
    if (lamp.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(lamp, 3));
      tile.lamps = new THREE.Points(g, this.lampMat);
      tile.lamps.visible = this.night > 0.02;
      tile.lamps.frustumCulled = true;
      g.computeBoundingSphere();
      this.group.add(tile.lamps);
    }
    if (line.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(line, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(lineCol, 3));
      g.computeBoundingSphere();
      tile.lines = new THREE.LineSegments(g, this.roadMat);
      tile.lines.visible = this.night > 0.02;
      this.group.add(tile.lines);
    }
    if (trees.length) {
      const n = trees.length / 4;
      const inst = new THREE.InstancedMesh(this.treeGeo, this.treeMat, n);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      const p = new THREE.Vector3();
      const col = new THREE.Color();
      for (let i = 0; i < n; i++) {
        const [x, z, sc, rot] = trees.slice(i * 4, i * 4 + 4);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
        s.setScalar(sc);
        p.set(x, h(x, z) - 0.1, z);
        m.compose(p, q, s);
        inst.setMatrixAt(i, m);
        col.setHSL(0.2 + rand() * 0.1, 0.25 + rand() * 0.2, 0.7 + rand() * 0.4);
        inst.setColorAt(i, col);
      }
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.computeBoundingSphere();
      inst.visible = false;
      tile.trees = inst;
      this.group.add(inst);
    }
  }

  unload(key) {
    const t = this.tiles.get(key);
    if (!t) return;
    for (const o of [t.lamps, t.lines, t.trees]) {
      if (!o) continue;
      this.group.remove(o);
      o.geometry !== this.treeGeo && o.geometry.dispose();
      if (o.isInstancedMesh) o.dispose();
    }
    this.tiles.delete(key);
  }

  dispose() {
    for (const k of [...this.tiles.keys()]) this.unload(k);
    this.group.parent?.remove(this.group);
  }
}
