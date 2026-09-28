// 此文件由 node --test 在独立进程执行，fetch 替身不会影响其他提供方测试。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchPoisAmap } from '../server/providers.mjs';

const KEY = 'test-only-key';
const poi = (id) => ({ id: String(id), name: `店铺 ${id}`, location: '115.51,35.85', typecode: '050000', type: '餐饮服务' });
const ok = (pois = [poi(1)]) => Response.json({ status: '1', infocode: '10000', pois });
const fail = (infocode, info) => Response.json({ status: '0', infocode, info });
const query = (radius = 1000) => fetchPoisAmap(35.85554, 115.50572, radius, KEY);

async function withFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

test('高德：HTTP 200 中的 QPS 错误会重试，成功后返回真实 POI', async () => {
  const starts = [];
  await withFetch(async () => {
    starts.push(performance.now());
    return starts.length === 1 ? fail('10021', 'CUQPS_HAS_EXCEEDED_THE_LIMIT') : ok();
  }, async () => {
    const items = await query();
    assert.equal(starts.length, 2);
    assert.equal(items[0].id, 'amap-1');
    assert.equal(items[0].src, '高德地图');
    assert.ok(starts[1] - starts[0] >= 1050, 'retry must also respect the shared request interval');
  });
});

test('高德：密钥、权限和每日配额错误不重复请求', async () => {
  for (const [code, info] of [['10001', 'INVALID_USER_KEY'], ['10012', 'INSUFFICIENT_PRIVILEGES'], ['10003', 'DAILY_QUERY_OVER_LIMIT']]) {
    let calls = 0;
    await withFetch(async () => {
      calls++;
      return fail(code, info);
    }, async () => {
      await assert.rejects(query(), (e) => e.message.includes(code) && !e.message.includes(KEY));
      assert.equal(calls, 1, `permanent error ${code} must not be retried`);
    });
  }
});

test('高德：两个并发景点的所有分页共用每秒请求限制', async () => {
  const requests = [];
  let active = 0;
  let peakActive = 0;
  await withFetch(async (url) => {
    active++;
    peakActive = Math.max(peakActive, active);
    const params = new URL(url).searchParams;
    const page = Number(params.get('page_num'));
    const radius = params.get('radius');
    requests.push({ page, radius, start: performance.now() });
    await new Promise((resolve) => setTimeout(resolve, 30));
    active--;
    return ok(page === 1 ? Array.from({ length: 25 }, (_, i) => poi(`${radius}-${i}`)) : [poi(`${radius}-last`)]);
  }, async () => {
    const results = await Promise.all([query(1000), query(1001)]);
    assert.deepEqual(results.map((items) => items.length), [26, 26]);
    assert.equal(peakActive, 1);
    assert.equal(requests.length, 4);
    for (const radius of ['1000', '1001']) assert.deepEqual(requests.filter((r) => r.radius === radius).map((r) => r.page), [1, 2]);
    for (let i = 1; i < requests.length; i++) {
      assert.ok(requests[i].start - requests[i - 1].start >= 1050, 'all request starts must be separated, including across callers');
    }
  });
});

test('高德：HTTP 429 和 503 经过相同节流队列有界重试', async () => {
  const starts = [];
  await withFetch(async () => {
    starts.push(performance.now());
    if (starts.length === 1) return new Response('', { status: 429 });
    if (starts.length === 2) return new Response('', { status: 503 });
    return ok();
  }, async () => {
    assert.equal((await query()).length, 1);
    assert.equal(starts.length, 3);
    for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 1050);
  });
});

test('高德：网络持续失败只请求三次，异常不泄露带 Key 的 URL', async () => {
  let calls = 0;
  await withFetch(async (url) => {
    calls++;
    throw new TypeError(`failed to fetch ${url}`);
  }, async () => {
    await assert.rejects(query(), (e) => e.message === 'amap: network request failed' && !e.message.includes(KEY));
    assert.equal(calls, 3);
  });
});

test('高德：后续分页失败时不把前页部分数据当作成功返回', async () => {
  const pages = [];
  await withFetch(async (url) => {
    const page = Number(new URL(url).searchParams.get('page_num'));
    pages.push(page);
    return page === 1 ? ok(Array.from({ length: 25 }, (_, i) => poi(i))) : fail('10001', 'INVALID_USER_KEY');
  }, async () => {
    await assert.rejects(query(), /infocode 10001/);
    assert.deepEqual(pages, [1, 2]);
  });
});
