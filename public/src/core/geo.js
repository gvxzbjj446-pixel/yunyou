// 纯函数地理工具：Web Mercator 瓦片数学、局部坐标系、GCJ-02 纠偏。
// 浏览器与 Node 服务端共用（不依赖 DOM / three）。

export const EARTH_R = 6378137;
export const MERC_MAX = Math.PI * EARTH_R;
const D2R = Math.PI / 180;

export const lonToMercX = (lon) => EARTH_R * lon * D2R;
export const latToMercY = (lat) => {
  const c = Math.max(-85.05112878, Math.min(85.05112878, lat));
  return EARTH_R * Math.log(Math.tan(Math.PI / 4 + (c * D2R) / 2));
};
export const mercXToLon = (x) => x / EARTH_R / D2R;
export const mercYToLat = (y) => (2 * Math.atan(Math.exp(y / EARTH_R)) - Math.PI / 2) / D2R;

export const tileSpan = (z) => (2 * MERC_MAX) / 2 ** z;

/** 瓦片的墨卡托边界（米）与经纬度边界 */
export function tileBounds(z, x, y) {
  const s = tileSpan(z);
  const mx0 = -MERC_MAX + x * s;
  const my1 = MERC_MAX - y * s;
  const b = { mx0, mx1: mx0 + s, my0: my1 - s, my1 };
  b.w = mercXToLon(b.mx0);
  b.e = mercXToLon(b.mx1);
  b.s = mercYToLat(b.my0);
  b.n = mercYToLat(b.my1);
  return b;
}

export function lonLatToTile(lon, lat, z) {
  const s = tileSpan(z);
  const x = Math.floor((lonToMercX(lon) + MERC_MAX) / s);
  const y = Math.floor((MERC_MAX - latToMercY(lat)) / s);
  const n = 2 ** z;
  return { x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}

/**
 * 以城市中心为原点的局部坐标：x 向东、z 向南（three.js 右手系，y 向上）。
 * 墨卡托距离乘 cos(lat0) 得到真实米数；城市尺度（±100 km）误差 < 0.3%。
 */
export class LocalFrame {
  constructor(lon0, lat0) {
    this.lon0 = lon0;
    this.lat0 = lat0;
    this.k = Math.cos(lat0 * D2R);
    this.mx0 = lonToMercX(lon0);
    this.my0 = latToMercY(lat0);
  }
  mercToLocal(mx, my) {
    return { x: (mx - this.mx0) * this.k, z: -(my - this.my0) * this.k };
  }
  toLocal(lon, lat) {
    return this.mercToLocal(lonToMercX(lon), latToMercY(lat));
  }
  toLonLat(x, z) {
    return { lon: mercXToLon(x / this.k + this.mx0), lat: mercYToLat(-z / this.k + this.my0) };
  }
  /** 瓦片在局部坐标中的矩形 */
  tileRect(z, x, y) {
    const b = tileBounds(z, x, y);
    const a = this.mercToLocal(b.mx0, b.my1); // 西北角
    const c = this.mercToLocal(b.mx1, b.my0); // 东南角
    return { x0: a.x, z0: a.z, x1: c.x, z1: c.z, size: c.x - a.x };
  }
  localToTile(x, z, zoom) {
    const s = tileSpan(zoom);
    const mx = x / this.k + this.mx0;
    const my = -z / this.k + this.my0;
    return { x: Math.floor((mx + MERC_MAX) / s), y: Math.floor((MERC_MAX - my) / s) };
  }
}

/** 两点大圆距离（米） */
export function haversine(lon1, lat1, lon2, lat2) {
  const dLat = (lat2 - lat1) * D2R;
  const dLon = (lon2 - lon1) * D2R;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ---------- GCJ-02（高德/腾讯坐标）与 WGS-84 互转 ----------
const GCJ_A = 6378245.0;
const GCJ_EE = 0.00669342162296594323;
function outOfChina(lon, lat) {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}
function tLat(x, y) {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  r += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  r += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  return r;
}
function tLon(x, y) {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  r += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  r += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  return r;
}
export function wgs84ToGcj02(lon, lat) {
  if (outOfChina(lon, lat)) return { lon, lat };
  let dLat = tLat(lon - 105, lat - 35);
  let dLon = tLon(lon - 105, lat - 35);
  const radLat = lat * D2R;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * Math.PI);
  dLon = (dLon * 180) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { lon: lon + dLon, lat: lat + dLat };
}
/** 迭代反解，精度 < 1e-7 度 */
export function gcj02ToWgs84(lon, lat) {
  if (outOfChina(lon, lat)) return { lon, lat };
  let wl = lon;
  let wt = lat;
  for (let i = 0; i < 8; i++) {
    const g = wgs84ToGcj02(wl, wt);
    wl += lon - g.lon;
    wt += lat - g.lat;
  }
  return { lon: wl, lat: wt };
}

/** 可复现的伪随机数（mulberry32） */
export function rng(seed) {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
