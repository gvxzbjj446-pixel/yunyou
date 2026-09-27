// 天空、太阳、云、星空、雾与光照。时间驱动：真实太阳高度角 → 色调、光强、夜景灯光系数。
import * as THREE from 'three';

const D2R = Math.PI / 180;

/** NOAA 简化太阳位置：返回 {elevation, azimuth}（度，方位角自北顺时针） */
export function solarPosition(date, lat, lon) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * D2R;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R;
  const eps = (23.439 - 0.0000004 * n) * D2R;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lst = (gmst * 15 + lon) * D2R;
  const ha = lst - ra;
  const la = lat * D2R;
  const el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(ha));
  return { elevation: el / D2R, azimuth: ((az / D2R) + 360) % 360 };
}

// 关键帧插值（按太阳高度角）
function ramp(stops, x) {
  if (x <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [x0, a] = stops[i - 1];
      const [x1, b] = stops[i];
      const t = (x - x0) / (x1 - x0);
      if (typeof a === 'number') return a + (b - a) * t;
      return a.clone().lerp(b, t);
    }
  }
  return stops[stops.length - 1][1];
}
const C = (hex) => new THREE.Color(hex);
const ZENITH = [[-18, C('#010208')], [-8, C('#07122b')], [-2, C('#1b2f5c')], [3, C('#3a5c96')], [12, C('#3f75bd')], [40, C('#2f69b8')]];
const HORIZON = [[-18, C('#04060d')], [-8, C('#161a31')], [-3, C('#5a4560')], [0, C('#e0906a')], [4, C('#efb58a')], [10, C('#dcd2c4')], [25, C('#c9d6e3')], [60, C('#c3d3e4')]];
const SUNCOL = [[-4, C('#ff5a28')], [0, C('#ff7a3a')], [5, C('#ffb074')], [15, C('#ffe2c2')], [40, C('#fff6ea')]];
const SUN_I = [[-5, 0], [-1, 0.05], [2, 0.8], [10, 2.0], [30, 2.7], [60, 3.0]];
const HEMI_I = [[-18, 0.08], [-6, 0.16], [0, 0.4], [10, 0.6], [40, 0.7]];
const TINT = [[-18, C('#262c44')], [-8, C('#343c5e')], [-3, C('#6e6a86')], [1, C('#caa58f')], [6, C('#f1dcc6')], [18, C('#ffffff')], [60, C('#ffffff')]];

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const skyFrag = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uZenith, uHorizon, uSunDir, uSunColor;
uniform float uTime, uCloud, uNight, uSunVis, uHaze;
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float v=0.0, a=0.5; mat2 m=mat2(1.6,1.2,-1.2,1.6); for(int i=0;i<6;i++){ v+=a*noise(p); p=m*p; a*=0.5; } return v; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float hp = max(h, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(hp, 0.45));
  // 地平线薄雾带
  col = mix(col, uHorizon * 1.05, exp(-hp * 18.0) * uHaze);
  float mu = max(dot(d, uSunDir), 0.0);
  // 太阳光晕（Mie 近似）与日轮
  col += uSunColor * (pow(mu, 6.0) * 0.18 + pow(mu, 48.0) * 0.45) * uSunVis;
  col += uSunColor * smoothstep(0.99955, 0.99985, mu) * 40.0 * uSunVis * step(-0.02, uSunDir.y);
  // 日出日落时地平线朝太阳一侧的暖色
  float warm = exp(-hp * 6.0) * pow(mu, 2.0) * smoothstep(0.35, 0.0, uSunDir.y) * uSunVis;
  col += uSunColor * warm * 0.6;
  // 星空
  if (uNight > 0.01 && h > 0.0) {
    vec2 sp = d.xz / (d.y + 1.0) * 420.0;
    float s = hash(floor(sp));
    float star = step(0.9965, s) * (0.5 + 0.5 * sin(uTime * 2.0 + s * 80.0));
    col += vec3(star) * uNight * smoothstep(0.0, 0.25, h) * 1.4;
  }
  // 云层：投影到天空平面
  if (h > 0.0 && uCloud > 0.0) {
    vec2 cp = d.xz / (h + 0.12) * 1.3 + vec2(uTime * 0.004, uTime * 0.0015);
    float n = fbm(cp * 1.4);
    float n2 = fbm(cp * 3.1 + 7.0);
    float cov = smoothstep(1.0 - uCloud, 1.0 - uCloud + 0.35, n * 0.75 + n2 * 0.35);
    float lit = 0.55 + 0.45 * pow(mu, 3.0);
    vec3 cloudCol = mix(uHorizon * 0.9, vec3(1.0), 0.55) * (0.35 + 0.9 * uSunVis) * lit + uSunColor * pow(mu, 12.0) * 0.8 * uSunVis;
    cloudCol = mix(cloudCol, uZenith * 0.6, uNight * 0.8);
    float fade = smoothstep(0.0, 0.18, h);
    col = mix(col, cloudCol, cov * fade * 0.92);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class Atmosphere {
  constructor({ scene, renderer, lat, lon }) {
    this.scene = scene;
    this.renderer = renderer;
    this.lat = lat;
    this.lon = lon;
    this.utcOffsetH = 8;
    this.uniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uTime: { value: 0 },
      uCloud: { value: 0.45 },
      uNight: { value: 0 },
      uSunVis: { value: 1 },
      uHaze: { value: 0.7 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
    this.dome.scale.setScalar(1e6);
    this.dome.renderOrder = -1000;
    this.dome.frustumCulled = false;
    this.dome.name = 'sky';
    scene.add(this.dome);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.name = 'sun';
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.intensity = 0.85;
    this.shadowExtent = 1200;
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x6b5a45, 1);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xc8d6e4, 0.00012);

    // 环境贴图（玻璃幕墙反射）
    this.envScene = new THREE.Scene();
    this.envDome = new THREE.Mesh(this.dome.geometry, mat);
    this.envDome.scale.setScalar(100);
    this.envScene.add(this.envDome);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.lastEnvKey = '';

    this.tint = new THREE.Color(1, 1, 1);
    this.night = 0;
    this.elevation = 45;
    this.visibility = 14000;
    this.todHours = 10;
    this.date = new Date();
  }

  /** 设置当地时间（小时，0-24），日期默认今天 */
  setTime(hours, date = this.date) {
    this.todHours = ((hours % 24) + 24) % 24;
    this.date = date;
    const d = new Date(date);
    const utcMs = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) + (this.todHours - this.utcOffsetH) * 3600e3;
    const { elevation, azimuth } = solarPosition(new Date(utcMs), this.lat, this.lon);
    this.applySun(elevation, azimuth);
  }

  applySun(elevation, azimuth) {
    this.elevation = elevation;
    this.azimuth = azimuth;
    const el = elevation * D2R;
    const az = azimuth * D2R;
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    this.sunDir = dir;
    const u = this.uniforms;
    u.uSunDir.value.copy(dir);
    u.uZenith.value.copy(ramp(ZENITH, elevation));
    u.uHorizon.value.copy(ramp(HORIZON, elevation));
    u.uSunColor.value.copy(ramp(SUNCOL, elevation));
    u.uSunVis.value = THREE.MathUtils.smoothstep(elevation, -4, 2);
    this.night = 1 - THREE.MathUtils.smoothstep(elevation, -9, 1);
    u.uNight.value = 1 - THREE.MathUtils.smoothstep(elevation, -14, -4);

    // 月光：太阳落下后用冷色弱光代替，避免建筑全黑
    const sunI = ramp(SUN_I, elevation);
    if (elevation > -1) {
      this.sun.color.copy(u.uSunColor.value);
      this.sun.intensity = sunI;
      this.sunLightDir = dir.clone();
    } else {
      this.sun.color.set('#8aa2d8');
      this.sun.intensity = 0.25;
      this.sunLightDir = new THREE.Vector3(-0.3, 0.8, 0.4).normalize();
    }
    this.hemi.intensity = ramp(HEMI_I, elevation);
    this.hemi.color.copy(u.uZenith.value).lerp(new THREE.Color('#fff8ee'), 0.72);
    this.hemi.groundColor.set(elevation > 0 ? '#6f6250' : '#1a1a22');
    this.tint.copy(ramp(TINT, elevation));
    this.scene.fog.color.copy(u.uHorizon.value);
  }

  /** 每帧：跟随相机、按高度调整能见度 */
  update(camera, dt, groundH = 100, focus = null) {
    this.uniforms.uTime.value += dt;
    this.dome.position.copy(camera.position);
    const alt = Math.max(0, camera.position.y - groundH);
    this.visibility = (this.baseVisibility ?? 16000) + alt * 22;
    this.scene.fog.density = 1.6 / this.visibility;
    // 阴影相机跟随视点：覆盖范围随高度变化，并对齐到纹素网格减少闪烁
    const S = THREE.MathUtils.clamp(alt * 1.1, 120, 2600);
    this.shadowExtent = S;
    const f = (focus || camera.position).clone();
    const texel = (2 * S) / this.sun.shadow.mapSize.x;
    f.x = Math.round(f.x / texel) * texel;
    f.z = Math.round(f.z / texel) * texel;
    f.y = groundH;
    const dir = this.sunLightDir || this.sunDir;
    const cam = this.sun.shadow.camera;
    if (cam.right !== S) {
      cam.left = -S;
      cam.right = S;
      cam.top = S;
      cam.bottom = -S;
      cam.near = 1;
      cam.far = 12000;
      cam.updateProjectionMatrix();
    }
    this.sun.position.copy(f).addScaledVector(dir, 6000);
    this.sun.target.position.copy(f);
    this.sun.castShadow = this.elevation > -1 && alt < 8000;
  }

  /** 水平面上的太阳与天空辐照度（供地形材质配平） */
  get irradiance() {
    const sinEl = Math.max(0, (this.sunLightDir || this.sunDir).y);
    const sky = this.hemi.intensity * (0.2126 * this.hemi.color.r + 0.7152 * this.hemi.color.g + 0.0722 * this.hemi.color.b);
    return { sun: this.sun.intensity * sinEl, sky };
  }

  setWeather({ cloud = 0.45, haze = 0.7, visibility = 16000 } = {}) {
    this.uniforms.uCloud.value = cloud;
    this.uniforms.uHaze.value = haze;
    this.baseVisibility = visibility;
  }

  /** 按需重建环境贴图（太阳角度变化较大时） */
  updateEnvironment(force = false) {
    const key = `${Math.round(this.elevation)}|${Math.round(this.azimuth / 5)}|${this.uniforms.uCloud.value.toFixed(2)}`;
    if (!force && key === this.lastEnvKey) return;
    this.lastEnvKey = key;
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 1000);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = THREE.MathUtils.lerp(0.08, 0.38, THREE.MathUtils.smoothstep(this.elevation, -6, 15));
    if (old) old.dispose();
  }
}
