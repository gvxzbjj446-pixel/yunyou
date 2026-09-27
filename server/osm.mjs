// OpenStreetMap（Overpass API）数据：建筑体块、周边店铺、城市景点。
import { Limiter, fetchWithTimeout, retry, HttpError, dedupe } from './upstream.mjs';
import { tileBounds, haversine, rng } from '../public/src/core/geo.js';
import { area, centroid, pointInPolygon, elongation, cleanRing } from '../public/src/core/poly.js';

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const overpassLimiter = new Limiter(2);
// 镜像健康度：失败的镜像按指数退避冷却，优先选最近成功、延迟低的
const health = MIRRORS.map((url) => ({ url, fails: 0, until: 0, lat: 4000 }));
function pickMirror(tried) {
  const now = Date.now();
  const cand = health.filter((h) => !tried.has(h.url));
  const ready = cand.filter((h) => h.until <= now);
  const pool = ready.length ? ready : cand.length ? cand : health;
  return pool.slice().sort((a, b) => a.fails - b.fails || a.lat - b.lat)[0];
}
function markMirror(h, ok, ms, status = 0) {
  if (ok) {
    h.fails = Math.max(0, h.fails - 1);
    h.until = 0;
    h.lat = h.lat * 0.6 + ms * 0.4;
  } else {
    h.fails++;
    // 429（限流）冷却更久
    h.until = Date.now() + Math.min(10 * 60e3, (status === 429 ? 60e3 : 15e3) * 2 ** Math.min(4, h.fails - 1));
  }
}
export const overpassHealth = () => health.map((h) => ({ host: new URL(h.url).host, fails: h.fails, coolingMs: Math.max(0, h.until - Date.now()), lat: Math.round(h.lat) }));

export async function overpass(query, { timeoutMs = 60000, priority = 0 } = {}) {
  return overpassLimiter.run(() => {
    const tried = new Set();
    return retry(
      async () => {
        const h = pickMirror(tried);
        tried.add(h.url);
        const t0 = Date.now();
        try {
          const res = await fetchWithTimeout(
            h.url,
            { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(query)}` },
            timeoutMs,
          );
          const text = await res.text();
          if (!res.ok) throw new HttpError(res.status, `overpass ${res.status} @ ${new URL(h.url).host}`);
          if (text.trimStart().startsWith('<')) {
            const m = /Error<\/strong>:([^<]+)/.exec(text);
            throw new HttpError(503, `overpass busy @ ${new URL(h.url).host}: ${m ? m[1].trim().slice(0, 120) : 'html'}`);
          }
          const data = JSON.parse(text);
          if (data.remark && /runtime error|timed out|out of memory/i.test(data.remark)) throw new HttpError(503, `overpass remark: ${data.remark.slice(0, 120)}`);
          markMirror(h, true, Date.now() - t0);
          return data;
        } catch (e) {
          markMirror(h, false, 0, e.status);
          const err = e.name === 'AbortError' ? new HttpError(504, `overpass timeout ${timeoutMs / 1000}s @ ${new URL(h.url).host}`) : e;
          console.warn(`[overpass] ${new URL(h.url).host} ${Date.now() - t0}ms: ${err.message}`);
          throw err;
        }
      },
      { tries: 4, baseDelay: 1500 },
    );
  }, priority);
}

// ---------------------------------------------------------------- 建筑
// 清洗/估高规则版本：变更后服务端缓存目录随之切换，旧数据自动失效
export const RULES_VERSION = 7;
const M_PER_DEG_LAT = 110574;

/** 以经纬度环构造局部米制坐标（小范围等距近似），用于面积/形状判断 */
function toMeters(ring, lat0) {
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return ring.map(([lon, lat]) => [lon * kx, lat * M_PER_DEG_LAT]);
}

function parseLength(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(',', '.');
  const m = /^(-?\d+(?:\.\d+)?)\s*(m|meters?|米)?$/i.exec(s);
  if (m) return parseFloat(m[1]);
  const ft = /^(\d+(?:\.\d+)?)\s*(ft|')$/i.exec(s);
  if (ft) return parseFloat(ft[1]) * 0.3048;
  return null;
}

const SMALL = new Set(['garage', 'garages', 'shed', 'hut', 'kiosk', 'roof', 'carport', 'toilets', 'container', 'cabin', 'bunker', 'gatehouse', 'guardhouse', 'transformer_tower', 'service']);
const HOUSES = new Set(['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'farm', 'farm_auxiliary', 'barn', 'stable', 'static_caravan']);
const INDUSTRIAL = new Set(['industrial', 'warehouse', 'factory', 'manufacture', 'storage_tank', 'hangar']);
const BIG_HALL = new Set(['train_station', 'stadium', 'sports_hall', 'sports_centre', 'grandstand', 'transportation', 'hangar', 'exhibition_hall']);
const RELIGIOUS = new Set(['temple', 'mosque', 'church', 'cathedral', 'chapel', 'shrine', 'pagoda', 'monastery', 'religious']);
const CIVIC = new Set(['school', 'university', 'college', 'kindergarten', 'hospital', 'civic', 'government', 'public', 'office', 'commercial', 'retail', 'supermarket', 'hotel']);

/**
 * 无 height/levels 标签时按用途 + 面积 + 长宽比估计高度。
 * 规律来自中国城市：板楼（细长）多为 6~11 层，点式塔楼（方正、300~1400 m²）多为 18~33 层。
 */
export function estimateHeight(tags, geom, rand, density = 1) {
  const t = tags.building || tags['building:part'] || 'yes';
  const explicit = parseLength(tags.height);
  const levels = parseFloat(tags['building:levels']);
  const roofLv = parseFloat(tags['roof:levels']) || 0;
  const minH = parseLength(tags.min_height) ?? (parseFloat(tags['building:min_level']) || 0) * 3.2;
  if (explicit && explicit > 0) return { h: explicit, mh: minH, est: 0, lv: Number.isFinite(levels) ? levels : Math.round(explicit / 3.2) };
  if (Number.isFinite(levels) && levels > 0) {
    const fh = levels >= 12 ? 3.1 : levels <= 2 ? 3.8 : 3.3;
    return { h: (levels + roofLv) * fh + (levels > 3 ? 1.5 : 0.5), mh: minH, est: 0, lv: levels };
  }
  const a = geom.area;
  const r = geom.ratio;
  const u = rand();
  let lv;
  if (SMALL.has(t)) return { h: 3 + u * 1.5, mh: minH, est: 1, lv: 1 };
  // 影像识别轮廓（补充数据，多在县城与城乡结合部）：没有用途标签，按县城实际以多层/低层为主，
  // 只有方正且面积适中的楼块才较大概率是高层住宅
  if (tags.source === 'imagery-footprint') {
    if (a < 120) lv = 1 + Math.round(u);
    else if (a < 300) lv = u < 0.7 ? 2 + Math.floor(u * 3) : 4 + Math.floor(u * 3);
    else if (a > 1800) lv = 2 + Math.floor(u * 3);
    else if (r < 2.2 && a < 1100) lv = u < 0.3 * density ? 11 + Math.floor(u * 50) : 5 + Math.floor(u * 3);
    else if (r >= 2.6) lv = u < 0.15 * density ? 11 + Math.floor(u * 45) : 4 + Math.floor(u * 4);
    else lv = 3 + Math.floor(u * 4);
    lv = Math.min(lv, 33);
    return { h: lv * 3.1 + 1.2, mh: minH, est: 1, lv };
  }
  if (HOUSES.has(t)) lv = 2 + Math.round(u);
  else if (RELIGIOUS.has(t)) return { h: 10 + u * 6, mh: minH, est: 1, lv: 1 };
  else if (INDUSTRIAL.has(t)) return { h: 8 + u * 8, mh: minH, est: 1, lv: 2 };
  else if (BIG_HALL.has(t)) return { h: 18 + u * 12, mh: minH, est: 1, lv: 3 };
  else if (t === 'construction') return { h: 4 + u * 20, mh: minH, est: 1, lv: 2 };
  else if (a < 60) lv = 1 + Math.round(u);
  else if (a < 220) lv = 2 + Math.floor(u * 3);
  else if (density < 0.35) lv = a > 900 ? 2 + Math.floor(u * 3) : 1 + Math.floor(u * 3); // 乡镇/景区：低层为主
  else if (CIVIC.has(t)) {
    if (a > 6000) lv = 3 + Math.floor(u * 3);
    else if (r < 2.2 && a < 2500 && u > 0.55) lv = 14 + Math.floor(u * 16);
    else lv = 4 + Math.floor(u * 6);
  } else if (a > 5000) lv = 3 + Math.floor(u * 4); // 商场/裙楼
  else if (r >= 2.6) lv = u < 0.62 ? 5 + Math.floor(u * 4) : 9 + Math.floor((u - 0.62) * 30); // 板楼：多为 5~8 层
  else if (a <= 1500) lv = u < 0.35 ? 6 + Math.floor(u * 15) : 15 + Math.floor((u - 0.35) * 28); // 点式：约 2/3 为高层
  else lv = 6 + Math.floor(u * 14);
  return { h: lv * 3.1 + 1.2, mh: minH, est: 1, lv };
}

/** 把多条 way 拼接成闭合环 */
export function joinRings(ways) {
  const pool = ways.filter((w) => w.length > 1).map((w) => w.slice());
  const rings = [];
  const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  while (pool.length) {
    let ring = pool.shift();
    let guard = 0;
    while (!same(ring[0], ring[ring.length - 1]) && guard++ < 1000) {
      const end = ring[ring.length - 1];
      const i = pool.findIndex((w) => same(w[0], end) || same(w[w.length - 1], end));
      if (i < 0) break;
      const w = pool.splice(i, 1)[0];
      ring = ring.concat(same(w[0], end) ? w.slice(1) : w.reverse().slice(1));
    }
    if (ring.length >= 4 && same(ring[0], ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}

const r7 = (v) => Math.round(v * 1e7) / 1e7;

export function processBuildings(osm, z, x, y) {
  const tb = tileBounds(z, x, y);
  const items = [];
  // 城市密度：z14 瓦片（约 5 km²）内建筑数，市区通常上千栋
  const nb = (osm.elements || []).filter((e) => e.tags?.building).length;
  const density = Math.min(1, nb / (600 * 4 ** (14 - z)));
  for (const el of osm.elements || []) {
    const tags = el.tags || {};
    const isPart = !!tags['building:part'] && !tags.building;
    if (!tags.building && !tags['building:part']) continue;
    if (tags.building === 'no' || tags['building:part'] === 'no') continue;
    // 地下建筑（地铁站、地下商场）不渲染
    if (/^(underground|underwater)$/.test(tags.location || '') || parseFloat(tags.layer) < 0 || tags.building === 'bunker') continue;
    let outers = [];
    let inners = [];
    if (el.type === 'way' && el.geometry) {
      outers = [el.geometry.map((p) => [p.lon, p.lat])];
    } else if (el.type === 'relation' && el.members) {
      const ow = [];
      const iw = [];
      for (const m of el.members) {
        if (m.type !== 'way' || !m.geometry) continue;
        const pts = m.geometry.filter(Boolean).map((p) => [p.lon, p.lat]);
        (m.role === 'inner' ? iw : ow).push(pts);
      }
      outers = joinRings(ow);
      inners = joinRings(iw);
    }
    outers.forEach((outerRaw, k) => {
      const outer = cleanRing(outerRaw, 1e-7);
      if (outer.length < 3) return;
      const lat0 = outer[0][1];
      const om = toMeters(outer, lat0);
      const a = area(om);
      if (a < 8) return;
      const [cx, cy] = centroid(outer);
      if (!(cx >= tb.w && cx < tb.e && cy >= tb.s && cy < tb.n)) return; // 以质心归属瓦片去重
      const holes = inners
        .map((r) => cleanRing(r, 1e-7))
        .filter((r) => r.length >= 3 && pointInPolygon(r[0][0], r[0][1], outer));
      const el2 = elongation(om);
      const rand = rng((el.id * 2654435761 + k) >>> 0);
      const hh = estimateHeight(tags, { area: a, ratio: el2.ratio }, rand, density);
      items.push({
        i: el.id,
        part: isPart ? 1 : 0,
        k: isPart ? tags['building:part'] : tags.building,
        h: Math.round(Math.max(hh.h, hh.mh + 2) * 10) / 10,
        mh: Math.round(hh.mh * 10) / 10,
        e: hh.est,
        lv: hh.lv,
        n: tags['name:zh'] || tags.name || undefined,
        c: tags['building:colour'] || undefined,
        m: tags['building:material'] || undefined,
        rs: tags['roof:shape'] || undefined,
        rh: parseLength(tags['roof:height']) ?? undefined,
        rc: tags['roof:colour'] || undefined,
        a: Math.round(a),
        cx: r7(cx),
        cy: r7(cy),
        p: outer.flatMap(([lo, la]) => [r7(lo), r7(la)]),
        ho: holes.length ? holes.map((h) => h.flatMap(([lo, la]) => [r7(lo), r7(la)])) : undefined,
      });
    });
  }
  // 有 building:part 的建筑轮廓不再单独渲染（Simple 3D Buildings 规范）
  const parts = items.filter((b) => b.part);
  let hiddenOutlines = 0;
  const out = items.filter((b) => {
    if (b.part || !parts.length) return true;
    const ring = [];
    for (let i = 0; i < b.p.length; i += 2) ring.push([b.p[i], b.p[i + 1]]);
    const covered = parts.some((p) => pointInPolygon(p.cx, p.cy, ring));
    if (covered) hiddenOutlines++;
    return !covered;
  });
  return { v: 4, z, x, y, count: out.length, density: +density.toFixed(2), hiddenOutlines, b: out };
}

/**
 * 合并补充建筑轮廓（OSM 未测绘区域的影像识别轮廓，见 data/buildings-supplement）。
 * 质心落在任一 OSM 建筑内的补充轮廓视为重复并丢弃，OSM 后续补测后自动让位。
 */
export function mergeSupplement(osm, supp) {
  if (!supp?.elements?.length) return osm;
  const rings = [];
  for (const el of osm.elements || []) {
    if (!el.tags?.building && !el.tags?.['building:part']) continue;
    const ways = el.type === 'way' ? [el.geometry] : (el.members || []).filter((m) => m.role !== 'inner').map((m) => m.geometry);
    for (const g of ways) {
      if (!g?.length) continue;
      const r = g.filter(Boolean).map((p) => [p.lon, p.lat]);
      let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
      for (const [lo, la] of r) {
        w = Math.min(w, lo); e = Math.max(e, lo); s = Math.min(s, la); n = Math.max(n, la);
      }
      rings.push({ r, w, s, e, n });
    }
  }
  const extra = supp.elements.filter((el) => {
    const g = el.geometry || el.members?.find((m) => m.role === 'outer')?.geometry;
    if (!g?.length) return false;
    const [cx, cy] = centroid(g.map((p) => [p.lon, p.lat]));
    return !rings.some((k) => cx >= k.w && cx <= k.e && cy >= k.s && cy <= k.n && pointInPolygon(cx, cy, k.r));
  });
  return { ...osm, elements: (osm.elements || []).concat(extra) };
}

export function buildingsQuery(z, x, y) {
  const b = tileBounds(z, x, y);
  const bb = `${b.s.toFixed(6)},${b.w.toFixed(6)},${b.n.toFixed(6)},${b.e.toFixed(6)}`;
  return `[out:json][timeout:90][maxsize:536870912];(way["building"](${bb});way["building:part"](${bb});relation["building"](${bb});relation["building:part"](${bb}););out body geom qt;`;
}

export async function fetchBuildings(z, x, y, priority = 0) {
  return dedupe(`b:${z}/${x}/${y}`, async () => processBuildings(await overpass(buildingsQuery(z, x, y), { priority }), z, x, y));
}

// ---------------------------------------------------------------- 城市要素（道路/水体/绿地），用于行道树与水面
export function featuresQuery(z, x, y) {
  const b = tileBounds(z, x, y);
  const bb = `${b.s.toFixed(6)},${b.w.toFixed(6)},${b.n.toFixed(6)},${b.e.toFixed(6)}`;
  return `[out:json][timeout:90];(way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|pedestrian)$"](${bb});way["natural"="water"](${bb});relation["natural"="water"](${bb});way["water"](${bb});way["landuse"~"^(grass|forest|recreation_ground|village_green)$"](${bb});way["leisure"~"^(park|garden)$"](${bb});way["natural"="wood"](${bb}););out body geom qt;`;
}

export function processFeatures(osm, z, x, y) {
  const tb = tileBounds(z, x, y);
  const roads = [];
  const water = [];
  const green = [];
  const clip = (pts) => pts.some(([lo, la]) => lo >= tb.w && lo <= tb.e && la >= tb.s && la <= tb.n);
  for (const el of osm.elements || []) {
    const t = el.tags || {};
    if (el.type === 'way' && el.geometry) {
      const pts = el.geometry.map((p) => [r7(p.lon), r7(p.lat)]);
      if (t.highway) {
        if (!clip(pts)) continue;
        const lanes = parseFloat(t.lanes);
        const w = { motorway: 24, trunk: 24, primary: 20, secondary: 15, tertiary: 11, residential: 7, unclassified: 7, living_street: 5, pedestrian: 6 }[t.highway] || 7;
        roads.push({ i: el.id, k: t.highway, w: Number.isFinite(lanes) ? Math.max(5, lanes * 3.4) : w, br: t.bridge === 'yes' || t.tunnel === 'yes' ? 1 : 0, n: t.name || undefined, p: pts.flat() });
      } else if (t.natural === 'water' || t.water) {
        const [cx, cy] = centroid(pts);
        if (cx >= tb.w && cx < tb.e && cy >= tb.s && cy < tb.n) water.push({ i: el.id, p: pts.flat() });
      } else {
        const [cx, cy] = centroid(pts);
        if (cx >= tb.w && cx < tb.e && cy >= tb.s && cy < tb.n) green.push({ i: el.id, k: t.leisure || t.landuse || t.natural, p: pts.flat() });
      }
    } else if (el.type === 'relation' && el.members && (t.natural === 'water' || t.water)) {
      const outers = joinRings(el.members.filter((m) => m.role !== 'inner' && m.geometry).map((m) => m.geometry.map((p) => [r7(p.lon), r7(p.lat)])));
      for (const ring of outers) {
        const [cx, cy] = centroid(ring);
        if (cx >= tb.w && cx < tb.e && cy >= tb.s && cy < tb.n) water.push({ i: el.id, p: ring.flat() });
      }
    }
  }
  return { v: 1, z, x, y, roads, water, green };
}

export async function fetchFeatures(z, x, y, priority = 0) {
  return dedupe(`f:${z}/${x}/${y}`, async () => processFeatures(await overpass(featuresQuery(z, x, y), { priority }), z, x, y));
}

// ---------------------------------------------------------------- 周边店铺
const SUB_ZH = {
  restaurant: '餐厅', fast_food: '快餐', food_court: '美食广场', cafe: '咖啡馆', bar: '酒吧', pub: '酒馆', ice_cream: '冷饮甜品',
  supermarket: '超市', convenience: '便利店', mall: '购物中心', department_store: '百货商场', clothes: '服装', shoes: '鞋店',
  bakery: '烘焙', books: '书店', gift: '礼品', electronics: '数码电器', mobile_phone: '手机', cosmetics: '美妆', jewelry: '珠宝',
  tea: '茶叶', confectionery: '糖果', beverages: '饮品', alcohol: '酒类', sports: '运动用品', toys: '玩具', optician: '眼镜',
  hotel: '酒店', hostel: '青年旅舍', guest_house: '民宿', motel: '汽车旅馆', apartment: '公寓式酒店',
  museum: '博物馆', attraction: '景点', gallery: '美术馆', viewpoint: '观景点', artwork: '艺术装置', theatre: '剧院', cinema: '电影院',
  pharmacy: '药店', bank: '银行', atm: 'ATM', car: '汽车', car_repair: '汽车维修', hairdresser: '美发', beauty: '美容', florist: '花店', furniture: '家居',
  hardware: '五金', stationery: '文具', variety_store: '杂货', kiosk: '报亭', laundry: '洗衣', optician: '眼镜', bicycle: '自行车', pet: '宠物', photo: '摄影',
  chemist: '日化', copyshop: '打印', travel_agency: '旅行社', tobacco: '烟酒', wine: '酒类', seafood: '海鲜', butcher: '肉铺', greengrocer: '果蔬', mobile_phone_accessories: '手机配件',
  computer: '电脑', bag: '箱包', watches: '钟表', sports_centre: '运动', arts_centre: '艺术中心', fashion: '时装', boutique: '精品店', massage: '按摩', tailor: '裁缝',
};
const CUISINE_ZH = {
  chinese: '中餐', noodle: '面馆', noodles: '面馆', hot_pot: '火锅', hotpot: '火锅', bbq: '烧烤', barbecue: '烧烤', seafood: '海鲜', coffee_shop: '咖啡',
  japanese: '日料', korean: '韩餐', western: '西餐', pizza: '披萨', burger: '汉堡', chicken: '炸鸡', sichuan: '川菜', cantonese: '粤菜',
  henan: '豫菜', halal: '清真', dumpling: '饺子', dumplings: '饺子', tea: '茶饮', bubble_tea: '奶茶', dessert: '甜品', sandwich: '三明治', steak_house: '牛排',
};
function poiCategory(t) {
  if (['restaurant', 'fast_food', 'food_court'].includes(t.amenity)) return 'food';
  if (['cafe', 'bar', 'pub', 'ice_cream'].includes(t.amenity)) return 'drink';
  if (t.tourism && ['hotel', 'hostel', 'guest_house', 'motel', 'apartment'].includes(t.tourism)) return 'hotel';
  if (t.tourism || ['theatre', 'cinema', 'arts_centre'].includes(t.amenity)) return 'sight';
  if (t.shop) return 'shop';
  return 'service';
}

export async function fetchPoisOverpass(lat, lon, radius) {
  const r = Math.round(radius);
  const q = `[out:json][timeout:40];(nwr(around:${r},${lat},${lon})["amenity"~"^(restaurant|fast_food|food_court|cafe|bar|pub|ice_cream|theatre|cinema|arts_centre|pharmacy|bank)$"]["name"];nwr(around:${r},${lat},${lon})["shop"]["name"];nwr(around:${r},${lat},${lon})["tourism"~"^(hotel|hostel|guest_house|motel|apartment|museum|attraction|gallery|viewpoint|artwork)$"]["name"];);out center tags 400;`;
  const osm = await overpass(q, { timeoutMs: 60000, priority: 5 });
  const list = [];
  for (const el of osm.elements || []) {
    const t = el.tags || {};
    const la = el.lat ?? el.center?.lat;
    const lo = el.lon ?? el.center?.lon;
    if (la == null || !t.name) continue;
    const sub = t.amenity || t.shop || t.tourism;
    const cuisine = (t.cuisine || '').split(';').map((c) => CUISINE_ZH[c.trim()] || '').filter(Boolean);
    list.push({
      id: `osm-${el.type[0]}${el.id}`,
      name: t['name:zh'] || t.name,
      nameEn: t['name:en'] || undefined,
      cat: poiCategory(t),
      sub: cuisine[0] || SUB_ZH[sub] || (/^[a-z_ ]+$/i.test(sub || '') ? { food: '餐饮', drink: '饮品', shop: '商店', hotel: '住宿', sight: '休闲娱乐' }[poiCategory(t)] || '生活服务' : sub),
      lat: la,
      lon: lo,
      dist: Math.round(haversine(lon, lat, lo, la)),
      addr: [t['addr:district'], t['addr:street'], t['addr:housenumber']].filter(Boolean).join('') || undefined,
      phone: t.phone || t['contact:phone'] || undefined,
      hours: t.opening_hours || undefined,
      web: t.website || t['contact:website'] || undefined,
      brand: t.brand || undefined,
      stars: t.stars || undefined,
      src: 'OpenStreetMap',
    });
  }
  list.sort((a, b) => a.dist - b.dist);
  return list;
}

// ---------------------------------------------------------------- 自动发现城市景点（任意城市）
export async function fetchAttractions(lat, lon, radius = 12000, limit = 8) {
  const r = Math.round(radius);
  const q = `[out:json][timeout:60];(nwr(around:${r},${lat},${lon})["tourism"~"^(attraction|museum|viewpoint|theme_park|zoo|gallery|aquarium)$"]["name"];nwr(around:${r},${lat},${lon})["historic"~"^(monument|memorial|castle|city_gate|temple|ruins|archaeological_site|tower|palace|city_walls)$"]["name"];nwr(around:${r},${lat},${lon})["man_made"="tower"]["name"]["wikidata"];nwr(around:${r},${lat},${lon})["leisure"="park"]["name"]["wikipedia"];nwr(around:${r},${lat},${lon})["amenity"="place_of_worship"]["name"]["wikipedia"];);out center tags 600;`;
  const osm = await overpass(q, { timeoutMs: 90000, priority: 8 });
  const cands = [];
  for (const el of osm.elements || []) {
    const t = el.tags || {};
    const la = el.lat ?? el.center?.lat;
    const lo = el.lon ?? el.center?.lon;
    if (la == null) continue;
    let s = 0;
    if (t.wikipedia) s += 4;
    if (t.wikidata) s += 3;
    if (t['name:en']) s += 1;
    if (['museum', 'attraction', 'theme_park', 'zoo'].includes(t.tourism)) s += 1.5;
    if (t.historic) s += 1;
    if (t.heritage) s += 2;
    if (el.type !== 'node') s += 1;
    s -= haversine(lon, lat, lo, la) / 15000; // 越靠近市中心越优先
    cands.push({
      id: `osm-${el.type[0]}${el.id}`,
      name: t['name:zh'] || t.name,
      nameEn: t['name:en'],
      lat: la,
      lon: lo,
      kind: t.tourism || t.historic || t.man_made || t.leisure || t.amenity,
      wiki: t.wikipedia,
      wikidata: t.wikidata,
      score: s,
    });
  }
  cands.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const c of cands) {
    if (picked.length >= limit) break;
    if (picked.some((p) => haversine(p.lon, p.lat, c.lon, c.lat) < 700 || p.name === c.name)) continue;
    picked.push(c);
  }
  return picked;
}
