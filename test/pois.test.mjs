import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiskCache } from '../server/upstream.mjs';
import { createPoisService } from '../server/pois.mjs';

const location = [35.85, 115.5, 800];
const amapItem = { id: 'amap-example', name: '示例饭店', src: '高德地图' };
const osmItem = { id: 'node-example', name: '示例商店', src: 'OpenStreetMap' };

async function cacheFor(t) {
  const root = await mkdtemp(join(tmpdir(), 'cloud-tour-pois-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return new DiskCache(root);
}

test('高德失败和 OSM 空结果返回可重试错误，下一次高德恢复不受旧缓存影响', async (t) => {
  const cache = await cacheFor(t);
  // 复现旧版被污染的高德缓存，修复后的命名空间必须忽略它。
  await cache.json('pois', 'amap:35.8500,115.5000,800', 86400e3, async () => ({ source: 'OpenStreetMap', radius: 800, items: [] }));
  let amapCalls = 0;
  let osmCalls = 0;
  const pois = createPoisService({
    cache, amapKey: 'test-key',
    fetchAmap: async () => {
      if (++amapCalls === 1) throw new Error('QPS limit');
      return [amapItem];
    },
    fetchOsm: async () => { osmCalls++; return []; },
  });
  await assert.rejects(pois(...location), (e) => e.status === 503);
  assert.deepEqual(await pois(...location), { source: '高德地图', radius: 800, items: [amapItem] });
  assert.equal(amapCalls, 2);
  assert.equal(osmCalls, 1);
});

test('高德正常空结果降级到 OSM 时来源正确，两个来源分别缓存', async (t) => {
  const cache = await cacheFor(t);
  let amapCalls = 0;
  let osmCalls = 0;
  const pois = createPoisService({
    cache, amapKey: 'test-key',
    fetchAmap: async () => { amapCalls++; return []; },
    fetchOsm: async () => { osmCalls++; return [osmItem]; },
  });
  const expected = { source: 'OpenStreetMap', radius: 800, items: [osmItem] };
  assert.deepEqual(await pois(...location), expected);
  assert.deepEqual(await pois(...location), expected);
  assert.equal(amapCalls, 1);
  assert.equal(osmCalls, 1);
  assert.deepEqual((await readdir(cache.path('api'))).sort(), ['pois-v2-amap', 'pois-v2-osm']);
});

test('高德并发查询合并，成功结果可跨服务实例从磁盘复用，缓存不含 Key', async (t) => {
  const cache = await cacheFor(t);
  let calls = 0;
  const secret = 'test-secret-not-for-cache';
  const fetchAmap = async (_lat, _lon, _r, key) => {
    assert.equal(key, secret);
    calls++;
    await new Promise((resolve) => setImmediate(resolve));
    return [amapItem];
  };
  const fetchOsm = async () => assert.fail('不应请求 OSM');
  const pois = createPoisService({ cache, amapKey: secret, fetchAmap, fetchOsm });
  const results = await Promise.all(Array.from({ length: 8 }, () => pois(...location)));
  assert.equal(calls, 1);
  assert.ok(results.every((r) => r.source === '高德地图' && r.items.length === 1));
  const fromDisk = createPoisService({ cache: new DiskCache(cache.root), amapKey: secret, fetchAmap, fetchOsm });
  assert.deepEqual(await fromDisk(...location), results[0]);
  assert.equal(calls, 1);
  const names = await readdir(cache.path('api', 'pois-v2-amap'));
  assert.equal(names.length, 1);
  assert.equal(names.join('').includes(secret), false);
  assert.equal((await readFile(cache.path('api', 'pois-v2-amap', names[0]), 'utf8')).includes(secret), false);
});

test('高德失败后 OSM 非空可用，但不污染高德缓存；随后仍尝试高德', async (t) => {
  const cache = await cacheFor(t);
  let calls = 0;
  const pois = createPoisService({
    cache, amapKey: 'test-key',
    fetchAmap: async () => { if (++calls === 1) throw new Error('temporary'); return [amapItem]; },
    fetchOsm: async () => [osmItem],
  });
  assert.equal((await pois(...location)).source, 'OpenStreetMap');
  assert.deepEqual(await readdir(cache.path('api')), ['pois-v2-osm']);
  assert.equal((await pois(...location)).source, '高德地图');
  assert.equal(calls, 2);
});

test('两个上游失败不会缓存错误，下次请求会重试且错误不泄露凭据', async (t) => {
  const cache = await cacheFor(t);
  let amapCalls = 0;
  let osmCalls = 0;
  const pois = createPoisService({
    cache, amapKey: 'test-secret',
    fetchAmap: async () => { amapCalls++; throw new Error('https://example.test?key=test-secret'); },
    fetchOsm: async () => { osmCalls++; throw new Error('upstream failure'); },
  });
  for (let i = 0; i < 2; i++) {
    await assert.rejects(pois(...location), (e) => e.status === 503 && !e.message.includes('test-secret'));
  }
  assert.equal(amapCalls, 2);
  assert.equal(osmCalls, 2);
  await assert.rejects(readdir(cache.path('api')), { code: 'ENOENT' });
});

test('无高德 Key 时 OSM 的真实空结果合法并缓存', async (t) => {
  const cache = await cacheFor(t);
  let calls = 0;
  const pois = createPoisService({
    cache,
    fetchAmap: async () => assert.fail('未配置 Key 不应请求高德'),
    fetchOsm: async () => { calls++; return []; },
  });
  assert.deepEqual(await pois(...location), { source: 'OpenStreetMap', radius: 800, items: [] });
  assert.deepEqual(await pois(...location), { source: 'OpenStreetMap', radius: 800, items: [] });
  assert.equal(calls, 1);
});
