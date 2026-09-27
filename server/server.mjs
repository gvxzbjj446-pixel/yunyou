// 云游中国 3D —— 本地服务：静态资源 + 瓦片/数据代理与磁盘缓存。
// 用法：node server/server.mjs [--port 8720] [--host 127.0.0.1]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { extname, join, normalize, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { Limiter, fetchWithTimeout, retry, HttpError, DiskCache, dedupe } from './upstream.mjs';
import { overpass, buildingsQuery, featuresQuery, processBuildings, processFeatures, fetchPoisOverpass, fetchAttractions, overpassHealth, RULES_VERSION } from './osm.mjs';
import { fetchGuide, fetchWikiSummary, fetchWeather, geocode, fetchPoisAmap } from './providers.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const THREE = join(ROOT, 'node_modules', 'three');

// ---- 配置 ----
const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
if (existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
// ---- 出网代理：Node 内置 fetch 默认不走系统代理。检测到代理时带 NODE_USE_ENV_PROXY 重启自身 ----
function detectProxy() {
  const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || process.env.PROXY;
  if (envProxy) return envProxy;
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'], { encoding: 'utf8', timeout: 3000 });
    if (!/ProxyEnable\s+REG_DWORD\s+0x1/.test(out)) return null;
    const m = /ProxyServer\s+REG_SZ\s+(\S+)/.exec(out);
    if (!m) return null;
    const hp = m[1].includes('=') ? (/https=([^;]+)/.exec(m[1]) || /http=([^;]+)/.exec(m[1]))?.[1] : m[1];
    return hp ? (hp.startsWith('http') ? hp : `http://${hp}`) : null;
  } catch {
    return null;
  }
}
const PROXY = !process.env.NODE_USE_ENV_PROXY && !argv.includes('--no-proxy') ? detectProxy() : null;
if (PROXY) {
  console.log(`[cloud-tour-3d] 使用出网代理 ${PROXY}`);
  // 本机代理（如 Clash）常把部分境外站点的连接重置；国内可直连的数据源绕过代理。
  // 可用 PROXY_BYPASS 覆盖（逗号分隔，空字符串表示全部走代理）
  const localProxy = /\/\/(127\.0\.0\.1|localhost)[:/]/.test(PROXY);
  const bypass = process.env.PROXY_BYPASS ?? (localProxy ? 'overpass-api.de,.overpass-api.de,.arcgisonline.com,s3.amazonaws.com,api.open-meteo.com,restapi.amap.com' : '');
  const child = spawn(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: PROXY, HTTP_PROXY: PROXY, NO_PROXY: ['localhost,127.0.0.1,::1', bypass].filter(Boolean).join(',') },
  });
  const stop = () => child.kill();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('exit', (code) => process.exit(code ?? 0));
}

const PORT = +(arg('port', process.env.PORT || 8720));
const HOST = arg('host', process.env.HOST || '127.0.0.1');
// 挂在反向代理子路径下时（如 /cloud-tour/），请求路径带前缀，这里剥掉
const BASE = (() => {
  let b = arg('base', process.env.BASE_PATH || '/');
  if (!b.startsWith('/')) b = `/${b}`;
  return b.endsWith('/') ? b : `${b}/`;
})();
const AMAP_KEY = process.env.AMAP_KEY || '';
const cache = new DiskCache(process.env.CACHE_DIR || join(ROOT, 'cache'));

// ---- 瓦片源 ----
const IMG_MAX_Z = 19;
const DEM_MAX_Z = 15;
const imgLimiter = new Limiter(12);
const demLimiter = new Limiter(6);
const IMG_HOSTS = ['https://server.arcgisonline.com', 'https://services.arcgisonline.com'];
let imgHost = 0;

async function getTile(kind, z, x, y, priority = 0) {
  const ext = kind === 'img' ? 'jpg' : 'png';
  const file = cache.path(kind, String(z), String(x), `${y}.${ext}`);
  const hit = await cache.read(file);
  if (hit) return hit;
  if (await cache.exists(`${file}.miss`)) throw new HttpError(404, 'no tile');
  return dedupe(`${kind}/${z}/${x}/${y}`, async () => {
    const limiter = kind === 'img' ? imgLimiter : demLimiter;
    const buf = await limiter.run(
      () =>
        retry(
          async (attempt) => {
            const url =
              kind === 'img'
                ? `${IMG_HOSTS[(imgHost + attempt) % IMG_HOSTS.length]}/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}?blankTile=false`
                : `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
            const res = await fetchWithTimeout(url, {}, 20000);
            if (res.status === 404 || res.status === 403) throw new HttpError(404, 'no tile');
            if (!res.ok) throw new HttpError(res.status, `${kind} ${res.status}`);
            return Buffer.from(await res.arrayBuffer());
          },
          { tries: 3, baseDelay: 400, shouldRetry: (e) => e.status !== 404 },
        ),
      priority,
    );
    await cache.write(file, buf);
    return buf;
  }).catch(async (e) => {
    if (e.status === 404) await cache.write(`${file}.miss`, Buffer.alloc(0));
    throw e;
  });
}

// ---- 预取任务（电影运镜路径上的瓦片） ----
const jobs = new Map();
function startPrefetch(list) {
  const id = Math.random().toString(36).slice(2, 10);
  const job = { id, total: list.length, done: 0, failed: 0, started: Date.now() };
  jobs.set(id, job);
  (async () => {
    await Promise.all(
      list.map(([kind, z, x, y]) =>
        (kind === 'b' ? buildingsCached(z, x, y, -5) : kind === 'f' ? featuresCached(z, x, y) : getTile(kind, z, x, y, -10))
          .then(() => job.done++)
          .catch(() => (job.done++, job.failed++)),
      ),
    );
    job.finished = Date.now();
    setTimeout(() => jobs.delete(id), 10 * 60 * 1000);
  })();
  return job;
}

// ---- 带缓存的数据接口 ----
const DAY = 86400e3;
/** Overpass 原始响应永久缓存：清洗/估高规则变更后直接重算，不必再打公共 Overpass */
async function rawOverpass(kind, z, x, y, priority = 0) {
  const file = cache.path('osm', `raw-${kind}${z}`, `${x}_${y}.json.gz`);
  const hit = await cache.read(file);
  if (hit) return JSON.parse(gunzipSync(hit).toString('utf8'));
  return dedupe(`raw:${kind}${z}/${x}/${y}`, async () => {
    const data = await overpass(kind === 'b' ? buildingsQuery(z, x, y) : featuresQuery(z, x, y), { priority });
    await cache.write(file, gzipSync(Buffer.from(JSON.stringify(data)), { level: 6 }));
    return data;
  });
}
async function processedCached(kind, z, x, y, priority) {
  const file = cache.path('osm', `${kind}${z}-r${RULES_VERSION}`, `${x}_${y}.json.gz`);
  const hit = await cache.read(file);
  if (hit) return hit;
  // 旧版道路缓存（道路按几何裁剪，不受质心问题影响）直接沿用
  if (kind === 'f') {
    const legacy = await cache.read(cache.path('osm', `f${z}`, `${x}_${y}.json.gz`));
    if (legacy) return legacy;
  }
  return dedupe(`pc:${kind}${z}/${x}/${y}`, async () => {
    const raw = await rawOverpass(kind, z, x, y, priority);
    const data = kind === 'b' ? processBuildings(raw, z, x, y) : processFeatures(raw, z, x, y);
    const gz = gzipSync(Buffer.from(JSON.stringify(data)), { level: 7 });
    await cache.write(file, gz);
    return gz;
  });
}
const buildingsCached = (z, x, y, priority = 0) => processedCached('b', z, x, y, priority);
const featuresCached = (z, x, y) => processedCached('f', z, x, y, 0);

// ---- HTTP 工具 ----
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.hdr': 'application/octet-stream', '.ktx2': 'image/ktx2', '.glb': 'model/gltf-binary',
};
const gzCache = new Map();

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(body);
}
function sendJson(req, res, data, maxAge = 0, status = 200) {
  const raw = Buffer.from(JSON.stringify(data));
  const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && raw.length > 1024;
  send(res, status, gz ? gzipSync(raw) : raw, {
    'Content-Type': MIME['.json'],
    'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
    ...(gz ? { 'Content-Encoding': 'gzip' } : {}),
  });
}
function sendError(req, res, e) {
  const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
  if (status >= 500) console.warn('[api]', req.url, e.message);
  sendJson(req, res, { error: e.message || String(e) }, 0, status);
}

async function serveStatic(req, res, baseDir, rel) {
  const target = normalize(join(baseDir, rel));
  if (!target.startsWith(baseDir + sep) && target !== baseDir) return send(res, 403, 'forbidden');
  let st;
  try {
    st = await stat(target);
    if (st.isDirectory()) return serveStatic(req, res, baseDir, join(rel, 'index.html'));
  } catch {
    return send(res, 404, 'not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  const ext = extname(target).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  if (req.headers['if-none-match'] === etag) return send(res, 304, '');
  const isText = /^(text|application\/json|image\/svg)/.test(type);
  const cacheCtl = baseDir === THREE ? 'public, max-age=86400' : 'no-cache';
  if (isText && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    const key = `${target}|${etag}`;
    let gz = gzCache.get(key);
    if (!gz) {
      gz = gzipSync(await readFile(target), { level: 6 });
      gzCache.set(key, gz);
    }
    return send(res, 200, gz, { 'Content-Type': type, 'Content-Encoding': 'gzip', ETag: etag, 'Cache-Control': cacheCtl });
  }
  return send(res, 200, await readFile(target), { 'Content-Type': type, ETag: etag, 'Cache-Control': cacheCtl });
}

async function readBody(req, limit = 4 << 20) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > limit) throw new HttpError(413, 'body too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const num = (v, lo, hi, name) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) throw new HttpError(400, `bad ${name}`);
  return n;
};
const int = (v, lo, hi, name) => {
  const n = num(v, lo, hi, name);
  if (!Number.isInteger(n)) throw new HttpError(400, `bad ${name}`);
  return n;
};
const tileArgs = (m, maxZ) => {
  const z = int(m[1], 0, maxZ, 'z');
  return [z, int(m[2], 0, 2 ** z - 1, 'x'), int(m[3], 0, 2 ** z - 1, 'y')];
};

// ---- 路由 ----
async function handle(req, res) {
  const url = new URL(req.url, 'http://local');
  if (BASE !== '/') {
    if (url.pathname === BASE.slice(0, -1)) return send(res, 308, '', { Location: BASE + url.search });
    if (!url.pathname.startsWith(BASE)) return send(res, 404, 'not found');
    url.pathname = url.pathname.slice(BASE.length - 1);
  }
  const p = decodeURIComponent(url.pathname);
  const q = url.searchParams;

  let m;
  if ((m = /^\/tiles\/(img|dem)\/(\d+)\/(\d+)\/(\d+)$/.exec(p))) {
    const kind = m[1];
    const [z, x, y] = tileArgs(m.slice(1), kind === 'img' ? IMG_MAX_Z : DEM_MAX_Z);
    try {
      const buf = await getTile(kind, z, x, y, +(q.get('p') || 0));
      return send(res, 200, buf, { 'Content-Type': kind === 'img' ? 'image/jpeg' : 'image/png', 'Cache-Control': 'public, max-age=2592000, immutable', 'Access-Control-Allow-Origin': '*' });
    } catch (e) {
      return send(res, e.status === 404 ? 404 : 502, '', { 'Cache-Control': e.status === 404 ? 'public, max-age=86400' : 'no-store' });
    }
  }
  if ((m = /^\/api\/osm\/(buildings|features)\/(\d+)\/(\d+)\/(\d+)$/.exec(p))) {
    const [z, x, y] = tileArgs(m.slice(1), 16);
    if (z < 13) throw new HttpError(400, 'z must be >= 13');
    const gz = await (m[1] === 'buildings' ? buildingsCached(z, x, y, +(q.get('p') || 0)) : featuresCached(z, x, y));
    return send(res, 200, gz, { 'Content-Type': MIME['.json'], 'Content-Encoding': 'gzip', 'Cache-Control': 'public, max-age=604800' });
  }
  if (p === '/api/config') {
    return sendJson(req, res, {
      poiProvider: AMAP_KEY ? 'amap' : 'osm',
      imagery: { name: 'Esri World Imagery', maxZoom: IMG_MAX_Z, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
      terrain: { name: 'AWS Terrain Tiles (Terrarium)', maxZoom: DEM_MAX_Z },
      buildings: 'OpenStreetMap contributors (ODbL)',
    });
  }
  if (p === '/api/pois') {
    const lat = num(q.get('lat'), -85, 85, 'lat');
    const lon = num(q.get('lon'), -180, 180, 'lon');
    const r = num(q.get('r') || 800, 50, 3000, 'r');
    const key = `${lat.toFixed(4)},${lon.toFixed(4)},${Math.round(r)}`;
    const data = await cache.json('pois', `${AMAP_KEY ? 'amap' : 'osm'}:${key}`, DAY, async () => {
      let list = [];
      let source = 'OpenStreetMap';
      if (AMAP_KEY) {
        try {
          list = await fetchPoisAmap(lat, lon, r, AMAP_KEY);
          source = '高德地图';
        } catch (e) {
          console.warn('[amap]', e.message);
        }
      }
      if (!list.length) list = await fetchPoisOverpass(lat, lon, r);
      return { source, radius: r, items: list.slice(0, 200) };
    });
    return sendJson(req, res, data, 3600);
  }
  if (p === '/api/guide') {
    const city = (q.get('city') || '').slice(0, 40);
    const en = (q.get('en') || '').slice(0, 60);
    if (!city && !en) throw new HttpError(400, 'city required');
    const data = await cache.json('guide', `${city}|${en}`, 7 * DAY, () => fetchGuide(city, en));
    return sendJson(req, res, data, 3600);
  }
  if (p === '/api/wiki') {
    const title = (q.get('title') || '').slice(0, 80);
    const lang = /^(zh|en)$/.test(q.get('lang') || '') ? q.get('lang') : 'zh';
    if (!title) throw new HttpError(400, 'title required');
    const data = await cache.json('wiki', `${lang}|${title}`, 7 * DAY, async () => (await fetchWikiSummary(title, lang)) || { missing: true });
    return sendJson(req, res, data, 3600);
  }
  if (p === '/api/weather') {
    const lat = num(q.get('lat'), -85, 85, 'lat');
    const lon = num(q.get('lon'), -180, 180, 'lon');
    const data = await cache.json('weather', `${lat.toFixed(2)},${lon.toFixed(2)}`, 20 * 60e3, () => fetchWeather(lat, lon));
    return sendJson(req, res, data, 600);
  }
  if (p === '/api/geocode') {
    const text = (q.get('q') || '').trim().slice(0, 80);
    if (!text) throw new HttpError(400, 'q required');
    const data = await cache.json('geocode', text, 30 * DAY, () => geocode(text));
    return sendJson(req, res, data, 86400);
  }
  if (p === '/api/attractions') {
    const lat = num(q.get('lat'), -85, 85, 'lat');
    const lon = num(q.get('lon'), -180, 180, 'lon');
    const r = num(q.get('r') || 12000, 1000, 30000, 'r');
    const data = await cache.json('attractions', `${lat.toFixed(3)},${lon.toFixed(3)},${r}`, 30 * DAY, () => fetchAttractions(lat, lon, r));
    return sendJson(req, res, data, 86400);
  }
  if (p === '/api/img') {
    // 图片代理：维基共享资源 / 高德图片在国内常无法直连，经服务端取回并缓存
    let u;
    try {
      u = new URL(q.get('u') || '');
    } catch {
      throw new HttpError(400, 'bad url');
    }
    if (u.protocol !== 'https:' || !/(^|\.)(wikimedia\.org|wikipedia\.org|autonavi\.com|amap\.com)$/.test(u.hostname)) throw new HttpError(403, 'host not allowed');
    const h = createHash('sha1').update(u.href).digest('hex');
    const file = cache.path('imgproxy', h.slice(0, 2), h);
    let buf = await cache.read(file);
    let type = 'image/jpeg';
    if (buf) {
      type = buf[0] === 0x89 ? 'image/png' : buf[0] === 0x47 ? 'image/gif' : buf[0] === 0x52 ? 'image/webp' : buf[0] === 0x3c ? 'image/svg+xml' : 'image/jpeg';
    } else {
      buf = await dedupe(`img:${h}`, () =>
        retry(async () => {
          const r = await fetchWithTimeout(u.href, { headers: { Accept: 'image/*' } }, 20000);
          if (!r.ok) throw new HttpError(r.status === 404 ? 404 : 502, `img ${r.status}`);
          if (!/^image\//.test(r.headers.get('content-type') || '')) throw new HttpError(415, 'not an image');
          const b = Buffer.from(await r.arrayBuffer());
          if (b.length > 6 << 20) throw new HttpError(413, 'image too large');
          await cache.write(file, b);
          return b;
        }, { tries: 2, shouldRetry: (e) => e.status >= 500 }),
      );
    }
    return send(res, 200, buf, { 'Content-Type': type, 'Cache-Control': 'public, max-age=2592000' });
  }
  if (p === '/api/prefetch' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const list = (body.tiles || []).slice(0, 20000).filter((t) => Array.isArray(t) && ['img', 'dem', 'b', 'f'].includes(t[0]) && t.slice(1).every(Number.isInteger));
    const job = startPrefetch(list);
    return sendJson(req, res, { id: job.id, total: job.total });
  }
  if ((m = /^\/api\/prefetch\/(\w+)$/.exec(p))) {
    const job = jobs.get(m[1]);
    if (!job) throw new HttpError(404, 'no job');
    return sendJson(req, res, job);
  }
  if ((m = /^\/__snap\/([\w.-]{1,60})$/.exec(p)) && req.method === 'POST') {
    // 开发自检用：保存前端截帧（仅监听本机时可用）
    if (!['127.0.0.1', 'localhost', '::1'].includes(HOST)) throw new HttpError(403, 'dev only');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    await cache.write(cache.path('snaps', `${m[1].replace(/\.png$/, '')}.png`), Buffer.concat(chunks));
    return sendJson(req, res, { ok: true });
  }
  if (p === '/api/health') return sendJson(req, res, { ok: true, img: imgLimiter.pending, dem: demLimiter.pending, overpass: overpassHealth() });

  if (p.startsWith('/vendor/three/')) {
    const rel = p.slice('/vendor/three/'.length);
    if (!/^(build|examples\/jsm)\//.test(rel)) return send(res, 403, 'forbidden');
    return serveStatic(req, res, THREE, rel);
  }
  if (p.startsWith('/api/')) throw new HttpError(404, 'unknown api');
  return serveStatic(req, res, PUBLIC, p === '/' ? 'index.html' : p.slice(1));
}

const server = PROXY ? null : createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (!res.headersSent) sendError(req, res, e);
    else res.destroy();
  });
});
if (server) {
  server.keepAliveTimeout = 30000;
  server.listen(PORT, HOST, () => {
    console.log(`[cloud-tour-3d] http://${HOST}:${PORT}${BASE}  (POI: ${AMAP_KEY ? '高德' : 'OSM Overpass'})`);
  });
}
