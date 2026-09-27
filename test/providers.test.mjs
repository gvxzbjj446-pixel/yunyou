// 第三方接口降级回归：上游故障不能被当作“无数据”写入长期缓存
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchGuide } from '../server/providers.mjs';

async function withFetch(impl, fn) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = orig;
  }
}

test('攻略：上游网络故障时抛错（不返回可缓存的空攻略）', async () => {
  await withFetch(
    async () => {
      throw new TypeError('fetch failed');
    },
    () => assert.rejects(fetchGuide('郑州', 'Zhengzhou'), (e) => e.status === 502),
  );
});

test('攻略：词条确实不存在时返回空攻略', async () => {
  const g = await withFetch(async () => new Response('{}', { status: 404 }), () => fetchGuide('某地', 'Nowhere'));
  assert.deepEqual(g, { source: null, sections: [] });
});
