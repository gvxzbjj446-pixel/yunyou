// 界面面板：景点详情（介绍/攻略/附近店铺）、城市攻略抽屉、城市选择、小地图。
import { escapeHtml as h } from './hotspots.js';

const api = async (path) => {
  const r = await fetch(path);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
};

export const CAT = {
  all: { label: '全部', emoji: '✨' },
  food: { label: '美食', emoji: '🍜' },
  drink: { label: '咖啡饮品', emoji: '☕' },
  shop: { label: '购物', emoji: '🛍' },
  hotel: { label: '住宿', emoji: '🏨' },
  sight: { label: '景点娱乐', emoji: '🎡' },
  service: { label: '生活服务', emoji: '🏦' },
};

const WEATHER_ICON = (code, isDay = true) => {
  if (code === 0) return isDay ? '☀️' : '🌙';
  if (code <= 2) return '⛅';
  if (code === 3) return '☁️';
  if (code <= 48) return '🌫';
  if (code <= 67 || (code >= 80 && code <= 82)) return '🌧';
  if (code <= 77 || code === 85 || code === 86) return '❄️';
  return '⛈';
};

// ---------------------------------------------------------------- 城市攻略数据（带缓存）
const guideCache = new Map();
export function loadGuide(city) {
  const key = `${city.guide?.city}|${city.guide?.en}`;
  if (!guideCache.has(key)) {
    // 失败结果不留在缓存里，下次打开时重试
    const p = api(`api/guide?city=${encodeURIComponent(city.guide?.city || city.name)}&en=${encodeURIComponent(city.guide?.en || city.en || '')}`).catch((e) => {
      guideCache.delete(key);
      return { error: e.message, sections: [] };
    });
    guideCache.set(key, p);
  }
  return guideCache.get(key);
}
const weatherCache = new Map();
export function loadWeather(city) {
  if (!weatherCache.has(city.id))
    weatherCache.set(
      city.id,
      api(`api/weather?lat=${city.center[1]}&lon=${city.center[0]}`).catch(() => {
        weatherCache.delete(city.id);
        return null;
      }),
    );
  return weatherCache.get(city.id);
}

/** 第三方服务故障的用户提示（原始错误放在 title 里便于排查） */
const failNote = (what, err) => `<p class="muted" title="${h(err || '')}">${what}暂时无法连接第三方数据源，请稍后重试。</p>`;

function renderSection(s) {
  const paras = (s.text || '')
    .split('\n')
    .filter(Boolean)
    .map((l) => `<p>${h(l)}</p>`)
    .join('');
  const items = (s.items || [])
    .map(
      (it) =>
        `<div class="listing"><b>${h(it.name)}${it.alt ? ` <small>${h(it.alt)}</small>` : ''}</b>${it.content ? `<small>${h(it.content)}</small><br>` : ''}${[it.address && `📍 ${it.address}`, it.hours && `🕒 ${it.hours}`, it.price && `💴 ${it.price}`].filter(Boolean).map((x) => `<small>${h(x)}</small>`).join(' · ')}</div>`,
    )
    .join('');
  return `<h4 id="g-${h(s.title)}">${h(s.title)}</h4>${paras}${items}`;
}

// ---------------------------------------------------------------- 景点详情
export class LandmarkPanel {
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;
    root.querySelector('.close').onclick = () => this.close();
    root.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => this.tab(b.dataset.tab)));
    root.querySelectorAll('.actions button').forEach((b) => (b.onclick = () => this.handlers.action?.(b.dataset.act, this.lm)));
    this.poiFilter = 'all';
  }
  get isOpen() {
    return this.root.classList.contains('open');
  }
  close() {
    this.root.classList.remove('open');
    this.root.setAttribute('aria-hidden', 'true');
    this.handlers.close?.();
  }
  tab(name) {
    this.root.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    this.root.querySelectorAll('.tab-body').forEach((b) => b.classList.toggle('hidden', b.dataset.body !== name));
    if (name === 'guide') this.renderGuide();
    if (name === 'nearby') this.renderNearby();
  }
  open(lm, city) {
    this.lm = lm;
    this.city = city;
    this.guideDone = false;
    this.nearbyDone = false;
    const r = this.root;
    r.querySelector('.kicker').textContent = lm.kicker || '热门景点';
    r.querySelector('.hero h2').textContent = lm.name;
    r.querySelector('.hero .en').textContent = lm.en || '';
    const img = r.querySelector('.hero-img');
    img.classList.remove('loaded');
    img.style.backgroundImage = '';
    r.classList.add('open');
    r.setAttribute('aria-hidden', 'false');
    this.tab('intro');
    const body = r.querySelector('[data-body="intro"]');
    const facts = lm.facts ? `<dl class="facts">${Object.entries(lm.facts).map(([k, v]) => `<dt>${h(k)}</dt><dd>${h(v)}</dd>`).join('')}</dl>` : '';
    const tips = lm.tips?.length ? `<h4>游览贴士</h4>${lm.tips.map((t) => `<p>• ${h(t)}</p>`).join('')}` : '';
    const intro = lm.intro ? lm.intro.split('\n').filter(Boolean).map((p) => `<p>${h(p)}</p>`).join('') : '';
    body.innerHTML = `${intro}${facts}${tips}<div class="wiki-box"><div class="spinner"></div></div>${lm.facts ? '<p class="note">开放时间、门票等实用信息仅供参考，请以景区官方公告为准。</p>' : ''}`;
    const lang = lm.wikiLang === 'en' ? 'en' : 'zh';
    api(`api/wiki?title=${encodeURIComponent(lm.wiki || lm.name)}&lang=${lang}`)
      .then((w) => {
        const box = body.querySelector('.wiki-box');
        if (!box || this.lm !== lm) return;
        if (w.missing || !w.extract) {
          box.innerHTML = intro ? '' : '<p class="muted">暂无百科资料。</p>';
          return;
        }
        box.innerHTML = `<h4>百科摘要</h4><p>${h(w.extract)}</p><div class="src">来源：<a href="${h(w.url)}" target="_blank" rel="noopener">${h(w.source)}</a> · ${h(w.license)}</div>`;
        if (w.thumbnail) {
          // 取 800px 缩略图，经服务端代理（维基图片在国内常无法直连）
          const src = `api/img?u=${encodeURIComponent(w.thumbnail.replace(/\/(\d+)px-/, '/800px-'))}`;
          const im = new Image();
          im.onload = () => {
            if (this.lm !== lm) return;
            img.style.backgroundImage = `url("${src}")`;
            img.classList.add('loaded');
          };
          im.onerror = () => {
            // 原图不足 800px 时 800px 缩略图会 404，退回原缩略图
            if (im.dataset.fallback) return;
            im.dataset.fallback = 1;
            const fb = `api/img?u=${encodeURIComponent(w.thumbnail)}`;
            im.onload = () => {
              if (this.lm !== lm) return;
              img.style.backgroundImage = `url("${fb}")`;
              img.classList.add('loaded');
            };
            im.src = fb;
          };
          im.src = src;
        }
      })
      .catch(() => {
        const box = body.querySelector('.wiki-box');
        if (box) box.innerHTML = '<p class="muted">百科资料暂时无法获取。</p>';
      });
  }

  async renderGuide() {
    if (this.guideDone) return;
    this.guideDone = true;
    const lm = this.lm;
    const body = this.root.querySelector('[data-body="guide"]');
    body.innerHTML = '<div class="spinner"></div>';
    const [g, w] = await Promise.all([loadGuide(this.city), loadWeather(this.city)]);
    if (this.lm !== lm) return;
    let html = '';
    if (w?.current) {
      html += `<h4>当地天气</h4><div class="weather"><span class="now">${WEATHER_ICON(w.current.code, w.current.isDay)} ${Math.round(w.current.temp)}°</span>${h(w.current.text)} · 体感 ${Math.round(w.current.feels)}° · 湿度 ${w.current.humidity}%</div><div class="weather" style="margin-top:6px">${w.daily
        .slice(0, 4)
        .map((d, i) => `<span class="day">${i === 0 ? '今天' : d.date.slice(5)} ${WEATHER_ICON(d.code)} ${Math.round(d.min)}~${Math.round(d.max)}°${d.rain != null ? ` · 降水${d.rain}%` : ''}</span>`)
        .join('')}</div><div class="src">来源：Open-Meteo</div>`;
    }
    if (lm.tips?.length) html += `<h4>${h(lm.name)} · 贴士</h4>${lm.tips.map((t) => `<p>• ${h(t)}</p>`).join('')}`;
    const want = /景点|游览|活动|美食|用餐|饮食|餐|小吃|购物|交通|抵达|境内|住宿|夜生活|特色/;
    const secs = (g.sections || []).filter((s) => want.test(s.title));
    if (secs.length) {
      html += `<h4 style="margin-top:22px">${h(this.city.name)} 城市攻略</h4>` + secs.slice(0, 12).map(renderSection).join('');
      html += `<div class="src">来源：<a href="${h(g.url)}" target="_blank" rel="noopener">${h(g.source)}</a> · ${h(g.license)}，内容由社区编辑，可能有过时之处。</div>`;
    } else html += g.error ? `${failNote('城市攻略', g.error)}<button class="retry">重试</button>` : '<p class="muted">暂未收录该城市的第三方攻略。</p>';
    body.innerHTML = html;
    const retry = body.querySelector('.retry');
    if (retry) retry.onclick = () => ((this.guideDone = false), this.renderGuide());
  }

  async renderNearby() {
    if (this.nearbyDone) return;
    this.nearbyDone = true;
    const lm = this.lm;
    const body = this.root.querySelector('[data-body="nearby"]');
    body.innerHTML = '<div class="spinner"></div><p class="muted" style="text-align:center">正在查询周边店铺……</p>';
    let data;
    try {
      data = await api(`api/pois?lat=${lm.lat}&lon=${lm.lon}&r=1000`);
    } catch (e) {
      if (this.lm === lm) body.innerHTML = `${failNote('周边店铺', e.message)}<button class="retry">重试</button>`;
      const b = body.querySelector('.retry');
      if (b) b.onclick = () => ((this.nearbyDone = false), this.renderNearby());
      return;
    }
    if (this.lm !== lm) return;
    this.pois = data.items;
    this.poiSource = data.source;
    this.drawPois();
  }

  drawPois() {
    const body = this.root.querySelector('[data-body="nearby"]');
    const counts = {};
    for (const p of this.pois) counts[p.cat] = (counts[p.cat] || 0) + 1;
    const chips = Object.entries(CAT)
      .filter(([k]) => k === 'all' || counts[k])
      .map(([k, c]) => `<button data-cat="${k}" class="${this.poiFilter === k ? 'on' : ''}">${c.emoji} ${c.label}${k === 'all' ? ` ${this.pois.length}` : ` ${counts[k]}`}</button>`)
      .join('');
    const list = this.pois.filter((p) => this.poiFilter === 'all' || p.cat === this.poiFilter).slice(0, 80);
    body.innerHTML = `<div class="chips">${chips}</div><div class="chips"><button class="show-all">📍 在 3D 场景中标出</button></div><ul class="poi-list">${
      list
        .map(
          (p, i) =>
            `<li data-i="${i}"><span class="pi">${CAT[p.cat]?.emoji || '📍'}</span><span><b>${h(p.name)}</b><small>${h(p.sub || '')}${p.rating ? ` · ⭐${p.rating}` : ''}${p.cost ? ` · 人均¥${p.cost}` : ''}${p.addr ? ` · ${h(p.addr)}` : ''}</small>${p.hours ? `<small>🕒 ${h(p.hours)}</small>` : ''}</span><span class="d">${p.dist < 1000 ? `${p.dist} m` : `${(p.dist / 1000).toFixed(1)} km`}<small>步行${Math.max(1, Math.round(p.dist / 75))}分</small></span></li>`,
        )
        .join('') || '<p class="muted">该分类暂无数据。</p>'
    }</ul><div class="src">数据来源：${h(this.poiSource)}${this.poiSource === 'OpenStreetMap' ? '（社区数据，覆盖可能不全；配置高德 Key 后可获得更完整的国内店铺）' : ''}</div>`;
    body.querySelectorAll('.chips [data-cat]').forEach((b) => (b.onclick = () => ((this.poiFilter = b.dataset.cat), this.drawPois())));
    body.querySelector('.show-all').onclick = () => this.handlers.showPois?.(list.slice(0, 40));
    body.querySelectorAll('.poi-list li').forEach((li) => (li.onclick = () => this.handlers.poi?.(list[+li.dataset.i], list.slice(0, 40))));
  }
}

// ---------------------------------------------------------------- 城市攻略抽屉
export class GuideDrawer {
  constructor(root) {
    this.root = root;
    root.querySelector('.close').onclick = () => this.close();
  }
  get isOpen() {
    return this.root.classList.contains('open');
  }
  close() {
    this.root.classList.remove('open');
    this.root.setAttribute('aria-hidden', 'true');
  }
  async open(city) {
    const r = this.root;
    r.classList.add('open');
    r.setAttribute('aria-hidden', 'false');
    r.querySelector('h2').textContent = `${city.name}${city.slogan ? ` · ${city.slogan}` : ''}`;
    const body = r.querySelector('.guide-body');
    const wEl = r.querySelector('.weather');
    body.innerHTML = '<div class="spinner"></div>';
    wEl.innerHTML = '';
    const [g, w] = await Promise.all([loadGuide(city), loadWeather(city)]);
    if (w?.current) {
      wEl.innerHTML = `<span class="now">${WEATHER_ICON(w.current.code, w.current.isDay)} ${Math.round(w.current.temp)}°</span><span>${h(w.current.text)}<br>湿度 ${w.current.humidity}% · 风速 ${Math.round(w.current.wind)} km/h</span>${w.daily
        .slice(1, 4)
        .map((d) => `<span class="day">${d.date.slice(5)} ${WEATHER_ICON(d.code)} ${Math.round(d.min)}~${Math.round(d.max)}°</span>`)
        .join('')}`;
    }
    if (!g.sections?.length) {
      body.innerHTML = `<p>${h(city.desc || '')}</p>${g.error ? failNote('城市攻略', g.error) : '<p class="muted">暂未收录该城市的第三方攻略。</p>'}`;
      return;
    }
    const toc = g.sections.filter((s) => s.level === 2).map((s) => `<button data-t="${h(s.title)}">${h(s.title)}</button>`).join('');
    body.innerHTML = `<p>${h(city.desc || '')}</p><div class="guide-toc">${toc}</div>${g.sections.map(renderSection).join('')}<div class="src">来源：<a href="${h(g.url)}" target="_blank" rel="noopener">${h(g.source)}</a> · ${h(g.license)}；天气：Open-Meteo</div>`;
    body.querySelectorAll('.guide-toc button').forEach((b) => (b.onclick = () => body.querySelector(`[id="g-${CSS.escape(b.dataset.t)}"]`)?.scrollIntoView({ behavior: 'smooth' })));
  }
}

// ---------------------------------------------------------------- 城市选择
export class CityPicker {
  constructor(root, cities, onPick) {
    this.root = root;
    this.onPick = onPick;
    root.querySelector('.close').onclick = () => this.close();
    root.addEventListener('click', (e) => e.target === root && this.close());
    const grid = root.querySelector('.city-grid');
    grid.innerHTML = cities
      .map(
        (c) =>
          `<button class="city-card" data-id="${c.id}" style="background:${c.cover || '#222'}">${c.id === 'puyang' ? '<i class="badge">默认 · 五县一区精细建模</i>' : c.id === 'zhengzhou' ? '<i class="badge">精细建模</i>' : ''}<span><b>${h(c.name)}</b><small>${h(c.slogan || '')}</small></span></button>`,
      )
      .join('');
    grid.querySelectorAll('.city-card').forEach((b) => (b.onclick = () => (this.close(), onPick({ preset: b.dataset.id }))));
    const form = root.querySelector('#city-search');
    const results = root.querySelector('#search-results');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const q = form.querySelector('input').value.trim();
      if (!q) return;
      results.innerHTML = '<li class="muted">搜索中……</li>';
      try {
        const list = await api(`api/geocode?q=${encodeURIComponent(q)}`);
        const good = list.filter((r) => /place|boundary/.test(r.kind)).concat(list.filter((r) => !/place|boundary/.test(r.kind)));
        results.innerHTML = good.length ? good.slice(0, 6).map((r, i) => `<li data-i="${i}">${h(r.name)}<small>${h(r.display)}</small></li>`).join('') : '<li class="muted">没有找到匹配的地点</li>';
        results.querySelectorAll('li[data-i]').forEach((li) => (li.onclick = () => (this.close(), onPick({ place: good[+li.dataset.i] }))));
      } catch (err) {
        results.innerHTML = `<li class="muted">搜索失败：${h(err.message)}</li>`;
      }
    };
  }
  mark(id) {
    this.root.querySelectorAll('.city-card').forEach((b) => b.classList.toggle('cur', b.dataset.id === id));
  }
  open() {
    this.root.classList.remove('hidden');
    setTimeout(() => this.root.querySelector('input')?.focus(), 50);
  }
  close() {
    this.root.classList.add('hidden');
  }
}

// ---------------------------------------------------------------- 小地图（卫星底图 + 视锥 + 景点）
export class Minimap {
  constructor(canvas, onJump) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.imgs = new Map();
    this.onJump = onJump;
    this.last = 0;
    canvas.addEventListener('click', (e) => {
      if (!this.view) return;
      const r = canvas.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * canvas.width - canvas.width / 2;
      const py = ((e.clientY - r.top) / r.height) * canvas.height - canvas.height / 2;
      const { cx, cz, mpp } = this.view;
      onJump?.(cx + px * mpp, cz + py * mpp);
    });
  }
  tile(z, x, y) {
    const k = `${z}/${x}/${y}`;
    let im = this.imgs.get(k);
    if (!im) {
      im = new Image();
      im.src = `tiles/img/${k}`;
      im.onload = () => (this.dirty = true);
      this.imgs.set(k, im);
      if (this.imgs.size > 300) this.imgs.delete(this.imgs.keys().next().value);
    }
    return im;
  }
  draw(world, spots, now) {
    if (now - this.last < 200 && !this.dirty) return;
    this.last = now;
    this.dirty = false;
    const { c, ctx } = this;
    const W = c.width;
    const cam = world.camera;
    const f = world.frame;
    const ground = world.groundAt(cam.position.x, cam.position.z);
    const alt = Math.max(50, cam.position.y - ground);
    const span = Math.min(80000, Math.max(1200, alt * 5));
    const mpp = span / W;
    const cx = cam.position.x;
    const cz = cam.position.z;
    this.view = { cx, cz, mpp };
    const z = Math.max(8, Math.min(17, Math.round(Math.log2((156543.03 * f.k) / mpp))));
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, W, W);
    const t0 = f.localToTile(cx - span / 2, cz - span / 2, z);
    const t1 = f.localToTile(cx + span / 2, cz + span / 2, z);
    for (let x = t0.x; x <= t1.x; x++) {
      for (let y = t0.y; y <= t1.y; y++) {
        const r = f.tileRect(z, x, y);
        const im = this.tile(z, x, y);
        if (im.complete && im.naturalWidth) ctx.drawImage(im, (r.x0 - cx) / mpp + W / 2, (r.z0 - cz) / mpp + W / 2, (r.x1 - r.x0) / mpp + 1, (r.z1 - r.z0) / mpp + 1);
      }
    }
    // 景点
    for (const s of spots) {
      const px = (s.pos.x - cx) / mpp + W / 2;
      const py = (s.pos.z - cz) / mpp + W / 2;
      if (px < -10 || py < -10 || px > W + 10 || py > W + 10) continue;
      ctx.fillStyle = '#d6383a';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // 视锥
    const dir = cam.getWorldDirection(cam.position.clone());
    const yaw = Math.atan2(dir.x, dir.z);
    const half = ((cam.fov * cam.aspect) / 2) * (Math.PI / 180);
    const len = W * 0.28;
    ctx.fillStyle = 'rgba(232,191,106,0.28)';
    ctx.beginPath();
    ctx.moveTo(W / 2, W / 2);
    ctx.lineTo(W / 2 + Math.sin(yaw - half) * len, W / 2 + Math.cos(yaw - half) * len);
    ctx.lineTo(W / 2 + Math.sin(yaw + half) * len, W / 2 + Math.cos(yaw + half) * len);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e8bf6a';
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('N', W / 2 - 4, 16);
  }
}
