// OSM 建筑图层：按相机位置流式加载 z14 瓦片（Worker 构建网格），提供漫游碰撞与拾取。
import * as THREE from 'three';
import { FacadeLibrary } from './textures.js';
import { pointInPolygon, distToSegment } from '../core/poly.js';
import { DEM_Z } from './terrain.js';

const Z = 14;
// 服务端估高/清洗规则变更时递增，绕过浏览器缓存
export const DATA_VERSION = 7;

export class BuildingLayer {
  constructor({ scene, frame, terrain, renderer, exclusions = [] }) {
    this.frame = frame;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'buildings';
    scene.add(this.group);
    this.lib = new FacadeLibrary(renderer, 1024);
    this.tiles = new Map();
    this.exclusions = exclusions;
    this.radius = 3600;
    this.maxAltitude = 9000;
    this.workers = [];
    this.pending = new Map();
    this.jobId = 0;
    this.inflight = 0;
    this.maxInflight = 3;
    const n = Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) >> 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./buildings.worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => this.onWorker(e.data);
      this.workers.push(w);
    }
    this.nextWorker = 0;
    this.stats = { tiles: 0, buildings: 0, loading: 0 };
    this._tmp = new THREE.Vector3();
    this.enabled = true;
  }

  setQuality(q) {
    this.radius = q.buildRadius;
    if (q.texSize !== this.lib.size) {
      const old = this.lib;
      this.lib = new FacadeLibrary(old.renderer, q.texSize);
      for (const t of this.tiles.values()) if (t.meshes) this.assignMaterials(t);
      this.lib.setNight(old.nightUniform.value);
      old.dispose();
    }
  }
  setNight(n) {
    this.lib.setNight(n);
  }
  setExclusions(ex) {
    this.exclusions = ex;
  }

  assignMaterials(t) {
    for (const m of t.meshes) m.material = m.userData.style === 'roof' ? this.lib.roof : this.lib.materials[m.userData.style];
  }

  /** 视点：相机视线落地点与相机脚下点的中间位置 */
  focus(camera) {
    const dir = camera.getWorldDirection(this._tmp);
    const g = this.terrain.heightAt(camera.position.x, camera.position.z, 100);
    const alt = camera.position.y - g;
    const f = camera.position.clone();
    if (dir.y < -0.05) f.addScaledVector(dir, Math.min(alt / -dir.y, this.radius * 0.8));
    else f.addScaledVector(dir, this.radius * 0.35);
    return { x: (f.x + camera.position.x) / 2, z: (f.z + camera.position.z) / 2, alt };
  }

  update(camera) {
    if (!this.enabled) return;
    const { x, z, alt } = this.focus(camera);
    const active = alt < this.maxAltitude;
    this.group.visible = active || this.tiles.size > 0;
    // 高空俯瞰时扩大加载范围，避免只有中心一小片楼
    const R = THREE.MathUtils.clamp(alt * 1.5, this.radius, Math.max(this.radius, 7000));
    const need = [];
    if (active) {
      const t0 = this.frame.localToTile(x - R, z - R, Z);
      const t1 = this.frame.localToTile(x + R, z + R, Z);
      for (let tx = t0.x; tx <= t1.x; tx++) {
        for (let ty = t0.y; ty <= t1.y; ty++) {
          const r = this.frame.tileRect(Z, tx, ty);
          const dx = Math.max(r.x0 - x, 0, x - r.x1);
          const dz = Math.max(r.z0 - z, 0, z - r.z1);
          const d = Math.hypot(dx, dz);
          if (d > R) continue;
          const key = `${tx}/${ty}`;
          const tile = this.tiles.get(key);
          if (!tile) need.push({ key, tx, ty, d });
          else tile.lastSeen = performance.now();
        }
      }
    }
    need.sort((a, b) => a.d - b.d);
    for (const n of need) {
      if (this.inflight >= this.maxInflight) break;
      this.load(n.key, n.tx, n.ty);
    }
    // 卸载远处瓦片
    const now = performance.now();
    for (const [key, t] of this.tiles) {
      if (!t.meshes) continue;
      const r = t.rect;
      const d = Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));
      if ((d > R * 1.7 || !active) && now - t.lastSeen > 4000) this.unload(key);
    }
    // 远距离时淡化
    for (const t of this.tiles.values()) if (t.meshes) for (const m of t.meshes) m.visible = active;
    this.stats.tiles = this.tiles.size;
    this.stats.loading = this.inflight + need.length;
  }

  async load(key, tx, ty) {
    const tile = { key, tx, ty, rect: this.frame.tileRect(Z, tx, ty), lastSeen: performance.now(), meshes: null, footprints: [] };
    this.tiles.set(key, tile);
    this.inflight++;
    try {
      // 建筑落地需要该瓦片的精细高程（z14 瓦片完全落在一个 z13 高程瓦片内）
      const dz = DEM_Z;
      const s = 2 ** (Z - dz);
      const dx = Math.floor(tx / s);
      const dy = Math.floor(ty / s);
      const demData = await this.terrain.loadDem(dz, dx, dy);
      const dr = this.frame.tileRect(dz, dx, dy);
      const dem = demData.flat ? null : { h: demData.h, size: demData.size, x0: dr.x0, z0: dr.z0, x1: dr.x1, z1: dr.z1 };
      const out = await this.runWorker(new URL(`api/osm/buildings/${Z}/${tx}/${ty}?v=${DATA_VERSION}`, document.baseURI).href, { lon0: this.frame.lon0, lat0: this.frame.lat0, dem, exclusions: this.exclusions });
      if (this.tiles.get(key) !== tile) return;
      this.createMeshes(tile, out);
    } catch (e) {
      console.warn('[buildings]', key, e.message);
      tile.failed = true;
      tile.meshes = [];
      setTimeout(() => this.tiles.get(key) === tile && this.tiles.delete(key), 30000);
    } finally {
      this.inflight--;
    }
  }

  runWorker(url, opts) {
    const id = ++this.jobId;
    const w = this.workers[this.nextWorker++ % this.workers.length];
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      w.postMessage({ id, url, opts });
    });
  }
  onWorker(msg) {
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.out);
    else p.reject(new Error(msg.error));
  }

  createMeshes(tile, out) {
    const mk = (g, style) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(g.position, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(g.normal, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(g.uv, 2));
      geo.setAttribute('color', new THREE.BufferAttribute(g.color, 3));
      geo.setAttribute('aLit', new THREE.BufferAttribute(g.aLit, 1));
      geo.setIndex(new THREE.BufferAttribute(g.index, 1));
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      const mesh = new THREE.Mesh(geo, style === 'roof' ? this.lib.roof : this.lib.materials[style]);
      mesh.userData.style = style;
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `bld-${tile.key}-${style}`;
      this.group.add(mesh);
      return mesh;
    };
    tile.meshes = [];
    out.walls.forEach((g, i) => g && tile.meshes.push(mk(g, i)));
    if (out.roof) tile.meshes.push(mk(out.roof, 'roof'));
    tile.footprints = out.footprints.map((f) => {
      const ring = [];
      for (let i = 0; i < f.ring.length; i += 2) ring.push([f.ring[i], f.ring[i + 1]]);
      return { ...f, ring };
    });
    tile.count = out.count;
    this.stats.buildings = [...this.tiles.values()].reduce((s, t) => s + (t.count || 0), 0);
  }

  unload(key) {
    const t = this.tiles.get(key);
    if (!t) return;
    for (const m of t.meshes || []) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.tiles.delete(key);
  }

  /** 附近建筑轮廓（用于碰撞） */
  footprintsNear(x, z, r = 30) {
    const out = [];
    const t = this.frame.localToTile(x, z, Z);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const tile = this.tiles.get(`${t.x + dx}/${t.y + dy}`);
        if (!tile?.footprints) continue;
        for (const f of tile.footprints) if (x > f.minx - r && x < f.maxx + r && z > f.minz - r && z < f.maxz + r) out.push(f);
      }
    }
    return out;
  }

  /** 漫游碰撞：目标点落入建筑（含半径）则沿坐标轴滑动 */
  collide(from, to, radius, eyeY) {
    const blocked = (px, pz) =>
      this.footprintsNear(px, pz, radius + 2).some((f) => {
        if (eyeY != null && (eyeY > f.top + 1 || eyeY < f.bottom - 3)) return false;
        if (pointInPolygon(px, pz, f.ring)) return true;
        const r = f.ring;
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (distToSegment(px, pz, r[j][0], r[j][1], r[i][0], r[i][1]) < radius) return true;
        return false;
      });
    if (!blocked(to.x, to.z)) return to;
    if (!blocked(to.x, from.z)) return new THREE.Vector3(to.x, to.y, from.z);
    if (!blocked(from.x, to.z)) return new THREE.Vector3(from.x, to.y, to.z);
    return from.clone();
  }

  pickables() {
    return this.group.children;
  }

  /** 找出包含某点的建筑（显示名称等） */
  buildingAt(x, z) {
    return this.footprintsNear(x, z, 1).find((f) => pointInPolygon(x, z, f.ring));
  }

  dispose() {
    for (const k of [...this.tiles.keys()]) this.unload(k);
    for (const w of this.workers) w.terminate();
    this.group.parent?.remove(this.group);
    this.lib.dispose();
  }
}
