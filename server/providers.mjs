// 第三方内容接口：Wikivoyage 旅游攻略、维基百科摘要、Open-Meteo 天气、Nominatim 地理编码、高德周边（可选）。
import { Limiter, fetchWithTimeout, retry, HttpError } from './upstream.mjs';
import { gcj02ToWgs84, wgs84ToGcj02, haversine } from '../public/src/core/geo.js';

const wikiLimiter = new Limiter(4);
const nominatimLimiter = new Limiter(1, 1100); // Nominatim 使用政策：≤1 次/秒

async function getJson(url, opts = {}, timeout = 25000) {
  return retry(
    async () => {
      const res = await fetchWithTimeout(url, opts, timeout);
      if (res.status === 404) throw new HttpError(404, 'not found');
      if (!res.ok) throw new HttpError(res.status, `${new URL(url).host} ${res.status}`);
      return res.json();
    },
    { tries: 3, shouldRetry: (e) => e.status !== 404 },
  );
}

// ---------------------------------------------------------------- Wikivoyage 攻略
const SECTION_ALIAS = {
  Understand: '了解', 'Get in': '抵达', 'Get around': '当地交通', See: '景点', Do: '活动', Buy: '购物', Eat: '美食', Drink: '饮品',
  Sleep: '住宿', Connect: '通讯', 'Stay safe': '安全', 'Go next': '周边',
  离开: '周边', 出行: '当地交通', 游览: '景点', 观光: '景点', 饮食: '美食', 餐饮: '美食', 购物: '购物', 住宿: '住宿',
};
const LISTING_TEMPLATES = /^(see|do|buy|eat|drink|sleep|listing|go|景点|活动|购物|餐饮|饮食|美食|住宿|饮品|列表)$/i;

/** 取出最外层 {{ }} 模板（支持嵌套）并交给回调替换 */
function replaceTemplates(text, fn) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const s = text.indexOf('{{', i);
    if (s < 0) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, s);
    let depth = 0;
    let j = s;
    for (; j < text.length - 1; j++) {
      if (text[j] === '{' && text[j + 1] === '{') {
        depth++;
        j++;
      } else if (text[j] === '}' && text[j + 1] === '}') {
        depth--;
        j++;
        if (depth === 0) break;
      }
    }
    const inner = text.slice(s + 2, j - 1);
    out += fn(inner) ?? '';
    i = j + 1;
  }
  return out;
}

function parseTemplateArgs(inner) {
  // 按顶层 | 切分（忽略 [[ ]] 与嵌套 {{ }} 内的 |）
  const parts = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    const two = inner.slice(i, i + 2);
    if (two === '[[' || two === '{{') {
      depth++;
      cur += two;
      i++;
      continue;
    }
    if (two === ']]' || two === '}}') {
      depth--;
      cur += two;
      i++;
      continue;
    }
    if (inner[i] === '|' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += inner[i];
  }
  parts.push(cur);
  const name = parts.shift().trim();
  const args = {};
  parts.forEach((p, idx) => {
    const eq = p.indexOf('=');
    if (eq > 0 && !/[[{]/.test(p.slice(0, eq))) args[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim();
    else args[idx + 1] = p.trim();
  });
  return { name, args };
}

export function cleanWikitext(s) {
  return s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/\[\[(?:File|Image|文件|图像|檔案):[^\]]*(?:\[\[[^\]]*\]\][^\]]*)*\]\]/gi, '')
    .replace(/\[\[(?:Category|分类):[^\]]*\]\]/gi, '')
    .replace(/\[\[([^|\]]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\[(https?:\/\/[^\s\]]+)\s+([^\]]+)\]/g, '$2')
    .replace(/\[(https?:\/\/[^\s\]]+)\]/g, '')
    .replace(/'''''|'''|''/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+\n/g, '\n');
}

export function parseWikivoyage(wikitext) {
  const listings = [];
  let text = replaceTemplates(wikitext, (inner) => {
    const { name, args } = parseTemplateArgs(inner);
    if (LISTING_TEMPLATES.test(name)) {
      const item = {
        type: (args.type || name).toLowerCase(),
        name: cleanWikitext(args.name || args[1] || '').trim(),
        alt: cleanWikitext(args.alt || '').trim() || undefined,
        address: cleanWikitext(args.address || '').trim() || undefined,
        lat: parseFloat(args.lat) || undefined,
        lon: parseFloat(args.long || args.lon) || undefined,
        hours: cleanWikitext(args.hours || '').trim() || undefined,
        price: cleanWikitext(args.price || '').trim() || undefined,
        phone: args.phone || undefined,
        content: cleanWikitext(replaceTemplates(args.content || args.description || '', () => '')).trim() || undefined,
      };
      if (item.name) {
        listings.push(item);
        return `\n@@L${listings.length - 1}@@\n`;
      }
      return '';
    }
    // 常见的内联模板保留其文字
    if (/^(lang|lang-\w+|nowrap|smaller|small|big|zh|en)$/i.test(name)) return args[2] || args[1] || '';
    if (/^(航空|铁路|公路|水路|巴士|by plane|by train|by bus|by car|by boat|by bike|on foot|by taxi|by metro|by subway)$/i.test(name)) return name.replace(/^by /i, '');
    if (/^(marker|vcard)$/i.test(name)) return args.name || '';
    return '';
  });
  text = cleanWikitext(text);
  const sections = [];
  let cur = { title: '概述', level: 2, lines: [] };
  for (const raw of text.split('\n')) {
    const h = /^(={2,4})\s*(.*?)\s*\1\s*$/.exec(raw);
    if (h) {
      if (cur.lines.length || cur.items) sections.push(cur);
      const title = h[2].trim();
      cur = { title: SECTION_ALIAS[title] || title, raw: title, level: h[1].length, lines: [] };
      continue;
    }
    const lm = /@@L(\d+)@@/.exec(raw);
    if (lm) {
      (cur.items ||= []).push(listings[+lm[1]]);
      continue;
    }
    const line = raw.replace(/^[*#:]+\s*/, (m) => (m.includes('*') || m.includes('#') ? '• ' : '')).trim();
    if (line && line !== '•') cur.lines.push(line);
  }
  if (cur.lines.length || cur.items) sections.push(cur);
  return sections
    .map((s) => ({ title: s.title, level: s.level, text: s.lines.join('\n').slice(0, 4000), items: s.items?.slice(0, 40) }))
    .filter((s) => s.text || s.items?.length);
}

export async function fetchGuide(city, cityEn) {
  const tries = [
    ['zh', city],
    ['en', cityEn],
  ].filter(([, t]) => t);
  let failure = null;
  for (const [lang, title] of tries) {
    try {
      const url = `https://${lang}.wikivoyage.org/w/api.php?action=parse&format=json&formatversion=2&redirects=1&prop=wikitext&page=${encodeURIComponent(title)}`;
      const data = await wikiLimiter.run(() => getJson(url, { headers: { 'Accept-Language': 'zh-CN' } }));
      if (!data.parse?.wikitext) continue;
      const sections = parseWikivoyage(data.parse.wikitext);
      if (!sections.length) continue;
      return {
        source: `Wikivoyage (${lang})`,
        title: data.parse.title,
        url: `https://${lang}.wikivoyage.org/wiki/${encodeURIComponent(data.parse.title)}`,
        license: 'CC BY-SA 4.0',
        lang,
        sections,
      };
    } catch (e) {
      if (e.status !== 404) {
        console.warn('[guide]', lang, title, e.message);
        failure = e;
      }
    }
  }
  // 上游故障不能当作“没有攻略”写入 7 天缓存：抛出让本次请求失败、下次重试
  if (failure) throw new HttpError(failure.status >= 500 ? failure.status : 502, `guide upstream: ${failure.message}`);
  return { source: null, sections: [] };
}

// ---------------------------------------------------------------- 维基百科摘要
export async function fetchWikiSummary(title, lang = 'zh') {
  const headers = { 'Accept-Language': lang === 'zh' ? 'zh-CN' : lang };
  const summary = async (t) => {
    const d = await wikiLimiter.run(() => getJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}?redirect=true`, { headers }));
    if (d.type === 'disambiguation') throw new HttpError(404, 'disambiguation');
    return {
      title: d.title,
      extract: d.extract,
      description: d.description,
      thumbnail: d.thumbnail?.source,
      image: d.originalimage?.source,
      url: d.content_urls?.desktop?.page,
      coordinates: d.coordinates,
      source: `维基百科 (${lang})`,
      license: 'CC BY-SA 4.0',
    };
  };
  try {
    return await summary(title);
  } catch (e) {
    if (e.status !== 404) throw e;
    const s = await wikiLimiter.run(() =>
      getJson(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&formatversion=2&srlimit=1&srsearch=${encodeURIComponent(title)}`, { headers }),
    );
    const hit = s.query?.search?.[0];
    if (!hit) return null;
    return summary(hit.title);
  }
}

// ---------------------------------------------------------------- 天气（Open-Meteo，无需密钥）
const WMO = {
  0: '晴', 1: '晴间多云', 2: '多云', 3: '阴', 45: '雾', 48: '冻雾', 51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨', 56: '冻毛毛雨', 57: '冻毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '冻雨', 71: '小雪', 73: '中雪', 75: '大雪', 77: '米雪', 80: '阵雨', 81: '阵雨', 82: '强阵雨',
  85: '阵雪', 86: '强阵雪', 95: '雷阵雨', 96: '雷阵雨伴冰雹', 99: '强雷阵雨伴冰雹',
};
export async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day,cloud_cover,precipitation&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max&timezone=auto&forecast_days=4`;
  const d = await getJson(url);
  const c = d.current;
  return {
    source: 'Open-Meteo',
    timezone: d.timezone,
    utcOffset: d.utc_offset_seconds,
    current: {
      time: c.time,
      temp: c.temperature_2m,
      feels: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      wind: c.wind_speed_10m,
      code: c.weather_code,
      text: WMO[c.weather_code] ?? '—',
      isDay: !!c.is_day,
      cloud: c.cloud_cover,
      precip: c.precipitation,
    },
    daily: d.daily.time.map((t, i) => ({
      date: t,
      code: d.daily.weather_code[i],
      text: WMO[d.daily.weather_code[i]] ?? '—',
      max: d.daily.temperature_2m_max[i],
      min: d.daily.temperature_2m_min[i],
      rain: d.daily.precipitation_probability_max?.[i],
      sunrise: d.daily.sunrise[i],
      sunset: d.daily.sunset[i],
    })),
  };
}

// ---------------------------------------------------------------- 地理编码
// Photon（komoot，同为 OSM 数据）：部分网络环境屏蔽 Nominatim 时的兜底
async function geocodePhoton(q) {
  const d = await getJson(`https://photon.komoot.io/api/?limit=10&q=${encodeURIComponent(q)}`);
  const rank = { city: 16, town: 18, state: 8, country: 4, county: 12, district: 14, village: 19 };
  return (d.features || []).map((f) => {
    const p = f.properties || {};
    const [lon, lat] = f.geometry.coordinates;
    const isPlace = p.osm_key === 'place' || p.osm_key === 'boundary';
    const parts = [p.name, p.district, p.city !== p.name ? p.city : null, p.state, p.country].filter(Boolean);
    return {
      name: p.name || p.city || q,
      display: [...new Set(parts)].join(', '),
      lat,
      lon,
      kind: isPlace ? `place/${p.type || p.osm_value}` : `${p.osm_key}/${p.osm_value}`,
      rank: rank[p.type] ?? 30,
      importance: isPlace ? 0.6 : 0.3,
      bbox: p.extent ? [p.extent[3], p.extent[1], p.extent[0], p.extent[2]] : undefined,
      source: 'Photon',
    };
  });
}

export async function geocode(q) {
  try {
    return await geocodeNominatim(q);
  } catch (e) {
    console.warn('[geocode] nominatim failed, fallback to photon:', e.message);
    return geocodePhoton(q);
  }
}

async function geocodeNominatim(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&accept-language=zh-CN,zh,en&addressdetails=1&extratags=1&q=${encodeURIComponent(q)}`;
  const list = await nominatimLimiter.run(() => getJson(url));
  return list.map((r) => ({
    name: r.name || r.display_name.split(',')[0],
    display: r.display_name,
    lat: +r.lat,
    lon: +r.lon,
    kind: `${r.category}/${r.type}`,
    rank: r.place_rank,
    importance: r.importance,
    bbox: r.boundingbox?.map(Number),
    nameEn: r.extratags?.['name:en'],
    wikipedia: r.extratags?.wikipedia,
    population: r.extratags?.population ? +r.extratags.population : undefined,
  }));
}

// ---------------------------------------------------------------- 高德周边（配置 AMAP_KEY 后启用，数据更贴近国内）
const AMAP_TYPES = '050000|060000|080000|100000|110000|140000';
// 分页、并发景点和重试共用一条请求队列，避免免费 Web 服务的每秒配额被瞬时请求耗尽。
const amapLimiter = new Limiter(1, 1100);
const AMAP_QPS_CODES = new Set(['10019', '10020', '10021']);
const AMAP_QPS_INFO = /^(?:C|CK|CU|CUK|K)?QPS_HAS_EXCEEDED_THE_LIMIT$/;

function amapError(message, retryable = false, status = 502) {
  const error = new HttpError(status, `amap: ${message}`);
  error.retryable = retryable;
  return error;
}

async function getAmapJson(url) {
  return retry(
    () => amapLimiter.run(async () => {
      let res;
      try {
        res = await fetchWithTimeout(url, {}, 25000);
      } catch (e) {
        // 原始网络错误可能含带 Key 的 URL，日志与 API 错误只保留固定诊断文本。
        throw amapError(e.name === 'AbortError' ? 'request timed out' : 'network request failed', true);
      }
      if (!res.ok) {
        const transient = res.status === 429 || res.status >= 500;
        throw amapError(`HTTP ${res.status}`, transient, res.status === 429 ? 503 : 502);
      }
      let data;
      try {
        data = await res.json();
      } catch {
        throw amapError('invalid JSON response');
      }
      if (data?.status !== '1') {
        const code = /^\d{5}$/.test(String(data?.infocode)) ? String(data.infocode) : 'unknown';
        const limited = AMAP_QPS_CODES.has(code) || AMAP_QPS_INFO.test(data?.info || '');
        // 只重试明确的瞬时 QPS 限流；密钥、权限、每日配额等错误立即交给调用方。
        throw amapError(`${limited ? 'QPS limit' : 'API rejected request'} (infocode ${code})`, limited, limited ? 503 : 502);
      }
      return data;
    }),
    { tries: 3, baseDelay: 1100, shouldRetry: (e) => e.retryable === true },
  );
}

function amapCategory(typecode) {
  const p = typecode.slice(0, 2);
  if (p === '05') return typecode.startsWith('0505') || typecode.startsWith('0507') ? 'drink' : 'food';
  if (p === '06') return 'shop';
  if (p === '10') return 'hotel';
  if (p === '11' || p === '14') return 'sight';
  return 'service';
}
export async function fetchPoisAmap(lat, lon, radius, key) {
  const g = wgs84ToGcj02(lon, lat);
  const out = [];
  for (let page = 1; page <= 3; page++) {
    const url = `https://restapi.amap.com/v5/place/around?key=${key}&location=${g.lon.toFixed(6)},${g.lat.toFixed(6)}&radius=${Math.round(radius)}&types=${AMAP_TYPES}&page_size=25&page_num=${page}&show_fields=business,photos`;
    const d = await getAmapJson(url);
    for (const p of d.pois || []) {
      const [glon, glat] = p.location.split(',').map(Number);
      const w = gcj02ToWgs84(glon, glat);
      out.push({
        id: `amap-${p.id}`,
        name: p.name,
        cat: amapCategory(p.typecode || ''),
        sub: (p.type || '').split(';').pop(),
        lat: w.lat,
        lon: w.lon,
        dist: Math.round(haversine(lon, lat, w.lon, w.lat)),
        addr: p.address || undefined,
        phone: p.business?.tel || undefined,
        hours: p.business?.opentime_today || p.business?.opentime_week || undefined,
        rating: p.business?.rating ? +p.business.rating : undefined,
        cost: p.business?.cost ? +p.business.cost : undefined,
        photo: p.photos?.[0]?.url,
        src: '高德地图',
      });
    }
    if ((d.pois || []).length < 25) break;
  }
  out.sort((a, b) => a.dist - b.dist);
  return out;
}
