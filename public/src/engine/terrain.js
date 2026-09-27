// 地形 + 卫星影像四叉树 LOD：按屏幕空间误差细分瓦片，影像/高程流式加载，裙边遮缝。
import * as THREE from 'three';
import { tileBounds } from '../core/geo.js';

const ROOT_Z = 8;
const DEM_Z = 13; // Terrarium z13 ≈ 16 m/像素，城市尺度足够
const SKIRT = 1;

/** 256×256 Terrarium PNG → Float32 高程 */
async function decodeDem(blob) {
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const out = new Float32Array(cv.width * cv.height);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = px[j] * 256 + px[j + 1] + px[j + 2] / 256 - 32768;
  // 轻度平滑：Terrarium 在城区混有建筑表面（DSM），3×3 均值压掉尖刺
  const w = cv.width;
  const sm = new Float32Array(out.length);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= w) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          s += out[yy * w + xx];
          n++;
        }
      }
      sm[y * w + x] = s / n;
    }
  }
  return { size: w, h: sm };
}

function sampleDem(dem, u, v) {
  // u,v ∈ [0,1]，像素中心对齐的双线性插值
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
  const a = h[y0 * n + x0] * (1 - tx) + h[y0 * n + x1] * tx;
  const b = h[y1 * n + x0] * (1 - tx) + h[y1 * n + x1] * tx;
  return a * (1 - ty) + b * ty;
}

class Tile {
  constructor(engine, z, x, y, parent) {
    this.engine = engine;
    this.z = z;
    this.x = x;
    this.y = y;
    this.key = `${z}/${x}/${y}`;
    this.parent = parent;
    this.children = null;
    this.rect = engine.frame.tileRect(z, x, y);
    this.size = this.rect.size;
    this.center = new THREE.Vector3((this.rect.x0 + this.rect.x1) / 2, 0, (this.rect.z0 + this.rect.z1) / 2);
    this.minH = parent ? parent.minH : 0;
    this.maxH = parent ? parent.maxH : 200;
    this.state = 'new'; // new → loading → ready | failed
    this.mesh = null;
    this.texture = null;
    this.noSplit = false;
    this.lastUsed = 0;
    this.box = new THREE.Box3();
    this.updateBox();
  }
  updateBox() {
    this.box.min.set(this.rect.x0, this.minH - 5, this.rect.z0);
    this.box.max.set(this.rect.x1, this.maxH + 5, this.rect.z1);
  }
  get ready() {
    return this.state === 'ready';
  }
  split() {
    if (this.children) return this.children;
    const z = this.z + 1;
    const x = this.x * 2;
    const y = this.y * 2;
    this.children = [new Tile(this.engine, z, x, y, this), new Tile(this.engine, z, x + 1, y, this), new Tile(this.engine, z, x, y + 1, this), new Tile(this.engine, z, x + 1, y + 1, this)];
    return this.children;
  }
  disposeChildren() {
    if (!this.children) return;
    for (const c of this.children) {
      c.disposeChildren();
      c.dispose();
    }
    this.children = null;
  }
  dispose() {
    this.state = 'disposed';
    if (this.mesh) {
      this.engine.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh = null;
    }
    if (this.texture) {
      this.texture.dispose();
      this.texture = null;
    }
  }
}

export class TerrainEngine {
  /**
   * @param {{scene: THREE.Scene, frame: import('../core/geo.js').LocalFrame, radius?: number}} opts
   */
  constructor({ scene, frame, radius = 220000 }) {
    this.frame = frame;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);
    this.maxZ = 18;
    this.detail = 1.0; // 屏幕空间误差系数（越大越清晰）
    this.anisotropy = 8;
    this.tint = new THREE.Color(1, 1, 1);
    // 地形材质：一半亮度来自自发光（不受阴影影响，保持卫星图原色），一半来自漫反射（接收建筑阴影）
    this.matDiffuse = new THREE.Color(0.5, 0.5, 0.5);
    this.matEmissive = new THREE.Color(0.5, 0.5, 0.5);
    this.dems = new Map(); // key → {size,h} | Promise
    this.queue = [];
    this.inflight = 0;
    this.maxInflight = 16;
    this.frameNo = 0;
    this.stats = { visible: 0, loading: 0, total: 0, maxZ: 0 };
    this.frustum = new THREE.Frustum();
    this.projScreen = new THREE.Matrix4();
    this.segIndex = new Map();
    // 根瓦片：覆盖城市周边 radius 范围
    const r0 = frame.localToTile(-radius, -radius, ROOT_Z);
    const r1 = frame.localToTile(radius, radius, ROOT_Z);
    this.roots = [];
    for (let x = r0.x; x <= r1.x; x++) for (let y = r0.y; y <= r1.y; y++) this.roots.push(new Tile(this, ROOT_Z, x, y, null));
    this.allTiles = new Set();
  }

  // ---------------------------------------------------------------- 高程
  demKey(z, x, y) {
    return `${z}/${x}/${y}`;
  }
  loadDem(z, x, y) {
    const key = this.demKey(z, x, y);
    const hit = this.dems.get(key);
    if (hit) return hit instanceof Promise ? hit : Promise.resolve(hit);
    const p = fetch(`tiles/dem/${z}/${x}/${y}`)
      .then((r) => {
        if (!r.ok) throw new Error(`dem ${r.status}`);
        return r.blob();
      })
      .then(decodeDem)
      .then((d) => {
        this.dems.set(key, d);
        return d;
      })
      .catch(() => {
        const flat = { size: 2, h: new Float32Array(4), flat: true };
        this.dems.set(key, flat);
        return flat;
      });
    this.dems.set(key, p);
    return p;
  }
  /** 找到覆盖该瓦片的高程瓦片及其子区域映射 */
  demFor(z, x, y) {
    const dz = Math.min(z, DEM_Z);
    const s = 2 ** (z - dz);
    const dx = Math.floor(x / s);
    const dy = Math.floor(y / s);
    return { dz, dx, dy, ox: (x - dx * s) / s, oy: (y - dy * s) / s, scale: 1 / s };
  }
  /** 同步取高（使用已加载的最精细高程），未加载时返回 fallback */
  heightAt(x, z, fallback = 0) {
    for (let dz = DEM_Z; dz >= 6; dz--) {
      const t = this.frame.localToTile(x, z, dz);
      const d = this.dems.get(this.demKey(dz, t.x, t.y));
      if (d && !(d instanceof Promise) && !d.flat) {
        const r = this.frame.tileRect(dz, t.x, t.y);
        return sampleDem(d, (x - r.x0) / (r.x1 - r.x0), (z - r.z0) / (r.z1 - r.z0));
      }
    }
    return fallback;
  }
  /** 确保某点所在的精细高程已加载 */
  async ensureHeight(x, z) {
    const t = this.frame.localToTile(x, z, DEM_Z);
    await this.loadDem(DEM_Z, t.x, t.y);
    return this.heightAt(x, z);
  }

  // ---------------------------------------------------------------- 网格
  segmentsFor(z) {
    return z <= 15 ? 32 : 16;
  }
  indexFor(seg) {
    if (this.segIndex.has(seg)) return this.segIndex.get(seg);
    const n = seg + 1 + 2 * SKIRT;
    const idx = [];
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const attr = new THREE.Uint16BufferAttribute(idx, 1);
    this.segIndex.set(seg, attr);
    return attr;
  }
  buildGeometry(tile, dem) {
    const seg = this.segmentsFor(tile.z);
    const n = seg + 1 + 2 * SKIRT;
    const pos = new Float32Array(n * n * 3);
    const uv = new Float32Array(n * n * 2);
    const { x0, z0, x1, z1 } = tile.rect;
    const m = this.demFor(tile.z, tile.x, tile.y);
    const skirtDrop = Math.max(8, tile.size * 0.015);
    let minH = Infinity;
    let maxH = -Infinity;
    for (let j = 0; j < n; j++) {
      const jj = Math.min(seg, Math.max(0, j - SKIRT));
      const v = jj / seg;
      for (let i = 0; i < n; i++) {
        const ii = Math.min(seg, Math.max(0, i - SKIRT));
        const u = ii / seg;
        const edge = i !== ii + SKIRT || j !== jj + SKIRT;
        let h = dem.flat ? 0 : sampleDem(dem, m.ox + u * m.scale, m.oy + v * m.scale);
        if (!edge) {
          minH = Math.min(minH, h);
          maxH = Math.max(maxH, h);
        } else h -= skirtDrop;
        const k = j * n + i;
        pos[k * 3] = x0 + (x1 - x0) * u;
        pos[k * 3 + 1] = h;
        pos[k * 3 + 2] = z0 + (z1 - z0) * v;
        uv[k * 2] = u;
        uv[k * 2 + 1] = v; // ImageBitmap 纹理不翻转，v 自上而下
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(this.indexFor(seg));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    tile.minH = minH;
    tile.maxH = maxH;
    tile.updateBox();
    return g;
  }

  async loadTile(tile) {
    tile.state = 'loading';
    this.inflight++;
    try {
      const m = this.demFor(tile.z, tile.x, tile.y);
      const demP = this.loadDem(m.dz, m.dx, m.dy);
      const res = await fetch(`tiles/img/${tile.z}/${tile.x}/${tile.y}`);
      if (tile.state === 'disposed') return;
      if (!res.ok) {
        tile.state = 'failed';
        if (tile.parent) tile.parent.noSplit = true;
        return;
      }
      const bmp = await createImageBitmap(await res.blob(), { imageOrientation: 'none' });
      const dem = await demP;
      if (tile.state === 'disposed') {
        bmp.close();
        return;
      }
      const tex = new THREE.Texture(bmp);
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.anisotropy;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      const mat = new THREE.MeshLambertMaterial({ map: tex, emissiveMap: tex, color: this.matDiffuse, emissive: this.matEmissive });
      const mesh = new THREE.Mesh(this.buildGeometry(tile, dem), mat);
      mesh.receiveShadow = tile.z >= 13;
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      mesh.renderOrder = -10 + tile.z * 0.01;
      mesh.userData.tile = tile;
      tile.mesh = mesh;
      tile.texture = tex;
      this.group.add(mesh);
      tile.state = 'ready';
    } catch (e) {
      if (tile.state !== 'disposed') tile.state = 'failed';
    } finally {
      this.inflight--;
    }
  }

  // ---------------------------------------------------------------- LOD
  /** 距离阈值：瓦片纹素 ≈ detail 倍屏幕像素时细分 */
  splitDistance(tile, camera, screenH) {
    const fov = (camera.fov * Math.PI) / 180;
    const texel = tile.size / 256;
    return (texel * screenH) / (2 * Math.tan(fov / 2)) * this.detail;
  }
  wantsSplit(tile, camPos, camera, screenH, frustum) {
    if (tile.z >= this.maxZ || tile.noSplit) return false;
    const d = tile.box.distanceToPoint(camPos);
    if (d > this.splitDistance(tile, camera, screenH)) return false;
    // 视锥外的瓦片不细分（近处除外，避免转头时大片糊）
    if (!frustum.intersectsBox(tile.box) && d > tile.size * 0.5) return false;
    return true;
  }

  /**
   * 纯计算：给定相机需要哪些瓦片（用于运镜预取）。返回 [z,x,y] 列表。
   */
  collectFor(camera, screenH, limitZ = this.maxZ) {
    camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const out = [];
    const camPos = camera.position;
    const box = new THREE.Box3();
    const walk = (z, x, y) => {
      const rect = this.frame.tileRect(z, x, y);
      const hEst = this.heightAt((rect.x0 + rect.x1) / 2, (rect.z0 + rect.z1) / 2, 100);
      box.min.set(rect.x0, hEst - 150, rect.z0);
      box.max.set(rect.x1, hEst + 150, rect.z1);
      const inView = frustum.intersectsBox(box);
      const d = box.distanceToPoint(camPos);
      if (!inView && d > rect.size * 0.5) return;
      out.push([z, x, y]);
      const texel = rect.size / 256;
      const fov = (camera.fov * Math.PI) / 180;
      const sd = ((texel * screenH) / (2 * Math.tan(fov / 2))) * this.detail;
      if (z < limitZ && d < sd) for (let i = 0; i < 4; i++) walk(z + 1, x * 2 + (i & 1), y * 2 + (i >> 1));
    };
    for (const r of this.roots) walk(r.z, r.x, r.y);
    return out;
  }

  update(camera, screenH) {
    this.frameNo++;
    camera.updateMatrixWorld();
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    const camPos = camera.position;
    const wanted = [];
    let visible = 0;
    let maxZ = 0;
    const show = (t) => {
      if (!t.mesh) return;
      t.mesh.visible = true;
      t.lastUsed = this.frameNo;
      visible++;
      maxZ = Math.max(maxZ, t.z);
    };
    const hideTree = (t) => {
      if (t.mesh) t.mesh.visible = false;
      if (t.children) for (const c of t.children) hideTree(c);
    };
    const visit = (t) => {
      t.lastUsed = this.frameNo;
      if (!t.ready) {
        if (t.state === 'new') wanted.push(t);
        return false;
      }
      if (this.wantsSplit(t, camPos, camera, screenH, this.frustum)) {
        const kids = t.split();
        for (const c of kids) {
          c.lastUsed = this.frameNo;
          if (c.state === 'new') wanted.push(c);
        }
        if (kids.every((c) => c.ready)) {
          if (t.mesh) t.mesh.visible = false;
          for (const c of kids) visit(c);
          return true;
        }
        if (kids.some((c) => c.state === 'failed')) t.noSplit = true;
        for (const c of kids) hideTree(c);
        show(t);
        return true;
      }
      if (t.children) for (const c of t.children) hideTree(c);
      show(t);
      return true;
    };
    for (const r of this.roots) visit(r);

    // 加载调度：近的、粗的优先
    for (const t of wanted) {
      t._prio = t.box.distanceToPoint(camPos) / t.size - (t.z < 12 ? 100 : 0);
    }
    wanted.sort((a, b) => a._prio - b._prio);
    for (const t of wanted) {
      if (this.inflight >= this.maxInflight) break;
      if (t.state === 'new') this.loadTile(t);
    }
    // 回收长时间未使用的子树
    if (this.frameNo % 60 === 0) this.gc();
    this.stats.visible = visible;
    this.stats.loading = this.inflight + wanted.length;
    this.stats.maxZ = maxZ;
    return this.stats;
  }

  gc() {
    const stale = this.frameNo - 300;
    const sweep = (t) => {
      if (!t.children) return;
      if (t.children.every((c) => c.lastUsed < stale)) {
        t.disposeChildren();
        return;
      }
      for (const c of t.children) sweep(c);
    };
    for (const r of this.roots) sweep(r);
  }

  /** 已就绪可见的瓦片是否覆盖了当前视野需求（用于加载进度） */
  get pending() {
    return this.stats.loading;
  }

  /**
   * 让未遮挡的平地恰好呈现 tint×影像原色：emissive + diffuse·E/π = tint，
   * 其中 E 为太阳+天空光在水平面上的辐照度。阴影处只剩 emissive + 天空光部分。
   */
  setLighting(tint, sunIrradiance, skyIrradiance, shadowShare = 0.45) {
    this.tint.copy(tint);
    const E = Math.max(0.05, sunIrradiance + skyIrradiance);
    const share = sunIrradiance > 0.2 ? shadowShare : 0;
    this.matEmissive.copy(tint).multiplyScalar(1 - share);
    this.matDiffuse.copy(tint).multiplyScalar((share * Math.PI) / E);
    this.group.traverse((o) => {
      if (o.material && o.material.emissive) {
        o.material.color.copy(this.matDiffuse);
        o.material.emissive.copy(this.matEmissive);
      }
    });
  }

  setQuality({ maxZ, detail, anisotropy }) {
    if (maxZ != null) this.maxZ = maxZ;
    if (detail != null) this.detail = detail;
    if (anisotropy != null) this.anisotropy = anisotropy;
  }

  /** 射线与地形求交（沿射线步进 + 二分），用于点击选点 */
  raycastGround(origin, dir, maxDist = 200000) {
    let t = 0;
    let step = Math.max(5, (origin.y - this.heightAt(origin.x, origin.z, 0)) * 0.05);
    let prevT = 0;
    const p = new THREE.Vector3();
    for (let i = 0; i < 400 && t < maxDist; i++) {
      p.copy(dir).multiplyScalar(t).add(origin);
      const h = this.heightAt(p.x, p.z, 0);
      if (p.y <= h) {
        let lo = prevT;
        let hi = t;
        for (let k = 0; k < 20; k++) {
          const mid = (lo + hi) / 2;
          p.copy(dir).multiplyScalar(mid).add(origin);
          if (p.y <= this.heightAt(p.x, p.z, 0)) hi = mid;
          else lo = mid;
        }
        return p.copy(dir).multiplyScalar(hi).add(origin);
      }
      prevT = t;
      t += step;
      step *= 1.04;
    }
    return null;
  }

  dispose() {
    for (const r of this.roots) {
      r.disposeChildren();
      r.dispose();
    }
    this.group.parent?.remove(this.group);
  }
}

export { sampleDem, decodeDem, ROOT_Z, DEM_Z };
