// 云游中国 · 3D 全景城市漫游 —— 应用编排
import * as THREE from 'three';
import { World } from './engine/world.js';
import { BuildingLayer } from './engine/buildings.js';
import { LandmarkLayer, exclusionsFor } from './engine/landmarks.js';
import { FeatureLayer } from './engine/features.js';
import { Director } from './engine/director.js';
import { PRESET_CITIES, autoCinematic, cityFromSearch } from './data/cities.js';
import { Hotspots, PoiPins } from './ui/hotspots.js';
import { LandmarkPanel, GuideDrawer, CityPicker, Minimap, CAT, loadWeather } from './ui/panels.js';
import { Soundtrack } from './ui/audio.js';
import { pointInPolygon, distToSegment } from './core/poly.js';

const $ = (s) => document.querySelector(s);
const D2R = Math.PI / 180;
const TIPS = [
  '提示：航拍模式下双击地面可快速飞近。',
  '提示：点击景点提示符可查看介绍、攻略与附近店铺。',
  '提示：切换到“漫游”模式，用 WASD 在街头行走。',
  '提示：拖动顶栏的时间滑块，可以看到日出、黄昏与夜景。',
  '提示：画质选择“4K 超清”并点击 📷 可导出 3840×2160 截图。',
];

class App {
  constructor() {
    this.world = new World($('#scene'));
    window.world = this.world; // 调试入口
    window.app = this;
    this.music = new Soundtrack();
    this.hotspots = new Hotspots($('#hotspots'), (id) => this.openLandmark(id));
    this.pins = new PoiPins($('#poi-pins'), (p) => this.focusPoi(p));
    this.panel = new LandmarkPanel($('#panel'), {
      action: (act, lm) => this.landmarkAction(act, lm),
      poi: (p, list) => this.focusPoi(p, list),
      showPois: (list) => this.showPois(list),
      close: () => this.hotspots.highlight(null),
    });
    this.guide = new GuideDrawer($('#guide'));
    this.picker = new CityPicker($('#picker'), PRESET_CITIES, (sel) => this.pickCity(sel));
    this.minimap = new Minimap($('#minimap'), (x, z) => this.jumpTo(x, z));
    this.spots = new Map();
    this.bindUI();
    this.world.onFrame((dt) => this.onFrame(dt));
    this.world.start();
  }

  // ================================================================ 城市
  async boot() {
    const want = new URLSearchParams(location.hash.slice(1)).get('city');
    const city = PRESET_CITIES.find((c) => c.id === want) || PRESET_CITIES[0];
    await this.enterCity(city, { autoplay: false });
  }

  async pickCity(sel) {
    if (sel.preset) {
      const city = PRESET_CITIES.find((c) => c.id === sel.preset);
      if (city) return this.enterCity(city, { autoplay: true });
    }
    if (sel.place) {
      this.loader(true, sel.place.name, '正在发现城市景点……', 0.05);
      let attractions = [];
      try {
        const r = await fetch(`api/attractions?lat=${sel.place.lat}&lon=${sel.place.lon}&r=12000`);
        attractions = r.ok ? await r.json() : [];
      } catch {
        attractions = [];
      }
      return this.enterCity(cityFromSearch(sel.place, attractions), { autoplay: true });
    }
  }

  async enterCity(city, { autoplay }) {
    const token = (this.loadToken = Symbol('load'));
    this.stopCinematic(false);
    this.panel.close();
    this.guide.close();
    this.pins.set([]);
    this.city = city;
    history.replaceState(null, '', city.custom ? location.pathname : `#city=${city.id}`);
    $('#city-name').textContent = city.name;
    this.picker.mark(city.id);
    document.title = `云游${city.name} · 3D 全景城市漫游`;
    $('.welcome-inner h1').innerHTML = `云游<em>${city.name}</em>`;
    this.loader(true, city.name, '正在建立城市坐标……', 0.02);
    document.body.classList.remove('exploring');
    $('#topbar').classList.add('hidden');
    $('#hud').classList.add('hidden');
    $('#minimap').classList.add('hidden');
    $('#spots').classList.add('hidden');

    const w = this.world;
    w.setCity(city);
    const models = city.landmarks.flatMap((l) => l.models || []);
    this.buildings = w.addLayer(new BuildingLayer({ scene: w.scene, frame: w.frame, terrain: w.terrain, renderer: w.renderer, exclusions: exclusionsFor(models.map((m) => m.model), w.frame) }));
    this.buildings.setQuality(w.quality);
    this.landmarks = w.addLayer(new LandmarkLayer({ scene: w.scene, frame: w.frame, terrain: w.terrain, renderer: w.renderer }));
    this.features = w.addLayer(new FeatureLayer({ scene: w.scene, frame: w.frame, terrain: w.terrain, blocked: (x, z) => !!this.buildings?.buildingAt(x, z) || !!this.landmarks?.collidersNear(x, z, 0).some((f) => pointInPolygon(x, z, f.ring)) }));
    w.collider = (from, to, r) => this.collide(from, to, r);
    w.setTime(10);
    this.applyWeather(city);

    // 景点锚点贴地
    this.loader(true, city.name, '正在加载地形……', 0.08);
    this.spots.clear();
    await Promise.all(
      city.landmarks.map(async (l) => {
        const p = w.frame.toLocal(l.lon, l.lat);
        const g = await w.terrain.ensureHeight(p.x, p.z);
        this.spots.set(l.id, { pos: new THREE.Vector3(p.x, g, p.z), height: l.height, lm: l });
      }),
    );
    if (token !== this.loadToken) return;
    this.hotspots.set(
      city.landmarks.map((l) => {
        const s = this.spots.get(l.id);
        return { id: l.id, name: l.name, sub: l.kicker, icon: l.icon, pos: s.pos.clone().add(new THREE.Vector3(0, l.height + 8, 0)) };
      }),
    );
    $('#spots ol').innerHTML = city.landmarks.map((l) => `<li data-id="${l.id}"><span>${l.name}<small>${l.kicker || ''}</small></span></li>`).join('');
    $('#spots ol').querySelectorAll('li').forEach((li) => (li.onclick = () => this.openLandmark(li.dataset.id)));

    // 精细模型
    this.loader(true, city.name, '正在搭建地标模型……', 0.14);
    await this.landmarks.load(models);
    if (token !== this.loadToken) return;
    this.landmarks.setNight(w.atmo.night);

    // 运镜脚本：预加载关键点高程后编译
    const shots = city.cinematic || autoCinematic(city);
    const pts = [];
    for (const s of shots) {
      for (const p of [...(s.pos || []), ...(s.look || [])]) pts.push(p);
      if (s.center) pts.push(s.center);
    }
    await Promise.all(pts.map(([lo, la]) => {
      const p = w.frame.toLocal(lo, la);
      return w.terrain.ensureHeight(p.x, p.z);
    }));
    this.director = new Director(w, city, shots, this.spots);
    this.director.clearance = (x, z) => this.obstacleTop(x, z);
    this.bindDirector(this.director);

    // 起始机位：城市上空
    const st = city.start || { lon: city.center[0], lat: city.center[1], distance: 6000, heading: 20, pitch: 38 };
    const sp = w.frame.toLocal(st.lon, st.lat);
    const rig = w.rig;
    rig.cancelFlight();
    rig.mode = 'none';
    rig.setMode('orbit');
    const o = { target: new THREE.Vector3(sp.x, w.terrain.heightAt(sp.x, sp.z, city.elevation), sp.z), distance: st.distance, heading: st.heading * D2R, pitch: st.pitch * D2R };
    Object.assign(rig.orbit, { ...o, target: o.target.clone() });
    Object.assign(rig.orbitGoal, { ...o, target: o.target.clone() });
    rig.update(0.016);

    // 预取运镜路径上的瓦片（服务器端并行下载并缓存）
    await this.prefetch(token, city);
    if (token !== this.loadToken) return;
    this.loader(true, city.name, '即将抵达……', 1);
    await this.world.settleBrief?.();
    this.loader(false);
    if (autoplay) this.playCinematic();
    else this.showWelcome();
  }

  async prefetch(token, city) {
    const w = this.world;
    // 预取只到 z17（高层级在飞近时实时加载），开播前只需等前两个镜头的数据
    const plan = this.director.prefetchList({ screenH: Math.min(1080, w.screenH), maxZ: 17, step: 1.5 });
    // 开场俯瞰视角的瓦片排最前
    const seen = new Set(plan.tiles.map((t) => t.join('/')));
    const startTiles = w.terrain.collectFor(w.camera, Math.min(1080, w.screenH), 17).map(([z, x, y]) => ['img', z, x, y]).filter((t) => !seen.has(t.join('/')));
    plan.tiles.unshift(...startTiles);
    plan.firstNeeded += startTiles.length;
    this.prefetchPlan = plan;
    let job;
    try {
      const r = await fetch('api/prefetch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tiles: plan.tiles }) });
      job = await r.json();
    } catch {
      return;
    }
    const t0 = performance.now();
    const skip = $('.loader-tip');
    let skipped = false;
    const onSkip = () => (skipped = true);
    for (;;) {
      if (token !== this.loadToken) return;
      let st;
      try {
        st = await (await fetch(`api/prefetch/${job.id}`)).json();
      } catch {
        break;
      }
      const frac = st.total ? Math.min(1, st.done / Math.max(1, plan.firstNeeded)) : 1;
      const secs = (performance.now() - t0) / 1000;
      this.loader(true, city.name, `正在下载 ${city.name} 的卫星影像、地形与建筑 ${Math.min(st.done, plan.firstNeeded)}/${plan.firstNeeded}${st.failed ? `（${st.failed} 个失败）` : ''} · 其余 ${Math.max(0, st.total - plan.firstNeeded)} 个将在播放中后台加载`, 0.2 + frac * 0.78);
      if (secs > 6 && !skip.querySelector('button')) {
        skip.innerHTML = '首次访问需要下载较多数据，之后会走缓存。<br><button class="link" style="margin-top:8px">不等了，先进入城市 ›</button>';
        skip.querySelector('button').onclick = onSkip;
      }
      if (st.done >= plan.firstNeeded * 0.97 || frac >= 0.985 || st.finished || skipped || secs > 120) break;
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  applyWeather(city) {
    loadWeather(city).then((w) => {
      if (!w?.current || this.city !== city) return;
      const cloud = Math.min(0.85, 0.25 + (w.current.cloud / 100) * 0.6);
      const rainy = w.current.precip > 0.2 || (w.current.code >= 51 && w.current.code <= 82);
      this.world.atmo.setWeather({ cloud, haze: rainy ? 0.95 : 0.7, visibility: rainy ? 9000 : w.current.code === 45 || w.current.code === 48 ? 5000 : 16000 });
      this.world.atmo.updateEnvironment(true);
    });
  }

  // ================================================================ 宣传片
  bindDirector(d) {
    d.addEventListener('start', () => {
      document.body.classList.add('cinematic');
      $('#cine').classList.remove('hidden');
      requestAnimationFrame(() => $('#cine').classList.add('on'));
      $('#welcome').classList.add('hidden');
      document.body.classList.remove('welcoming');
      this.hotspots.maxDist = 30000;
      this.world.post.setLook({ night: this.world.atmo.night, cinematic: true });
    });
    d.addEventListener('shot', (e) => {
      const { shot } = e.detail;
      const title = $('#cine-title');
      const cap = $('#cine-caption');
      title.classList.remove('show');
      cap.classList.remove('show');
      clearTimeout(this.capTimer);
      clearTimeout(this.capTimer2);
      this.hotspots.highlight(shot.spot || null);
      if (shot.title) {
        title.querySelector('h1').textContent = shot.title[0];
        title.querySelector('p').textContent = shot.title[1] || '';
        this.capTimer = setTimeout(() => title.classList.add('show'), 900);
        this.capTimer2 = setTimeout(() => title.classList.remove('show'), (shot.dur - 1.6) * 1000);
      } else if (shot.caption) {
        cap.querySelector('.kicker').textContent = shot.caption[0];
        cap.querySelector('h2').textContent = shot.caption[1];
        cap.querySelector('p').textContent = shot.caption[2] || '';
        this.capTimer = setTimeout(() => cap.classList.add('show'), 1100);
        this.capTimer2 = setTimeout(() => cap.classList.remove('show'), (shot.dur - 1.4) * 1000);
      }
    });
    d.addEventListener('frame', (e) => {
      const { t, total, fade } = e.detail;
      $('#cine-progress i').style.width = `${((t / total) * 100).toFixed(2)}%`;
      $('#fade').style.transition = 'none';
      $('#fade').style.opacity = fade.toFixed(3);
    });
    d.addEventListener('tod', (e) => this.syncTod(e.detail));
    d.addEventListener('pause', (e) => ($('#cine-pause').textContent = e.detail ? '▶' : '❚❚'));
    d.addEventListener('end', (e) => this.onCinematicEnd(e.detail.completed));
  }

  playCinematic() {
    if (!this.director) return;
    this.panel.close();
    this.guide.close();
    this.pins.set([]);
    this.music.start().then(() => $('#btn-music').classList.toggle('on', this.music.on));
    this.director.play(0);
  }

  stopCinematic(showUI = true) {
    if (this.director?.playing) {
      this.director.stop(false);
      if (!showUI) this.leaveCinematicUI();
    }
  }

  leaveCinematicUI() {
    document.body.classList.remove('cinematic');
    $('#cine').classList.remove('on');
    setTimeout(() => !this.director?.playing && $('#cine').classList.add('hidden'), 1300);
    $('#cine-title').classList.remove('show');
    $('#cine-caption').classList.remove('show');
    $('#fade').style.transition = 'opacity 0.8s';
    $('#fade').style.opacity = '0';
    this.hotspots.highlight(null);
    this.hotspots.maxDist = 90000;
  }

  onCinematicEnd(completed) {
    this.leaveCinematicUI();
    this.startExploring(true);
    if (completed) this.toast('宣传片结束 · 现在可以自由探索啦');
  }

  showWelcome() {
    $('#welcome').classList.remove('hidden');
    document.body.classList.add('welcoming');
    this.world.rig.autoRotate = 0.05;
    this.world.rig.idleTime = 100;
  }

  /** 进入自由探索：显示界面，回到白天的城市俯瞰 */
  startExploring(fromCinematic = false) {
    $('#welcome').classList.add('hidden');
    document.body.classList.remove('welcoming');
    document.body.classList.add('exploring');
    for (const s of ['#topbar', '#hud', '#minimap', '#spots']) $(s).classList.remove('hidden');
    this.syncTopbar();
    const w = this.world;
    w.rig.autoRotate = 0;
    if (fromCinematic) {
      $('#fade').style.transition = 'opacity 0.6s';
    }
    this.setTod(this.city.exploreTod ?? 10.5);
    const st = this.city.start || { lon: this.city.center[0], lat: this.city.center[1], distance: 6000, heading: 20, pitch: 38 };
    const sp = w.frame.toLocal(st.lon, st.lat);
    w.rig.setMode('orbit');
    w.rig.flyToOrbit({ target: new THREE.Vector3(sp.x, w.terrain.heightAt(sp.x, sp.z, 100), sp.z), distance: st.distance * 0.7, heading: st.heading * D2R, pitch: st.pitch * D2R, duration: fromCinematic ? 3.5 : 2.5 });
    this.setModeUI('orbit');
  }

  // ================================================================ 景点
  spotPose(lm, kind) {
    const s = this.spots.get(lm.id);
    if (kind === 'view') {
      const v = lm.view || { distance: 900, heading: 200, pitch: 28 };
      return { target: s.pos.clone().add(new THREE.Vector3(0, lm.height * 0.3, 0)), distance: v.distance, heading: v.heading * D2R, pitch: v.pitch * D2R };
    }
    const o = lm.orbit || { radius: 350, height: 180 };
    return { target: s.pos.clone().add(new THREE.Vector3(0, lm.height * 0.35, 0)), distance: Math.hypot(o.radius, o.height), heading: (lm.view?.heading ?? 20) * D2R, pitch: Math.atan2(o.height, o.radius) };
  }

  openLandmark(id) {
    const lm = this.city.landmarks.find((l) => l.id === id);
    if (!lm) return;
    if (this.director?.playing) this.stopCinematic(true);
    if (!document.body.classList.contains('exploring')) this.startExploringQuiet();
    this.hotspots.highlight(id);
    document.querySelectorAll('#spots li').forEach((li) => li.classList.toggle('on', li.dataset.id === id));
    this.guide.close();
    this.panel.open(lm, this.city);
    this.pins.set([]);
    const w = this.world;
    if (w.rig.mode === 'walk' || w.rig.mode === 'drone') w.rig.setMode('orbit');
    this.setModeUI('orbit');
    w.rig.flyToOrbit(this.spotPose(lm, 'view'));
  }

  startExploringQuiet() {
    $('#welcome').classList.add('hidden');
    document.body.classList.remove('welcoming');
    document.body.classList.add('exploring');
    for (const s of ['#topbar', '#hud', '#minimap', '#spots']) $(s).classList.remove('hidden');
    this.syncTopbar();
  }

  landmarkAction(act, lm) {
    const w = this.world;
    w.rig.autoRotate = 0;
    if (act === 'fly') {
      this.setModeUI('orbit');
      w.rig.flyToOrbit(this.spotPose(lm, 'view'));
    } else if (act === 'orbit') {
      this.setModeUI('orbit');
      w.rig.flyToOrbit(this.spotPose(lm, 'orbit')).then(() => {
        w.rig.autoRotate = 0.12;
        w.rig.idleTime = 100;
        this.toast('环绕欣赏中 · 拖动鼠标可随时接管');
      });
    } else if (act === 'enter') this.enterWalk(lm);
  }

  /** 进入景点：飞到地面入口，切换为第一人称漫游 */
  enterWalk(lm) {
    const w = this.world;
    const s = this.spots.get(lm.id);
    const wk = lm.walk || { lon: lm.lon, lat: lm.lat - 0.0008, heading: 0 };
    const p = w.frame.toLocal(wk.lon, wk.lat);
    w.terrain.ensureHeight(p.x, p.z).then((g) => {
      const eye = new THREE.Vector3(p.x, g + 1.7, p.z);
      const hd = wk.heading * D2R;
      const look = s ? s.pos.clone().add(new THREE.Vector3(0, Math.min(lm.height * 0.45, 40), 0)) : eye.clone().add(new THREE.Vector3(Math.sin(hd) * 50, 5, -Math.cos(hd) * 50));
      this.panel.close();
      this.setModeUI('walk');
      w.rig.flyTo({ position: eye, lookAt: look, mode: 'walk', duration: 4.5 }).then((ok) => {
        if (ok) this.toast(`已进入 ${lm.name} · WASD 行走，拖动鼠标环顾，Shift 奔跑`);
      });
    });
  }

  // ================================================================ 周边店铺
  poiPos(p) {
    const w = this.world;
    const l = w.frame.toLocal(p.lon, p.lat);
    const g = w.terrain.heightAt(l.x, l.z, 100);
    let top = g;
    const b = this.buildings?.buildingAt(l.x, l.z);
    if (b) top = b.top;
    return new THREE.Vector3(l.x, Math.max(g + 6, top + 4), l.z);
  }
  showPois(list) {
    this.pins.set(list.map((p) => ({ ...p, emoji: CAT[p.cat]?.emoji, pos: this.poiPos(p) })));
    const lm = this.panel.lm;
    if (lm) {
      const s = this.spots.get(lm.id);
      this.world.rig.flyToOrbit({ target: s.pos.clone(), distance: 900, heading: this.world.rig.orbit.heading, pitch: 0.75 });
    }
    this.toast(`已在场景中标出 ${list.length} 家店铺`);
  }
  focusPoi(p, list) {
    if (list) this.pins.set(list.map((q) => ({ ...q, emoji: CAT[q.cat]?.emoji, pos: this.poiPos(q) })));
    this.pins.select(p.id);
    const pos = this.poiPos(p);
    this.setModeUI('orbit');
    this.world.rig.flyToOrbit({ target: pos, distance: 260, heading: this.world.rig.orbit.heading, pitch: 0.55 });
  }

  // ================================================================ 碰撞：建筑 + 地标
  collide(from, to, r) {
    let p = this.buildings ? this.buildings.collide(from, to, r, from.y) : to;
    const lmFoot = this.landmarks?.collidersNear(p.x, p.z, r + 2) || [];
    const blocked = (x, z) =>
      lmFoot.some((f) => {
        if (from.y > f.top + 1) return false;
        if (pointInPolygon(x, z, f.ring)) return true;
        const g = f.ring;
        for (let i = 0, j = g.length - 1; i < g.length; j = i++) if (distToSegment(x, z, g[j][0], g[j][1], g[i][0], g[i][1]) < r) return true;
        return false;
      });
    if (!blocked(p.x, p.z)) return p;
    if (!blocked(p.x, from.z)) return new THREE.Vector3(p.x, p.y, from.z);
    if (!blocked(from.x, p.z)) return new THREE.Vector3(from.x, p.y, p.z);
    return from.clone();
  }

  /** 某点 30 m 范围内最高建筑/地标顶面（用于运镜避障） */
  obstacleTop(x, z, r = 30) {
    let top = -Infinity;
    const test = (f) => {
      if (f.top <= top) return;
      if (pointInPolygon(x, z, f.ring)) return (top = f.top);
      const g = f.ring;
      for (let i = 0, j = g.length - 1; i < g.length; j = i++) if (distToSegment(x, z, g[j][0], g[j][1], g[i][0], g[i][1]) < r) return (top = f.top);
    };
    for (const f of this.buildings?.footprintsNear(x, z, r) || []) test(f);
    for (const f of this.landmarks?.collidersNear(x, z, r) || []) test(f);
    return top;
  }

  jumpTo(x, z) {
    const w = this.world;
    this.setModeUI('orbit');
    w.rig.flyToOrbit({ target: new THREE.Vector3(x, w.terrain.heightAt(x, z, 100), z), distance: Math.max(600, w.rig.orbit.distance), heading: w.rig.orbit.heading, pitch: w.rig.orbit.pitch });
  }

  // ================================================================ 模式 / 时间 / 界面
  setMode(mode) {
    const w = this.world;
    if (this.director?.playing) this.stopCinematic(true);
    w.rig.autoRotate = 0;
    if (mode === 'walk' && w.rig.mode !== 'walk') {
      // 从视线落地点下到街面
      const f = w.rig.mode === 'orbit' ? w.rig.orbit.target.clone() : w.focusPoint(w.camera, w.groundAt(w.camera.position.x, w.camera.position.z));
      const g = w.terrain.heightAt(f.x, f.z, 100);
      const dir = w.camera.getWorldDirection(new THREE.Vector3());
      dir.y = 0;
      dir.normalize();
      let eye = new THREE.Vector3(f.x, g + 1.7, f.z);
      // 若落点在建筑内，向后退到街面
      for (let k = 0; k < 40 && this.buildings?.buildingAt(eye.x, eye.z); k++) eye.addScaledVector(dir, -6);
      this.setModeUI('walk');
      w.rig.flyTo({ position: eye, lookAt: eye.clone().addScaledVector(dir, 60).add(new THREE.Vector3(0, 3, 0)), mode: 'walk', duration: 3.5 }).then((ok) => ok && this.toast('漫游模式 · WASD 行走，拖动鼠标环顾，Shift 奔跑'));
      return;
    }
    if (mode === 'drone') {
      w.rig.cancelFlight();
      w.rig.setMode('drone');
      this.toast('无人机模式 · WASD 飞行，E/Q 升降，滚轮调速');
    }
    if (mode === 'orbit') {
      w.rig.cancelFlight();
      if (w.rig.mode === 'walk') {
        const pos = w.camera.position.clone();
        const dir = w.camera.getWorldDirection(new THREE.Vector3());
        dir.y = 0;
        dir.normalize();
        const target = pos.clone().addScaledVector(dir, 120);
        target.y = w.terrain.heightAt(target.x, target.z, pos.y);
        w.rig.setMode('orbit');
        w.rig.flyToOrbit({ target, distance: 520, heading: Math.atan2(dir.x, -dir.z), pitch: 0.55, duration: 2.2 });
      } else w.rig.setMode('orbit');
    }
    this.setModeUI(mode);
  }

  setModeUI(mode) {
    document.querySelectorAll('.modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    $('#mode-hint').textContent = { walk: '🚶 WASD 行走 · Shift 奔跑 · 拖动环顾', drone: '🚁 WASD 飞行 · E/Q 升降 · 滚轮调速', orbit: '' }[mode] || '';
  }

  setTod(h) {
    this.world.setTime(h);
    this.syncTod(h);
  }
  syncTod(h) {
    const hh = ((h % 24) + 24) % 24;
    $('#tod').value = hh.toFixed(2);
    $('#tod-out').textContent = `${String(Math.floor(hh)).padStart(2, '0')}:${String(Math.floor((hh % 1) * 60)).padStart(2, '0')}`;
  }

  loader(show, city = '', msg = '', frac = 0) {
    const el = $('#loader');
    if (!show) {
      el.classList.add('done');
      clearInterval(this.tipTimer);
      this.tipTimer = null;
      $('.loader-tip').textContent = '';
      return;
    }
    el.classList.remove('done');
    $('.loader-city').textContent = city ? `正在前往 · ${city}` : '';
    $('.loader-msg').textContent = msg;
    $('.loader-bar i').style.width = `${Math.round(frac * 100)}%`;
    if (!this.tipTimer) {
      let i = 0;
      const t = $('.loader-tip');
      const next = () => {
        if (!t.querySelector('button')) t.textContent = TIPS[i++ % TIPS.length];
      };
      next();
      this.tipTimer = setInterval(next, 4000);
    }
  }

  toast(msg, ms = 3200) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  /** 顶栏换行时高度会变，侧边面板据此下移 */
  syncTopbar() {
    const tb = $('#topbar');
    const h = tb.classList.contains('hidden') ? 0 : tb.getBoundingClientRect().bottom;
    document.documentElement.style.setProperty('--top-h', `${Math.round(h || 46)}px`);
  }

  bindUI() {
    new ResizeObserver(() => this.syncTopbar()).observe($('#topbar'));
    addEventListener('resize', () => this.syncTopbar());
    $('#btn-start').onclick = () => this.playCinematic();
    $('#btn-explore').onclick = () => this.startExploring(false);
    $('#btn-pick').onclick = () => this.picker.open();
    $('#city-btn').onclick = () => this.picker.open();
    $('#btn-guide').onclick = () => (this.guide.isOpen ? this.guide.close() : (this.panel.close(), this.guide.open(this.city)));
    $('#btn-cine').onclick = () => this.playCinematic();
    $('#cine-skip').onclick = () => this.stopCinematic(true);
    $('#cine-pause').onclick = () => this.director?.pause();
    document.querySelectorAll('.modes button').forEach((b) => (b.onclick = () => this.setMode(b.dataset.mode)));
    $('#tod').oninput = (e) => this.setTod(+e.target.value);
    $('#quality').onchange = (e) => {
      this.world.applyQuality(e.target.value);
      this.toast(`画质：${e.target.selectedOptions[0].textContent}${e.target.value === 'uhd' ? ' · 以 3840 像素宽度渲染' : ''}`);
    };
    $('#btn-shot').onclick = async () => {
      this.toast('正在渲染 3840×2160 截图……', 8000);
      const blob = await this.world.capture(3840, 2160);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `云游${this.city.name}-4K-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      this.toast('4K 截图已生成');
    };
    $('#btn-music').onclick = () => $('#btn-music').classList.toggle('on', this.music.toggle());
    $('#btn-help').onclick = () => $('#help').classList.remove('hidden');
    $('#help .close').onclick = () => $('#help').classList.add('hidden');
    $('#help').onclick = (e) => e.target.id === 'help' && $('#help').classList.add('hidden');
    $('#compass').onclick = () => {
      const r = this.world.rig;
      if (r.mode === 'orbit') r.orbitGoal.heading = 0;
      else r.fpGoal.yaw = 0;
    };
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Escape') {
        if (!$('#picker').classList.contains('hidden')) this.picker.close();
        else if (!$('#help').classList.contains('hidden')) $('#help').classList.add('hidden');
        else if (this.panel.isOpen) this.panel.close();
        else if (this.guide.isOpen) this.guide.close();
        else if (this.director?.playing) this.stopCinematic(true);
      }
      if (this.director?.playing) {
        if (e.code === 'Space') {
          e.preventDefault();
          this.director.pause();
        }
        return;
      }
      if (!document.body.classList.contains('exploring')) return;
      if (e.code === 'Digit1') this.setMode('orbit');
      if (e.code === 'Digit2') this.setMode('walk');
      if (e.code === 'Digit3') this.setMode('drone');
      if (e.code === 'KeyH') document.body.classList.toggle('ui-hidden');
    });
    this.world.rig.addEventListener('interact', () => {
      if (this.world.rig.autoRotate && document.body.classList.contains('exploring')) this.world.rig.autoRotate = 0;
    });
  }

  // ================================================================ 每帧
  onFrame(dt) {
    const w = this.world;
    if (this.director) this.director.update(dt);
    const W = innerWidth;
    const H = innerHeight;
    this.hotspots.update(w.camera, W, H);
    this.pins.update(w.camera, W, H);
    const now = performance.now();
    if (!document.body.classList.contains('exploring')) return;
    this.minimap.draw(w, [...this.spots.values()], now);
    if (now - (this.hudT || 0) > 250) {
      this.hudT = now;
      const c = w.camera.position;
      const ll = w.frame.toLonLat(c.x, c.z);
      const g = w.groundAt(c.x, c.z);
      const alt = c.y - g;
      $('#coords').textContent = `${ll.lat.toFixed(5)}°N  ${ll.lon.toFixed(5)}°E  ·  离地 ${alt < 1000 ? `${alt.toFixed(0)} m` : `${(alt / 1000).toFixed(2)} km`}  ·  海拔 ${g.toFixed(0)} m  ·  ${w.stats.fps} fps`;
      const dir = w.camera.getWorldDirection(new THREE.Vector3());
      const heading = Math.atan2(dir.x, -dir.z);
      $('#compass i').style.transform = `rotate(${(-heading * 180) / Math.PI}deg)`;
    }
  }
}

const app = new App();
app.boot().catch((e) => {
  console.error(e);
  $('.loader-msg').textContent = `加载失败：${e.message}`;
});
