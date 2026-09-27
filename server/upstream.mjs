// 上游请求：并发限流、超时、重试、同 key 请求合并、磁盘缓存。
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

export const UA = 'CloudTour3D/0.1 (+local dev; three.js city tour demo)';

export class Limiter {
  constructor(concurrency, minIntervalMs = 0) {
    this.c = concurrency;
    this.gap = minIntervalMs;
    this.active = 0;
    this.q = [];
    this.last = 0;
  }
  run(fn, priority = 0) {
    return new Promise((resolve, reject) => {
      this.q.push({ fn, resolve, reject, priority });
      this.q.sort((a, b) => b.priority - a.priority);
      this.#pump();
    });
  }
  get pending() {
    return this.q.length + this.active;
  }
  #pump() {
    while (this.active < this.c && this.q.length) {
      const wait = this.gap ? Math.max(0, this.last + this.gap - Date.now()) : 0;
      if (wait > 0) {
        if (!this.timer) this.timer = setTimeout(() => ((this.timer = null), this.#pump()), wait);
        return;
      }
      const job = this.q.shift();
      this.active++;
      this.last = Date.now();
      Promise.resolve()
        .then(job.fn)
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active--;
          this.#pump();
        });
    }
  }
}

export class HttpError extends Error {
  constructor(status, msg) {
    super(msg || `HTTP ${status}`);
    this.status = status;
  }
}

export async function fetchWithTimeout(url, opts = {}, timeoutMs = 30000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: ctl.signal,
      headers: { 'User-Agent': UA, ...(opts.headers || {}) },
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

export async function retry(fn, { tries = 3, baseDelay = 600, shouldRetry = () => true } = {}) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn(i);
    } catch (e) {
      err = e;
      if (i === tries - 1 || !shouldRetry(e)) break;
      await new Promise((r) => setTimeout(r, baseDelay * 2 ** i + Math.random() * 200));
    }
  }
  throw err;
}

const inflight = new Map();
/** 相同 key 的并发请求只打一次上游 */
export function dedupe(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const p = Promise.resolve()
    .then(fn)
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export class DiskCache {
  constructor(root) {
    this.root = root;
  }
  path(...parts) {
    return join(this.root, ...parts);
  }
  async read(file, maxAgeMs = Infinity) {
    try {
      if (maxAgeMs !== Infinity) {
        const st = await stat(file);
        if (Date.now() - st.mtimeMs > maxAgeMs) return null;
      }
      return await readFile(file);
    } catch {
      return null;
    }
  }
  async write(file, buf) {
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(tmp, buf);
    await rename(tmp, file);
  }
  async exists(file) {
    try {
      await stat(file);
      return true;
    } catch {
      return false;
    }
  }
  /** JSON 接口缓存：key -> cache/api/<ns>/<hash>.json */
  async json(ns, key, maxAgeMs, producer) {
    const h = createHash('sha1').update(key).digest('hex').slice(0, 20);
    const file = this.path('api', ns, `${h}.json`);
    const hit = await this.read(file, maxAgeMs);
    if (hit) return JSON.parse(hit.toString('utf8'));
    return dedupe(`${ns}:${h}`, async () => {
      const data = await producer();
      await this.write(file, Buffer.from(JSON.stringify(data)));
      return data;
    });
  }
}
