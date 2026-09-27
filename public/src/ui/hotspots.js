// 景点提示符与店铺图钉：3D 锚点投影到屏幕的 HTML 标签，按距离缩放/简化，视野外隐藏。
import * as THREE from 'three';

const v = new THREE.Vector3();

export class Hotspots {
  constructor(container, onClick) {
    this.el = container;
    this.onClick = onClick;
    this.items = [];
    this.highlightId = null;
    this.maxDist = 90000;
    this.visible = true;
  }

  clear() {
    this.el.innerHTML = '';
    this.items = [];
  }

  /** list: [{id, name, sub, icon, pos: Vector3}] */
  set(list) {
    this.clear();
    for (const it of list) {
      const d = document.createElement('div');
      d.className = 'hotspot';
      d.dataset.id = it.id;
      d.innerHTML = `<div class="card"><span class="icon">${it.icon || '📍'}</span><span class="name">${escapeHtml(it.name)}<span class="sub">${escapeHtml(it.sub || '')}</span></span></div><div class="stem"></div><div class="dot"></div>`;
      d.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onClick?.(it.id);
      });
      d.addEventListener('pointerdown', (e) => e.stopPropagation());
      this.el.appendChild(d);
      this.items.push({ ...it, dom: d, shown: null });
    }
  }

  highlight(id) {
    this.highlightId = id;
    for (const it of this.items) it.dom.classList.toggle('highlight', it.id === id);
  }

  update(camera, width, height) {
    if (!this.visible) return;
    const camPos = camera.position;
    for (const it of this.items) {
      v.copy(it.pos).project(camera);
      const dist = camPos.distanceTo(it.pos);
      const inFront = v.z < 1 && v.z > -1;
      const onScreen = inFront && v.x > -1.15 && v.x < 1.15 && v.y > -1.2 && v.y < 1.3;
      const show = onScreen && dist < this.maxDist && dist > 12;
      if (show !== it.shown) {
        it.dom.style.display = show ? '' : 'none';
        it.shown = show;
      }
      if (!show) continue;
      const x = ((v.x + 1) / 2) * width;
      const y = ((1 - v.y) / 2) * height;
      const s = THREE.MathUtils.clamp(1.25 - Math.log10(dist) * 0.18, 0.62, 1.05);
      it.dom.style.transform = `translate(-50%,-100%) translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(${s.toFixed(3)})`;
      it.dom.style.zIndex = String(100000 - Math.round(dist / 10));
      it.dom.classList.toggle('far', dist > 9000 && it.id !== this.highlightId);
    }
  }
}

export class PoiPins {
  constructor(container, onClick) {
    this.el = container;
    this.onClick = onClick;
    this.items = [];
  }
  set(list) {
    this.el.innerHTML = '';
    this.items = list.map((p) => {
      const d = document.createElement('div');
      d.className = 'poi-pin';
      d.textContent = `${p.emoji || ''} ${p.name}`;
      d.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onClick?.(p);
      });
      this.el.appendChild(d);
      return { ...p, dom: d };
    });
  }
  select(id) {
    for (const it of this.items) it.dom.classList.toggle('sel', it.id === id);
  }
  update(camera, width, height) {
    for (const it of this.items) {
      v.copy(it.pos).project(camera);
      const dist = camera.position.distanceTo(it.pos);
      const show = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && dist < 2500;
      it.dom.style.display = show ? '' : 'none';
      if (!show) continue;
      it.dom.style.transform = `translate(-50%,-100%) translate(${(((v.x + 1) / 2) * width).toFixed(1)}px,${(((1 - v.y) / 2) * height).toFixed(1)}px)`;
    }
  }
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
