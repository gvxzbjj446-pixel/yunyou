// 场景总装：渲染器、相机、大气、地形、建筑、地标、后期；负责每帧驱动与画质切换。
import * as THREE from 'three';
import { LocalFrame } from '../core/geo.js';
import { TerrainEngine } from './terrain.js';
import { Atmosphere } from './sky.js';
import { PostFX } from './post.js';
import { CameraRig } from './controls.js';

export const QUALITY = {
  std: { label: '标准', shadow: 1024, maxDpr: 1.25, maxZ: 18, detail: 0.8, aniso: 4, buildRadius: 2600, texSize: 512 },
  hd: { label: '高清', shadow: 2048, maxDpr: 2, maxZ: 19, detail: 1.1, aniso: 8, buildRadius: 3600, texSize: 1024 },
  uhd: { label: '4K 超清', shadow: 4096, fixedWidth: 3840, maxZ: 19, detail: 1.35, aniso: 16, buildRadius: 5000, texSize: 2048 },
};

export class World extends EventTarget {
  constructor(canvas) {
    super();
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 1.5e6);
    this.clock = new THREE.Timer();
    this.clock.connect?.(document);
    this.qualityKey = 'hd';
    this.layers = []; // 需要每帧 update 的子系统
    this.frameListeners = new Set();
    this.post = new PostFX(this.renderer, this.scene, this.camera);
    this.maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.stats = { fps: 0, frameMs: 0 };
    this._fpsAcc = 0;
    this._fpsN = 0;
    this.paused = false;
    this.rig = new CameraRig(this.camera, this.canvas, {
      groundAt: (x, z) => this.groundAt(x, z),
      rayGround: (o, d, max) => this.raycast(o, d, max),
      collide: (from, to, r) => (this.collider ? this.collider(from, to, r) : to),
    });
    addEventListener('resize', () => this.resize());
    // 画布由 CSS 铺满视口；尺寸变化（含嵌入环境中未触发 resize 事件的情况）由 ResizeObserver 捕获
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.checkSize = () => {
      if (this.canvas.clientWidth !== this._w || this.canvas.clientHeight !== this._h) this.resize();
    };
  }

  /** 以城市中心建立局部坐标系并创建地形/大气 */
  setCity(city) {
    this.disposeCity();
    this.city = city;
    this.frame = new LocalFrame(city.center[0], city.center[1]);
    this.atmo = new Atmosphere({ scene: this.scene, renderer: this.renderer, lat: city.center[1], lon: city.center[0] });
    this.atmo.utcOffsetH = city.utcOffset ?? 8;
    this.terrain = new TerrainEngine({ scene: this.scene, frame: this.frame });
    this.applyQuality(this.qualityKey);
  }

  disposeCity() {
    for (const l of this.layers) l.dispose?.();
    this.layers = [];
    if (this.terrain) this.terrain.dispose();
    if (this.atmo) {
      this.scene.remove(this.atmo.dome, this.atmo.sun, this.atmo.sun.target, this.atmo.hemi);
      this.atmo.envRT?.dispose();
    }
    this.terrain = null;
    this.atmo = null;
  }

  /** 视线落地点（阴影与建筑加载围绕它） */
  focusPoint(cam, ground) {
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const alt = cam.position.y - ground;
    const f = cam.position.clone();
    if (dir.y < -0.05) f.addScaledVector(dir, Math.min(alt / -dir.y, 3000) * 0.6);
    else f.addScaledVector(dir, Math.min(300, alt * 3 + 60));
    return f;
  }

  addLayer(layer) {
    this.layers.push(layer);
    return layer;
  }

  groundAt(x, z) {
    let h = this.terrain ? this.terrain.heightAt(x, z, this.city?.elevation ?? 100) : 0;
    for (const l of this.layers) if (l.groundAt) h = Math.max(h, l.groundAt(x, z, h) ?? h);
    return h;
  }

  /** 射线拾取：先测场景网格（建筑/地标），再测地形 */
  raycast(origin, dir, max = 200000) {
    const rc = new THREE.Raycaster(origin, dir.clone().normalize(), 0, max);
    const targets = this.layers.flatMap((l) => (l.pickables ? l.pickables() : []));
    const hits = rc.intersectObjects(targets, true);
    const g = this.terrain?.raycastGround(origin, dir.clone().normalize(), max);
    if (hits.length && (!g || hits[0].distance < origin.distanceTo(g))) return hits[0].point.clone();
    return g;
  }

  applyQuality(key) {
    const q = QUALITY[key] || QUALITY.hd;
    this.qualityKey = key;
    this.quality = q;
    this.terrain?.setQuality({ maxZ: q.maxZ, detail: q.detail, anisotropy: Math.min(q.aniso, this.maxAniso) });
    if (this.atmo) {
      this.atmo.sun.shadow.map?.dispose();
      this.atmo.sun.shadow.map = null;
      this.atmo.sun.shadow.mapSize.set(q.shadow, q.shadow);
    }
    for (const l of this.layers) l.setQuality?.(q);
    this.resize();
    this.dispatchEvent(new CustomEvent('quality', { detail: key }));
  }

  get pixelRatio() {
    const q = this.quality || QUALITY.hd;
    if (q.fixedWidth) return q.fixedWidth / Math.max(1, this.canvas.clientWidth || innerWidth);
    return Math.min(devicePixelRatio || 1, q.maxDpr);
  }

  resize() {
    const w = Math.max(1, this.canvas.clientWidth || innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || innerHeight);
    this._w = w;
    this._h = h;
    const pr = this.pixelRatio;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.setSize(w, h, pr);
  }

  get screenH() {
    return (this._h || innerHeight) * this.pixelRatio;
  }

  onFrame(fn) {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  start() {
    this._lastRaf = performance.now();
    const loop = () => {
      requestAnimationFrame(loop);
      this._lastRaf = performance.now();
      if (this.paused) return;
      this.clock.update();
      this.tick(this.clock.getDelta());
    };
    loop();
    // 看门狗：页面可见但 rAF 被宿主暂停时（如嵌入面板被隐藏），用定时器继续驱动
    setInterval(() => {
      if (this.paused || document.visibilityState !== 'visible') return;
      if (performance.now() - this._lastRaf > 300) {
        this.clock.update();
        this.tick(this.clock.getDelta());
      }
    }, 66);
  }

  /**
   * 开发自检：不依赖 rAF 手动推进帧，直到瓦片/建筑加载完成或超时。
   * 用 MessageChannel 让出事件循环（后台页的定时器会被限流到 1Hz）。
   */
  async settle(maxMs = 20000, dt = 1 / 30, minFrames = 10) {
    const mc = new MessageChannel();
    const yieldNow = () => new Promise((r) => ((mc.port1.onmessage = () => r()), mc.port2.postMessage(0)));
    const t0 = performance.now();
    let frames = 0;
    let quiet = 0;
    while (performance.now() - t0 < maxMs) {
      this.tick(dt);
      frames++;
      const busy = (this.terrain?.pending || 0) + this.layers.reduce((s, l) => s + (l.stats?.loading || 0), 0);
      quiet = busy === 0 ? quiet + 1 : 0;
      if (frames >= minFrames && quiet > 5) break;
      // 只用 MessageChannel 让出：后台页的 setTimeout 可能被节流到每分钟一次
      const until = performance.now() + 25;
      do await yieldNow();
      while (performance.now() < until);
    }
    return { frames, ms: Math.round(performance.now() - t0), terrain: { ...this.terrain?.stats } };
  }

  /** 开发自检：渲染当前帧并上传 PNG 到本地服务（cache/snaps/<name>.png） */
  async snapshot(name = 'snap') {
    this.post.render(0);
    const blob = await new Promise((res) => this.canvas.toBlob(res, 'image/png'));
    const r = await fetch(`__snap/${encodeURIComponent(name)}`, { method: 'POST', body: blob });
    return r.ok ? `cache/snaps/${name}.png` : `failed ${r.status}`;
  }

  tick(dt) {
    dt = Math.min(dt, 0.1);
    if (!this.terrain) {
      this.renderer.clear();
      return;
    }
    const t0 = performance.now();
    this.checkSize();
    this.rig.update(dt);
    for (const fn of this.frameListeners) fn(dt);
    const cam = this.camera;
    const ground = this.groundAt(cam.position.x, cam.position.z);
    const alt = Math.max(0.5, cam.position.y - ground);
    // 近裁剪面随高度调整（对数深度下仍有助于近处精度）
    cam.near = THREE.MathUtils.clamp(alt * 0.05, 0.1, 50);
    cam.far = 1.5e6;
    cam.updateProjectionMatrix();
    this.atmo.update(cam, dt, ground, this.focusPoint(cam, ground));
    this.terrain.update(cam, this.screenH);
    for (const l of this.layers) l.update?.(cam, dt, this);
    this.post.render(dt);
    const ms = performance.now() - t0;
    this._fpsAcc += dt;
    this._fpsN++;
    if (this._fpsAcc > 1) {
      this.stats.fps = Math.round(this._fpsN / this._fpsAcc);
      this.stats.frameMs = ms;
      this._fpsAcc = 0;
      this._fpsN = 0;
    }
  }

  /** 设置时间（小时）并联动灯光/地形色调/后期风格 */
  setTime(hours) {
    this.atmo.setTime(hours);
    const irr = this.atmo.irradiance;
    this.terrain.setLighting(this.atmo.tint, irr.sun, irr.sky);
    for (const l of this.layers) l.setNight?.(this.atmo.night, this.atmo);
    this.post.setLook({ night: this.atmo.night, cinematic: this.cinematic, warmth: this.atmo.elevation < 12 && this.atmo.elevation > -3 ? 0.6 : 0 });
    this.atmo.updateEnvironment();
  }

  /** 按任意分辨率离屏渲染一帧并导出 PNG（4K 截图） */
  async capture(width = 3840, height = 2160) {
    const r = this.renderer;
    const prevPR = r.getPixelRatio();
    const prevSize = r.getSize(new THREE.Vector2());
    const aspect = this.camera.aspect;
    r.setPixelRatio(1);
    r.setSize(width, height, false);
    this.post.setSize(width, height, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // 用 4K 屏幕高度多跑几帧 LOD，等待高清瓦片
    const t0 = performance.now();
    for (let i = 0; performance.now() - t0 < 15000; i++) {
      this.terrain.update(this.camera, height);
      for (const l of this.layers) l.update?.(this.camera, 0, this);
      if (this.terrain.pending === 0 && i > 3) break;
      await new Promise((res) => setTimeout(res, 120));
    }
    this.post.render(0);
    const blob = await new Promise((res) => this.canvas.toBlob(res, 'image/png'));
    r.setPixelRatio(prevPR);
    r.setSize(prevSize.x, prevSize.y, false);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.resize();
    return blob;
  }
}
