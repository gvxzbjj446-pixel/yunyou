// 电影运镜导演：把分镜脚本（路径/环绕）编译成随时间变化的相机位姿，驱动时间光影、字幕与转场。
import * as THREE from 'three';

const smooth = (t) => t * t * (3 - 2 * t);
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

export class Director extends EventTarget {
  /**
   * @param {import('./world.js').World} world
   * @param {object} city
   * @param {Map<string, {pos: THREE.Vector3, height: number}>} spots 景点锚点（已贴地）
   */
  constructor(world, city, shots, spots) {
    super();
    this.world = world;
    this.city = city;
    this.spots = spots;
    this.shots = shots.map((s, i) => this.compile(s, i));
    this.total = this.shots.reduce((s, x) => s + x.dur, 0);
    this.t = 0;
    this.playing = false;
    this.speed = 1;
    this.current = -1;
    this.lift = 0;
    this.clearance = null; // (x, z) → 该点附近最高障碍物顶面高度
    this.sightClearance = null; // (x, z, r) → 不含景点模型的最高建筑顶面（视线避障）
  }

  /** 前瞻避障：当前与未来 1.5 s 机位下方的最高楼顶；有景点的镜头再保证视线不被楼挡住 */
  neededLift(t) {
    if (!this.clearance) return 0;
    let need = 0;
    for (const dtA of [0, 0.5, 1, 1.5]) {
      const { shot, u } = this.locate(Math.min(this.total, t + dtA));
      const p = this.pose(shot, u);
      const top = this.clearance(p.pos.x, p.pos.z);
      need = Math.max(need, top + 22 - p.pos.y);
      if (shot.spot && this.sightClearance && (dtA === 0 || dtA === 1)) need = Math.max(need, this.sightLift(p.pos, p.look));
    }
    return Math.max(0, need);
  }

  /**
   * 视线避障：机位到注视点之间若有楼顶高于视线，求使视线越过楼顶（+6 m）所需的最小抬升。
   * 注视点附近（景点自身及广场）及最后 1/4 视线不计；抬升上限 220 m，避免镜头语言被彻底改变。
   */
  sightLift(pos, look) {
    const dist = Math.hypot(look.x - pos.x, look.z - pos.z);
    if (dist < 60) return 0;
    const ignore = Math.min(60, dist * 0.3);
    let need = 0;
    const n = 12;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const x = pos.x + (look.x - pos.x) * t;
      const z = pos.z + (look.z - pos.z) * t;
      // 紧挨主体的楼只造成局部前景遮挡；按 1/(1−t) 放大的抬升代价太大，只检查前 3/4 视线
      if (dist * (1 - t) < ignore || t > 0.75) break;
      const top = this.sightClearance(x, z, 4);
      if (!Number.isFinite(top)) continue;
      // 抬升后机位高度 y' 需满足 y' + (look.y - y') t ≥ top + 6
      const yNeed = (top + 6 - look.y * t) / (1 - t);
      need = Math.max(need, yNeed - pos.y);
    }
    return Math.min(220, need);
  }

  local(lon, lat, agl) {
    const p = this.world.frame.toLocal(lon, lat);
    const g = this.world.terrain.heightAt(p.x, p.z, this.city.elevation ?? 100);
    return new THREE.Vector3(p.x, g + agl, p.z);
  }

  compile(s, index) {
    const shot = { ...s, index };
    if (s.type === 'path') {
      const pts = s.pos.map(([lo, la, h]) => this.local(lo, la, h));
      shot.posCurve = pts.length > 1 ? new THREE.CatmullRomCurve3(pts, false, 'centripetal') : null;
      shot.pos0 = pts[0];
      const looks = s.look.map(([lo, la, h]) => this.local(lo, la, h));
      shot.lookCurve = looks.length > 1 ? new THREE.CatmullRomCurve3(looks, false, 'centripetal') : null;
      shot.look0 = looks[0];
    } else {
      const sp = s.spot ? this.spots.get(s.spot) : null;
      shot.center = sp ? sp.pos.clone() : this.local(s.center[0], s.center[1], 0);
      shot.lookH = sp ? sp.height * 0.38 : 0;
    }
    return shot;
  }

  /** 镜头内归一化时间 u → 相机位置与注视点 */
  pose(shot, u, out = { pos: new THREE.Vector3(), look: new THREE.Vector3() }) {
    if (shot.type === 'path') {
      const e = smooth(u) * 0.6 + u * 0.4;
      if (shot.posCurve) shot.posCurve.getPoint(e, out.pos);
      else out.pos.copy(shot.pos0);
      if (shot.lookCurve) shot.lookCurve.getPoint(e, out.look);
      else out.look.copy(shot.look0);
    } else {
      const e = smoother(u) * 0.35 + u * 0.65;
      const r = lerp(shot.radius[0], shot.radius[1], e);
      const h = lerp(shot.height[0], shot.height[1], e);
      const az = THREE.MathUtils.degToRad(lerp(shot.az[0], shot.az[1], e));
      out.pos.set(shot.center.x + Math.sin(az) * r, shot.center.y + h, shot.center.z - Math.cos(az) * r);
      out.look.set(shot.center.x, shot.center.y + shot.lookH, shot.center.z);
      // 不钻地
      const g = this.world.terrain.heightAt(out.pos.x, out.pos.z, shot.center.y) + 15;
      if (out.pos.y < g) out.pos.y = g;
    }
    return out;
  }

  /** 全片时间 → 镜头索引与镜头内进度 */
  locate(t) {
    let acc = 0;
    for (const s of this.shots) {
      if (t < acc + s.dur) return { shot: s, u: (t - acc) / s.dur, local: t - acc };
      acc += s.dur;
    }
    const last = this.shots[this.shots.length - 1];
    return { shot: last, u: 1, local: last.dur };
  }

  /** 预取清单：沿运镜采样相机，收集需要的影像/高程/建筑瓦片 */
  prefetchList({ screenH = 1080, step = 1.0, maxZ = 18, buildingRadius = 1600 } = {}) {
    const cam = this.world.camera.clone();
    cam.fov = 42;
    cam.aspect = innerWidth / innerHeight;
    cam.near = 1;
    cam.far = 1.5e6;
    cam.updateProjectionMatrix();
    const img = new Set();
    const dem = new Set();
    const bld = new Set();
    const tiles = [];
    const frame = this.world.frame;
    const firstShotTiles = new Set();
    for (let t = 0; t <= this.total; t += step) {
      const { shot, u } = this.locate(t);
      const p = this.pose(shot, u);
      cam.position.copy(p.pos);
      cam.lookAt(p.look);
      cam.updateMatrixWorld();
      for (const [z, x, y] of this.world.terrain.collectFor(cam, screenH, maxZ)) {
        const k = `${z}/${x}/${y}`;
        if (!img.has(k)) {
          img.add(k);
          tiles.push(['img', z, x, y]);
          if (shot.index <= 1) firstShotTiles.add(k);
          tiles[tiles.length - 1].push(Math.round(t));
        }
        const dz = Math.min(z, 13);
        const s = 2 ** (z - dz);
        const dk = `${dz}/${Math.floor(x / s)}/${Math.floor(y / s)}`;
        if (!dem.has(dk)) {
          dem.add(dk);
          tiles.push(['dem', dz, Math.floor(x / s), Math.floor(y / s)]);
        }
      }
      const alt = p.pos.y - this.world.terrain.heightAt(p.pos.x, p.pos.z, 100);
      // 夜景镜头：预取道路（路灯光网）
      if (shot.tod >= 18.8 || shot.tod < 5.5) {
        const f = p.look;
        const r = Math.min(9000, Math.max(2500, alt * 2.2));
        const a = frame.localToTile(f.x - r, f.z - r, 14);
        const b = frame.localToTile(f.x + r, f.z + r, 14);
        for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) {
          const k = `f${x}/${y}`;
          if (!bld.has(k)) {
            bld.add(k);
            tiles.push(['f', 14, x, y]);
          }
        }
      }
      if (alt < 2500) {
        const f = p.look;
        const r = Math.min(buildingRadius, 400 + alt);
        const a = frame.localToTile(f.x - r, f.z - r, 14);
        const b = frame.localToTile(f.x + r, f.z + r, 14);
        for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) {
          const k = `${x}/${y}`;
          if (!bld.has(k)) {
            bld.add(k);
            tiles.push(['b', 14, x, y]);
          }
        }
      }
    }
    // 按首次需要的时间排序（服务端按提交顺序下载），并统计开播前必须就绪的数量
    let firstNeeded = 0;
    const warm = this.shots[0].dur + (this.shots[1]?.dur || 0);
    tiles.forEach((t, i) => {
      if (t.length < 5) t.push(tiles[i - 1]?.[4] ?? 0);
    });
    tiles.sort((a, b) => a[4] - b[4]);
    for (const t of tiles) if (t[4] <= warm) firstNeeded++;
    return { tiles: tiles.map((t) => t.slice(0, 4)), firstNeeded, counts: { img: img.size, dem: dem.size, b: bld.size, first: firstShotTiles.size } };
  }

  play(from = 0) {
    this.t = from;
    this.playing = true;
    this.current = -1;
    this.world.rig.setExternal(true);
    this.world.cinematic = true;
    this.savedFov = this.world.camera.fov;
    this.world.camera.fov = 42;
    this.world.camera.updateProjectionMatrix();
    this.dispatchEvent(new Event('start'));
  }
  pause(on = !this.paused) {
    this.paused = on;
    this.dispatchEvent(new CustomEvent('pause', { detail: on }));
  }
  stop(completed = false) {
    if (!this.playing) return;
    this.playing = false;
    this.world.cinematic = false;
    this.world.camera.fov = this.savedFov || 50;
    this.world.camera.updateProjectionMatrix();
    this.world.rig.setExternal(false);
    this.dispatchEvent(new CustomEvent('end', { detail: { completed } }));
  }

  update(dt) {
    if (!this.playing || this.paused) return;
    this.t += dt * this.speed;
    if (this.t >= this.total) {
      this.t = this.total;
      this.apply(dt);
      this.stop(true);
      return;
    }
    this.apply(dt);
  }

  apply(dt = 0) {
    const { shot, u, local } = this.locate(this.t);
    const cam = this.world.camera;
    const p = this.pose(shot, u);
    const want = this.neededLift(this.t);
    if (shot.index !== this.current || dt === 0) this.lift = want;
    else this.lift += (want - this.lift) * (1 - Math.exp(-(want > this.lift ? 4 : 0.7) * dt));
    p.pos.y += this.lift;
    cam.position.copy(p.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(p.look);
    if (shot.index !== this.current) {
      const prev = this.shots[this.current];
      this.current = shot.index;
      this.dispatchEvent(new CustomEvent('shot', { detail: { shot, prev } }));
    }
    // 时间：镜头内轻微推移，营造光影流动
    const tod = shot.tod + u * 0.18;
    if (Math.abs(tod - (this._lastTod ?? -1)) > 0.01) {
      this._lastTod = tod;
      this.world.setTime(tod);
      this.dispatchEvent(new CustomEvent('tod', { detail: tod }));
    }
    // 转场：镜头首尾 0.6 s 黑场（相邻镜头连续时省略）
    const next = this.shots[shot.index + 1];
    const prev = this.shots[shot.index - 1];
    const cutIn = !prev || this.isCut(prev, shot);
    const cutOut = !next || this.isCut(shot, next);
    let fade = 0;
    if (cutIn && local < 0.6) fade = Math.max(fade, 1 - local / 0.6);
    if (cutOut && shot.dur - local < 0.6) fade = Math.max(fade, 1 - (shot.dur - local) / 0.6);
    if (!prev && local < 1.5) fade = Math.max(fade, 1 - local / 1.5);
    this.dispatchEvent(new CustomEvent('frame', { detail: { t: this.t, total: this.total, fade, shot, u, local } }));
  }

  isCut(a, b) {
    if (Math.abs(a.tod - b.tod) > 1.5) return true;
    const pa = this.pose(a, 1).pos;
    const pb = this.pose(b, 0).pos;
    return pa.distanceTo(pb) > 400;
  }
}
