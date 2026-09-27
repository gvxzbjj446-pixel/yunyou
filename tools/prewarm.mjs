// 预热：按城市配置把建筑/道路 z14 瓦片提前拉进服务端缓存（公共 Overpass 常过载，懒加载不可靠）。
// 用法：node tools/prewarm.mjs [--base http://127.0.0.1:8720/] [--city puyang,zhengzhou,all] [--conc 2] [--features]
import { PRESET_CITIES } from '../public/src/data/cities.js';
import { lonLatToTile } from '../public/src/core/geo.js';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const BASE = arg('base', 'http://127.0.0.1:8720/').replace(/\/?$/, '/');
const CITIES = arg('city', 'puyang');
const CONC = +arg('conc', 2);
const WITH_F = argv.includes('--features');
const Z = 14;

/** 城市需要的瓦片：中心区 + 每个景点周边 + 运镜路径点 */
function tilesFor(city) {
  const set = new Map();
  const add = (lon, lat, rKm, prio) => {
    const dLat = rKm / 111;
    const dLon = rKm / (111 * Math.cos((lat * Math.PI) / 180));
    const a = lonLatToTile(lon - dLon, lat + dLat, Z);
    const b = lonLatToTile(lon + dLon, lat - dLat, Z);
    for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) {
      const k = `${x}/${y}`;
      set.set(k, Math.min(set.get(k) ?? Infinity, prio));
    }
  };
  for (const l of city.landmarks) add(l.lon, l.lat, 1.6, 0);
  for (const s of city.cinematic || []) for (const p of [...(s.pos || []), ...(s.look || [])]) add(p[0], p[1], 0.8, 1);
  add(city.center[0], city.center[1], ['zhengzhou', 'puyang'].includes(city.id) ? 7 : 3, 2);
  return [...set.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
}

async function fetchTile(kind, key) {
  const url = `${BASE}api/osm/${kind}/${Z}/${key}?v=pre`;
  for (let i = 0; i < 8; i++) {
    const t0 = Date.now();
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(400_000) });
      await r.arrayBuffer();
      if (r.ok) return { ok: true, ms: Date.now() - t0 };
      if (r.status < 500) return { ok: false, status: r.status };
    } catch {}
    await new Promise((res) => setTimeout(res, Math.min(120_000, 8000 * 2 ** i)));
  }
  return { ok: false };
}

const list = CITIES === 'all' ? PRESET_CITIES : PRESET_CITIES.filter((c) => CITIES.split(',').includes(c.id));
const jobs = [];
for (const c of list) {
  const tiles = tilesFor(c);
  console.log(`${c.name}: ${tiles.length} tiles`);
  for (const t of tiles) jobs.push(['buildings', t, c.name]);
  if (WITH_F) for (const t of tiles) jobs.push(['features', t, c.name]);
}
let done = 0;
let fail = 0;
const t0 = Date.now();
async function worker() {
  while (jobs.length) {
    const [kind, key, name] = jobs.shift();
    const r = await fetchTile(kind, key);
    done++;
    if (!r.ok) fail++;
    if (done % 5 === 0 || !r.ok) console.log(`[${((Date.now() - t0) / 60000).toFixed(1)}m] ${done} done, ${fail} failed, ${jobs.length} left · ${name} ${kind} ${key} ${r.ok ? `${r.ms}ms` : 'FAIL'}`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
console.log(`finished: ${done} tiles, ${fail} failed, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
