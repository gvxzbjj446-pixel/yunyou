// 相机控制：航拍（环绕/平移/缩放至光标）、漫游（地面第一人称 + 碰撞）、无人机（自由飞行）、平滑飞行过渡。
import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;
const damp = (a, b, lambda, dt) => THREE.MathUtils.lerp(a, b, 1 - Math.exp(-lambda * dt));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export class CameraRig extends EventTarget {
  constructor(camera, dom, { groundAt, rayGround, collide }) {
    super();
    this.camera = camera;
    this.dom = dom;
    this.groundAt = groundAt; // (x,z) → 地面高度
    this.rayGround = rayGround; // (origin, dir) → Vector3 | null
    this.collide = collide; // (from, to, radius) → 修正后的位置
    this.clearance = null; // (x, z) → 该点附近最高建筑顶面，航拍近距离避让用
    this.orbitLift = 0;
    this.mode = 'orbit';
    this.enabled = true;
    // 航拍状态（目标值 + 平滑后的当前值）
    this.orbit = { target: new THREE.Vector3(), distance: 3000, heading: 0, pitch: 0.6 };
    this.orbitGoal = { target: new THREE.Vector3(), distance: 3000, heading: 0, pitch: 0.6 };
    // 第一人称状态
    this.fp = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, vy: 0 };
    this.fpGoal = { yaw: 0, pitch: 0 };
    this.eyeHeight = 1.7;
    this.walkSpeed = 1.8;
    this.droneSpeedMul = 1;
    this.keys = new Set();
    this.flight = null;
    this.idleTime = 0;
    this.autoRotate = 0;
    this._bind();
  }

  // ---------------------------------------------------------------- 输入
  _bind() {
    const el = this.dom;
    this.pointers = new Map();
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey });
      this.idleTime = 0;
      this.cancelFlight();
      this.dispatchEvent(new Event('interact'));
    });
    el.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p || !this.enabled) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (this.pointers.size === 2) {
        const others = [...this.pointers.entries()].filter(([id]) => id !== e.pointerId)[0][1];
        const d0 = Math.hypot(p.x - others.x, p.y - others.y);
        const d1 = Math.hypot(e.clientX - others.x, e.clientY - others.y);
        if (d0 > 0 && this.mode === 'orbit') this.orbitGoal.distance = clamp(this.orbitGoal.distance * (d0 / d1), 30, 250000);
        const a0 = Math.atan2(p.y - others.y, p.x - others.x);
        const a1 = Math.atan2(e.clientY - others.y, e.clientX - others.x);
        this.rotate(-(a1 - a0) * 150, 0);
      } else if (p.button === 2 || p.button === 1 || p.shift) this.pan(dx, dy);
      else this.rotate(dx, dy);
      p.x = e.clientX;
      p.y = e.clientY;
    });
    const up = (e) => {
      this.pointers.delete(e.pointerId);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener(
      'wheel',
      (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        this.idleTime = 0;
        this.cancelFlight();
        this.zoom(e.deltaY * (e.deltaMode === 1 ? 33 : 1), e.clientX, e.clientY);
      },
      { passive: false },
    );
    el.addEventListener('dblclick', (e) => {
      if (!this.enabled || this.mode !== 'orbit') return;
      const hit = this.pick(e.clientX, e.clientY);
      if (hit) this.flyToOrbit({ target: hit, distance: Math.max(120, this.orbit.distance * 0.45) });
    });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      this.keys.add(e.code);
      if (this.enabled && /^(Key[WASDQERF]|Arrow|Space|ShiftLeft|KeyC)/.test(e.code)) {
        this.idleTime = 0;
        if (this.flight && /^(Key[WASD]|Arrow)/.test(e.code)) this.cancelFlight();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  ndc(clientX, clientY) {
    const r = this.dom.getBoundingClientRect();
    return new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }
  pick(clientX, clientY) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(this.ndc(clientX, clientY), this.camera);
    return this.rayGround(rc.ray.origin, rc.ray.direction);
  }

  rotate(dx, dy) {
    if (this.mode === 'orbit') {
      this.orbitGoal.heading -= dx * 0.0045;
      this.orbitGoal.pitch = clamp(this.orbitGoal.pitch + dy * 0.0035, 0.04, 1.5);
    } else if (this.mode === 'walk' || this.mode === 'drone') {
      this.fpGoal.yaw += dx * 0.0032;
      this.fpGoal.pitch = clamp(this.fpGoal.pitch + dy * 0.0028, -1.35, 1.35);
    }
  }
  pan(dx, dy) {
    if (this.mode !== 'orbit') return;
    const h = this.orbit.heading;
    const s = (this.orbit.distance * 2 * Math.tan((this.camera.fov * Math.PI) / 360)) / this.dom.clientHeight;
    const fwd = new THREE.Vector3(Math.sin(h), 0, -Math.cos(h));
    const right = new THREE.Vector3(Math.cos(h), 0, Math.sin(h));
    const k = 1 / Math.max(0.3, Math.sin(this.orbit.pitch));
    this.orbitGoal.target.addScaledVector(right, -dx * s).addScaledVector(fwd, dy * s * k);
  }
  zoom(delta, clientX, clientY) {
    if (this.mode === 'drone') {
      this.droneSpeedMul = clamp(this.droneSpeedMul * Math.exp(-delta * 0.001), 0.1, 20);
      this.dispatchEvent(new CustomEvent('speed', { detail: this.droneSpeedMul }));
      return;
    }
    if (this.mode !== 'orbit') return;
    const f = Math.exp(delta * 0.0012);
    const g = this.orbitGoal;
    const newD = clamp(g.distance * f, 25, 250000);
    // 缩放向光标所指的地面点靠拢
    if (clientX != null && f < 1) {
      const hit = this.pick(clientX, clientY);
      if (hit) {
        const k = 1 - newD / g.distance;
        g.target.x += (hit.x - g.target.x) * k;
        g.target.z += (hit.z - g.target.z) * k;
      }
    }
    g.distance = newD;
  }

  // ---------------------------------------------------------------- 模式与姿态
  setMode(mode) {
    if (mode === this.mode) return;
    const cam = this.camera;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    if (mode === 'walk' || mode === 'drone') {
      this.fp.pos.copy(cam.position);
      this.fp.yaw = this.fpGoal.yaw = Math.atan2(dir.x, -dir.z);
      this.fp.pitch = this.fpGoal.pitch = Math.asin(clamp(dir.y, -1, 1));
      this.fp.vy = 0;
    } else if (mode === 'orbit') {
      this.setOrbitFromPose(cam.position, dir);
    }
    this.mode = mode;
    this.dispatchEvent(new CustomEvent('mode', { detail: mode }));
  }

  /** 由相机位置与朝向反推航拍参数（目标点取视线与地面交点） */
  setOrbitFromPose(pos, dir) {
    let hit = this.rayGround(pos, dir.clone().normalize(), 60000);
    if (!hit) {
      const d = 1500;
      hit = pos.clone().addScaledVector(dir, d);
      hit.y = this.groundAt(hit.x, hit.z);
    }
    const off = pos.clone().sub(hit);
    const dist = off.length();
    const o = { target: hit.clone(), distance: dist, heading: Math.atan2(-off.x, off.z), pitch: Math.asin(clamp(off.y / dist, -1, 1)) };
    o.pitch = clamp(o.pitch, 0.04, 1.5);
    Object.assign(this.orbit, { ...o, target: o.target.clone() });
    Object.assign(this.orbitGoal, { ...o, target: o.target.clone() });
  }

  orbitPose(o, out = { pos: new THREE.Vector3(), look: new THREE.Vector3() }) {
    const cp = Math.cos(o.pitch);
    out.look.copy(o.target);
    out.pos.set(o.target.x - Math.sin(o.heading) * cp * o.distance, o.target.y + Math.sin(o.pitch) * o.distance, o.target.z + Math.cos(o.heading) * cp * o.distance);
    return out;
  }

  /** 平滑飞行到指定位姿；arc 为中途抬升高度 */
  flyTo({ position, lookAt, duration, arc, mode, onDone }) {
    const cam = this.camera;
    const p0 = cam.position.clone();
    const l0 = cam.position.clone().add(cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(Math.max(50, p0.distanceTo(lookAt))));
    const dist = p0.distanceTo(position);
    const dur = duration ?? clamp(1.6 + Math.log10(Math.max(10, dist)) * 0.8, 1.8, 6.5);
    const lift = arc ?? Math.min(dist * 0.3, 9000);
    this.cancelFlight();
    this.prevMode = mode || this.mode;
    this.mode = 'flight';
    this.flight = { p0, l0, p1: position.clone(), l1: lookAt.clone(), t: 0, dur, lift, mode: mode || this.prevMode, onDone };
    this.dispatchEvent(new CustomEvent('mode', { detail: 'flight' }));
    return new Promise((res) => (this.flight.resolve = res));
  }
  flyToOrbit({ target, distance, heading = this.orbitGoal.heading, pitch = this.orbitGoal.pitch, duration }) {
    const o = { target: target.clone(), distance, heading, pitch };
    const pose = this.orbitPose(o);
    return this.flyTo({ position: pose.pos, lookAt: pose.look, duration, mode: 'orbit', arc: undefined }).then(() => {
      Object.assign(this.orbit, { ...o, target: o.target.clone() });
      Object.assign(this.orbitGoal, { ...o, target: o.target.clone() });
    });
  }
  cancelFlight() {
    if (!this.flight) return;
    const f = this.flight;
    this.flight = null;
    this.mode = 'none';
    this.setMode(f.mode === 'flight' ? 'orbit' : f.mode);
    f.resolve?.(false);
  }

  /** 外部（运镜导演）接管 */
  setExternal(on) {
    if (on) {
      this.cancelFlight();
      this.mode = 'external';
    } else if (this.mode === 'external') {
      this.mode = 'none';
      this.setMode('orbit');
    }
  }

  // ---------------------------------------------------------------- 每帧
  update(dt) {
    dt = Math.min(dt, 0.1);
    this.idleTime += dt;
    const cam = this.camera;
    if (this.mode === 'flight' && this.flight) {
      const f = this.flight;
      f.t += dt / f.dur;
      const t = Math.min(1, f.t);
      const e = easeInOut(t);
      const pos = f.p0.clone().lerp(f.p1, e);
      pos.y += Math.sin(Math.PI * e) * f.lift;
      const look = f.l0.clone().lerp(f.l1, easeInOut(Math.min(1, t * 1.15)));
      cam.position.copy(pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(look);
      if (t >= 1) {
        this.flight = null;
        this.mode = 'none';
        if (f.mode === 'orbit') {
          this.setOrbitFromPose(f.p1, f.l1.clone().sub(f.p1));
          this.mode = 'orbit';
        } else this.setMode(f.mode);
        this.dispatchEvent(new CustomEvent('mode', { detail: this.mode }));
        f.onDone?.();
        f.resolve?.(true);
      }
      return;
    }
    if (this.mode === 'orbit') this.updateOrbit(dt);
    else if (this.mode === 'walk') this.updateWalk(dt);
    else if (this.mode === 'drone') this.updateDrone(dt);
  }

  updateOrbit(dt) {
    const g = this.orbitGoal;
    const o = this.orbit;
    const k = this.keys;
    const panSpeed = o.distance * 0.9 * dt;
    const h = o.heading;
    const fwd = new THREE.Vector3(Math.sin(h), 0, -Math.cos(h));
    const right = new THREE.Vector3(Math.cos(h), 0, Math.sin(h));
    if (this.enabled) {
      if (k.has('KeyW') || k.has('ArrowUp')) g.target.addScaledVector(fwd, panSpeed);
      if (k.has('KeyS') || k.has('ArrowDown')) g.target.addScaledVector(fwd, -panSpeed);
      if (k.has('KeyA') || k.has('ArrowLeft')) g.target.addScaledVector(right, -panSpeed);
      if (k.has('KeyD') || k.has('ArrowRight')) g.target.addScaledVector(right, panSpeed);
      if (k.has('KeyQ')) g.heading += dt * 0.9;
      if (k.has('KeyE')) g.heading -= dt * 0.9;
      if (k.has('KeyR')) g.pitch = clamp(g.pitch + dt * 0.6, 0.04, 1.5);
      if (k.has('KeyF')) g.pitch = clamp(g.pitch - dt * 0.6, 0.04, 1.5);
      if (k.has('Equal') || k.has('NumpadAdd')) g.distance = clamp(g.distance * (1 - dt * 1.5), 25, 250000);
      if (k.has('Minus') || k.has('NumpadSubtract')) g.distance = clamp(g.distance * (1 + dt * 1.5), 25, 250000);
    }
    if (this.autoRotate && this.idleTime > 6) g.heading += dt * this.autoRotate;
    g.target.y = this.groundAt(g.target.x, g.target.z);
    const L = 9;
    o.target.x = damp(o.target.x, g.target.x, L, dt);
    o.target.z = damp(o.target.z, g.target.z, L, dt);
    o.target.y = damp(o.target.y, g.target.y, 4, dt);
    o.distance = Math.exp(damp(Math.log(o.distance), Math.log(g.distance), L, dt));
    const dh = wrapAngle(g.heading - o.heading);
    o.heading += dh * (1 - Math.exp(-L * dt));
    o.pitch = damp(o.pitch, g.pitch, L, dt);
    const pose = this.orbitPose(o);
    // 近距离航拍不穿楼：机位附近有建筑时平滑抬升（只改高度，视线仍对准目标），离开后缓慢回落
    if (this.clearance && o.distance < 4000) {
      const need = Math.max(0, this.clearance(pose.pos.x, pose.pos.z) + 10 - pose.pos.y);
      this.orbitLift = need > this.orbitLift ? Math.max(need - 2, damp(this.orbitLift, need, 12, dt)) : damp(this.orbitLift, need, 1.5, dt);
      pose.pos.y += this.orbitLift;
    } else this.orbitLift = 0;
    // 相机不钻地
    const gy = this.groundAt(pose.pos.x, pose.pos.z) + 4;
    if (pose.pos.y < gy) pose.pos.y = gy;
    this.camera.position.copy(pose.pos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(pose.look);
  }

  _fpLook(dt) {
    const fp = this.fp;
    fp.yaw += wrapAngle(this.fpGoal.yaw - fp.yaw) * (1 - Math.exp(-14 * dt));
    fp.pitch = damp(fp.pitch, this.fpGoal.pitch, 14, dt);
    const k = this.keys;
    if (k.has('ArrowLeft')) this.fpGoal.yaw -= dt * 1.4;
    if (k.has('ArrowRight')) this.fpGoal.yaw += dt * 1.4;
    const cp = Math.cos(fp.pitch);
    const dir = new THREE.Vector3(Math.sin(fp.yaw) * cp, Math.sin(fp.pitch), -Math.cos(fp.yaw) * cp);
    this.camera.position.copy(fp.pos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(fp.pos.clone().add(dir));
  }

  _moveInput() {
    const k = this.keys;
    let f = 0;
    let s = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
    if (k.has('KeyA')) s -= 1;
    if (k.has('KeyD')) s += 1;
    return { f, s, run: k.has('ShiftLeft') || k.has('ShiftRight') };
  }

  updateWalk(dt) {
    const fp = this.fp;
    if (this.enabled) {
      const { f, s, run } = this._moveInput();
      if (f || s) {
        const sp = this.walkSpeed * (run ? 4 : 1) * dt;
        const y = fp.yaw;
        const n = Math.hypot(f, s);
        const dx = ((Math.sin(y) * f + Math.cos(y) * s) / n) * sp;
        const dz = ((-Math.cos(y) * f + Math.sin(y) * s) / n) * sp;
        const to = new THREE.Vector3(fp.pos.x + dx, fp.pos.y, fp.pos.z + dz);
        const fixed = this.collide ? this.collide(fp.pos, to, 0.35) : to;
        fp.pos.x = fixed.x;
        fp.pos.z = fixed.z;
        this.bob = (this.bob || 0) + sp * 2.2;
      }
    }
    const ground = this.groundAt(fp.pos.x, fp.pos.z) + this.eyeHeight + Math.sin(this.bob || 0) * 0.025;
    fp.pos.y = damp(fp.pos.y, ground, 12, dt);
    this._fpLook(dt);
  }

  updateDrone(dt) {
    const fp = this.fp;
    const ground = this.groundAt(fp.pos.x, fp.pos.z);
    const alt = Math.max(1, fp.pos.y - ground);
    if (this.enabled) {
      const { f, s, run } = this._moveInput();
      const k = this.keys;
      const sp = clamp(alt * 0.9, 12, 1500) * this.droneSpeedMul * (run ? 3 : 1) * dt;
      const y = fp.yaw;
      const cp = Math.cos(fp.pitch);
      if (f) fp.pos.add(new THREE.Vector3(Math.sin(y) * cp, Math.sin(fp.pitch), -Math.cos(y) * cp).multiplyScalar(f * sp));
      if (s) fp.pos.add(new THREE.Vector3(Math.cos(y), 0, Math.sin(y)).multiplyScalar(s * sp));
      if (k.has('KeyE') || k.has('Space')) fp.pos.y += sp * 0.7;
      if (k.has('KeyQ') || k.has('KeyC')) fp.pos.y -= sp * 0.7;
    }
    fp.pos.y = Math.max(fp.pos.y, ground + 2);
    this._fpLook(dt);
  }
}
