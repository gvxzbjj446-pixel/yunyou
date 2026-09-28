// 按实际数据源缓存周边地点，避免高德临时失败把 OSM 空结果写入高德的长期缓存。
import { dedupe, HttpError } from './upstream.mjs';

const DAY = 86400e3;
let serviceId = 0;

export function createPoisService({ cache, fetchAmap, fetchOsm, amapKey = '' }) {
  const prefix = `pois-service-${++serviceId}`;
  return (lat, lon, radius) => {
    const key = `${lat.toFixed(4)},${lon.toFixed(4)},${Math.round(radius)}`;
    return dedupe(`${prefix}:${key}`, async () => {
      let amapFailed = false;
      if (amapKey) {
        try {
          // v2 不读取旧版混合来源的 pois 缓存；Key 不参与缓存键或文件内容。
          const items = await cache.json('pois-v2-amap', key, DAY, () => fetchAmap(lat, lon, radius, amapKey));
          if (items.length) return { source: '高德地图', radius, items: items.slice(0, 200) };
        } catch {
          amapFailed = true;
        }
      }

      let items;
      try {
        items = await cache.json('pois-v2-osm', key, DAY, () => fetchOsm(lat, lon, radius));
      } catch {
        // 不传播可能带凭据的上游错误，也不缓存请求失败。
        throw new HttpError(503, '附近店铺数据暂时不可用，请稍后重试。');
      }
      if (amapFailed && !items.length) {
        throw new HttpError(503, '高德地点查询暂时不可用，请稍后重试。');
      }
      return { source: 'OpenStreetMap', radius, items: items.slice(0, 200) };
    });
  };
}
