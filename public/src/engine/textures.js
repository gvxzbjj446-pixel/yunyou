// 程序化建筑立面贴图：漫反射、粗糙/金属（ORM）、夜景亮窗。每种风格一张可平铺贴图。
import * as THREE from 'three';
import { rng } from '../core/geo.js';

/**
 * 风格定义：tileW/tileH 为一张贴图对应的真实米数，cols×rows 个开间×楼层。
 */
export const FACADES = [
  { id: 'tower', cols: 4, rows: 4, tileW: 13.2, tileH: 12.4, wall: ['#e9e4da', '#dcd6cb', '#efe9df'], win: 0.52, winH: 0.56, glass: '#2d3b4a', balcony: 0.5, ac: 0.35, litP: 0.55, litCol: ['#ffd9a0', '#ffe6bf', '#fff1d6', '#ffc27a'] },
  { id: 'walkup', cols: 4, rows: 4, tileW: 14.4, tileH: 11.6, wall: ['#b9ab97', '#a99c8a', '#c3b7a4'], win: 0.42, winH: 0.5, glass: '#2a2f33', balcony: 0.7, ac: 0.5, litP: 0.5, litCol: ['#ffcf8a', '#ffe0ae', '#fff3dc'], brick: true },
  { id: 'office', cols: 6, rows: 4, tileW: 9.0, tileH: 15.6, wall: ['#8fa3b3', '#9eb0bd', '#7f93a4'], win: 0.92, winH: 0.8, glass: '#3b5b73', curtain: true, litP: 0.38, litCol: ['#e8f1ff', '#fdf6e6', '#dde9ff'] },
  { id: 'commercial', cols: 3, rows: 2, tileW: 18, tileH: 10, wall: ['#d8d2c8', '#c9c2b6', '#e2ddd3'], win: 0.8, winH: 0.62, glass: '#35444f', litP: 0.7, litCol: ['#fff0d0', '#ffe3b0', '#f5f8ff'], band: true },
  { id: 'low', cols: 3, rows: 2, tileW: 10.5, tileH: 6.4, wall: ['#cfc6b8', '#bfb6a6', '#d9d2c6'], win: 0.4, winH: 0.5, glass: '#2c3035', litP: 0.45, litCol: ['#ffcf8a', '#ffe0ae'] },
];

function noiseFill(ctx, w, h, base, amount, rand, grain = 2) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y += grain) {
    for (let x = 0; x < w; x += grain) {
      const n = (rand() - 0.5) * amount;
      for (let yy = 0; yy < grain && y + yy < h; yy++) {
        for (let xx = 0; xx < grain && x + xx < w; xx++) {
          const i = ((y + yy) * w + x + xx) * 4;
          d[i] += n;
          d[i + 1] += n;
          d[i + 2] += n;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function makeFacade(style, size, seed) {
  const rand = rng(seed);
  const W = size;
  const H = size;
  const albedo = new OffscreenCanvas(W, H);
  const orm = new OffscreenCanvas(W, H);
  const lit = new OffscreenCanvas(W, H);
  const a = albedo.getContext('2d', { willReadFrequently: true });
  const o = orm.getContext('2d');
  const l = lit.getContext('2d');
  const cw = W / style.cols;
  const ch = H / style.rows;
  // 墙面
  noiseFill(a, W, H, style.wall[0], 14, rand, Math.max(1, size / 512));
  if (style.brick) {
    a.globalAlpha = 0.12;
    const bh = ch / 14;
    for (let y = 0; y < H; y += bh) {
      a.fillStyle = '#5a4a3a';
      a.fillRect(0, y, W, Math.max(1, bh * 0.08));
      const off = (Math.floor(y / bh) % 2) * bh;
      for (let x = off; x < W; x += bh * 2) a.fillRect(x, y, Math.max(1, bh * 0.08), bh);
    }
    a.globalAlpha = 1;
  }
  // 楼层线（腰线）
  a.fillStyle = 'rgba(0,0,0,0.10)';
  for (let r = 0; r <= style.rows; r++) a.fillRect(0, r * ch - Math.max(1, ch * 0.02), W, Math.max(2, ch * 0.04));
  o.fillStyle = 'rgb(0,220,0)'; // G=粗糙度 0.86，B=金属度 0
  o.fillRect(0, 0, W, H);
  l.fillStyle = '#000';
  l.fillRect(0, 0, W, H);

  for (let r = 0; r < style.rows; r++) {
    for (let c = 0; c < style.cols; c++) {
      const x0 = c * cw;
      const y0 = r * ch;
      const ww = cw * style.win;
      const wh = ch * style.winH;
      const wx = x0 + (cw - ww) / 2;
      const wy = y0 + ch * (style.curtain ? 0.1 : 0.22);
      // 玻璃：竖向渐变模拟天空反射
      const g = a.createLinearGradient(0, wy, 0, wy + wh);
      const base = new THREE.Color(style.glass);
      const hi = base.clone().lerp(new THREE.Color('#9fb6c9'), 0.35 + rand() * 0.2);
      g.addColorStop(0, `#${hi.getHexString()}`);
      g.addColorStop(1, `#${base.clone().multiplyScalar(0.8 + rand() * 0.3).getHexString()}`);
      a.fillStyle = g;
      a.fillRect(wx, wy, ww, wh);
      // 窗框与窗棂
      a.strokeStyle = style.curtain ? 'rgba(210,220,230,0.55)' : 'rgba(245,245,240,0.85)';
      a.lineWidth = Math.max(1, cw * 0.025);
      a.strokeRect(wx, wy, ww, wh);
      if (!style.curtain) {
        a.beginPath();
        a.moveTo(wx + ww / 2, wy);
        a.lineTo(wx + ww / 2, wy + wh);
        a.stroke();
      }
      // 窗帘/室内明暗变化
      if (rand() < 0.35 && !style.curtain) {
        a.fillStyle = `rgba(${200 + rand() * 50},${190 + rand() * 50},${170 + rand() * 40},0.35)`;
        a.fillRect(wx + ww * (rand() < 0.5 ? 0 : 0.5), wy, ww / 2, wh * (0.4 + rand() * 0.6));
      }
      o.fillStyle = style.curtain ? 'rgb(0,28,120)' : 'rgb(0,30,0)'; // 玻璃光滑
      o.fillRect(wx, wy, ww, wh);
      // 阳台栏板
      if (style.balcony && rand() < style.balcony) {
        const by = wy + wh * 0.62;
        a.fillStyle = style.brick ? 'rgba(120,112,100,0.9)' : 'rgba(250,250,246,0.92)';
        a.fillRect(wx - cw * 0.06, by, ww + cw * 0.12, wh * 0.4);
        a.fillStyle = 'rgba(0,0,0,0.18)';
        a.fillRect(wx - cw * 0.06, by + wh * 0.38, ww + cw * 0.12, Math.max(1, wh * 0.04));
        o.fillStyle = 'rgb(0,200,0)';
        o.fillRect(wx - cw * 0.06, by, ww + cw * 0.12, wh * 0.4);
      }
      // 空调外机
      if (style.ac && rand() < style.ac) {
        const aw = cw * 0.2;
        const ah = ch * 0.14;
        const ax = rand() < 0.5 ? x0 + cw * 0.02 : x0 + cw - aw - cw * 0.02;
        const ay = wy + wh - ah;
        a.fillStyle = '#e8e8e4';
        a.fillRect(ax, ay, aw, ah);
        a.fillStyle = 'rgba(0,0,0,0.3)';
        a.beginPath();
        a.arc(ax + aw * 0.4, ay + ah / 2, ah * 0.32, 0, Math.PI * 2);
        a.fill();
      }
      // 夜景亮窗
      // 亮灯纹理画满所有窗户，是否有人由着色器按楼、按窗随机决定（避免同一张贴图的亮窗图案在全城重复）。
      // 保留原先的亮灯抽样以免打乱随机序列、改变白天立面的阳台/空调布局
      rand();
      {
        const col = style.litCol[Math.floor(rand() * style.litCol.length)];
        const gl = l.createLinearGradient(0, wy, 0, wy + wh);
        gl.addColorStop(0, col);
        gl.addColorStop(1, new THREE.Color(col).multiplyScalar(0.55 + rand() * 0.3).getStyle());
        l.fillStyle = gl;
        l.fillRect(wx + 1, wy + 1, ww - 2, wh - 2);
        if (rand() < 0.3) {
          l.fillStyle = 'rgba(0,0,0,0.55)';
          l.fillRect(wx + ww * rand() * 0.5, wy, ww * 0.35, wh);
        }
      }
    }
    // 商业裙楼的招牌带
    if (style.band && r === style.rows - 1) {
      a.fillStyle = 'rgba(60,60,64,0.9)';
      a.fillRect(0, (r + 1) * ch - ch * 0.12, W, ch * 0.1);
    }
  }
  if (style.curtain) {
    // 幕墙竖向铝框
    a.fillStyle = 'rgba(190,200,210,0.6)';
    for (let c = 0; c <= style.cols; c++) a.fillRect(c * cw - 1, 0, Math.max(2, cw * 0.04), H);
  }
  return { albedo, orm, lit };
}

function toTexture(canvas, srgb, aniso) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function makeRoof(size, seed) {
  const rand = rng(seed);
  const c = new OffscreenCanvas(size, size);
  const x = c.getContext('2d', { willReadFrequently: true });
  noiseFill(x, size, size, '#a7a39c', 26, rand, Math.max(1, size / 256));
  // 防水卷材接缝与污渍
  x.strokeStyle = 'rgba(60,60,60,0.18)';
  x.lineWidth = Math.max(1, size / 400);
  for (let i = 0; i < 8; i++) {
    x.beginPath();
    x.moveTo(0, (i / 8) * size);
    x.lineTo(size, (i / 8) * size);
    x.stroke();
  }
  for (let i = 0; i < 30; i++) {
    x.fillStyle = `rgba(40,40,40,${0.03 + rand() * 0.05})`;
    x.beginPath();
    x.ellipse(rand() * size, rand() * size, rand() * size * 0.15, rand() * size * 0.08, rand() * 3, 0, Math.PI * 2);
    x.fill();
  }
  return c;
}

export class FacadeLibrary {
  constructor(renderer, size = 1024) {
    this.renderer = renderer;
    this.build(size);
  }
  build(size) {
    this.size = size;
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    this.nightUniform = { value: 0 };
    this.materials = FACADES.map((style, i) => {
      const { albedo, orm, lit } = makeFacade(style, size, 1000 + i * 77);
      const m = new THREE.MeshStandardMaterial({
        map: toTexture(albedo, true, aniso),
        roughnessMap: toTexture(orm, false, aniso),
        metalnessMap: toTexture(orm, false, aniso),
        emissiveMap: toTexture(lit, true, aniso),
        emissive: new THREE.Color(1, 1, 1),
        emissiveIntensity: 0,
        roughness: 1,
        metalness: style.curtain ? 1 : 1,
        vertexColors: true,
        envMapIntensity: style.curtain ? 1.2 : 0.7,
      });
      m.name = `facade-${style.id}`;
      const night = this.nightUniform;
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uNight = night;
        sh.uniforms.uCells = { value: new THREE.Vector2(style.cols, style.rows) };
        sh.uniforms.uLitP = { value: style.litP };
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aLit;\nvarying float vLit;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLit = aLit;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uNight, uLitP;\nuniform vec2 uCells;\nvarying float vLit;')
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
            // 逐窗是否亮灯：窗格索引 + 楼栋随机量（vLit）哈希；暗楼亮窗少，亮楼亮窗多
            vec2 cell = floor(vEmissiveMapUv * uCells);
            float hsh = fract(sin(dot(cell + vec2(vLit * 97.0, vLit * 131.0), vec2(12.9898, 78.233))) * 43758.5453);
            float occ = step(hsh, uLitP * (0.45 + 0.7 * vLit));
            totalEmissiveRadiance *= uNight * vLit * occ * 2.0;`,
          );
      };
      m.customProgramCacheKey = () => `facade-${style.id}`;
      return m;
    });
    const roofTex = toTexture(makeRoof(Math.min(size, 512), 7), true, aniso);
    this.roof = new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.92, metalness: 0, vertexColors: true });
    this.roof.name = 'roof';
    this.flat = new THREE.MeshStandardMaterial({ color: 0xdedad2, roughness: 0.85, vertexColors: true });
  }
  setNight(n) {
    this.nightUniform.value = n;
    for (const m of this.materials) m.emissiveIntensity = n > 0.01 ? 1 : 0;
  }
  dispose() {
    for (const m of [...this.materials, this.roof, this.flat]) {
      for (const k of ['map', 'roughnessMap', 'metalnessMap', 'emissiveMap']) if (m[k] && m[k] !== this.materials[0][k]) m[k].dispose?.();
      m.dispose();
    }
  }
}
