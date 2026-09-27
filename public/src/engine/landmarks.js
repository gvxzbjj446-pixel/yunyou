// 精细地标模型（郑州）与地标图层：按经纬度落位、贴地、夜景灯光、漫游碰撞、排除重叠的 OSM 建筑。
import * as THREE from 'three';
import { Kit, prism, eave, cap, hall, pagoda, lathe, smoothProfile, rampart, rod, star5, canvasTexture, mergeGeometries, ensureCCW } from './modelkit.js';
import { ZZ_GEO } from '../data/zhengzhou-geo.js';
import { puyangBuilders, puyangExclusions } from './landmarks-puyang.js';
import { rng } from '../core/geo.js';
import { elongation, centroid, pointInPolygon, distToSegment } from '../core/poly.js';

const D2R = Math.PI / 180;

function shadowAll(obj, cast = true, receive = true) {
  obj.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = cast;
      o.receiveShadow = receive;
    }
  });
  return obj;
}

// ============================================================== 二七纪念塔
function doublePentagon(R) {
  const a = R * Math.cos(36 * D2R);
  const P = (cx, ang) => [cx + R * Math.cos(ang * D2R), R * Math.sin(ang * D2R)];
  // 东西并联的两个正五边形（共用一条南北向边），逆时针
  return [P(a, 0), P(a, 72), [0, R * Math.sin(36 * D2R)], P(-a, 108), P(-a, 180), P(-a, 252), [0, -R * Math.sin(36 * D2R)], P(a, 288)];
}

function erqiTower(kit) {
  const g = new THREE.Group();
  const wallTex = canvasTexture(128, 256, (x, w, h) => {
    x.fillStyle = '#ebe5d6';
    x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(0,0,0,0.05)';
    for (let i = 0; i < 40; i++) x.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    // 窗：深色玻璃 + 朱红窗框
    x.fillStyle = '#8c2a22';
    x.fillRect(w * 0.3, h * 0.22, w * 0.4, h * 0.56);
    x.fillStyle = '#28333d';
    x.fillRect(w * 0.34, h * 0.25, w * 0.32, h * 0.5);
    x.fillStyle = '#8c2a22';
    x.fillRect(w * 0.49, h * 0.25, w * 0.02, h * 0.5);
    // 转角立柱
    x.fillStyle = '#d9d1bf';
    x.fillRect(0, 0, w * 0.06, h);
    x.fillRect(w * 0.94, 0, w * 0.06, h);
  });
  const wallMat = kit.glow(new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.75, emissive: new THREE.Color('#ffcf7a'), emissiveMap: wallTex, emissiveIntensity: 0 }), 0.8);
  const tiles = kit.glazedTiles('#2e8a57', 'erqi-green');
  const fasciaMat = kit.paint('#8f2b22', 'erqi-fascia', 0.6);
  const marble = kit.stone('#eeeae2', 'marble');
  const add = (geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    g.add(m);
    return m;
  };
  // 台阶平台
  add(prism(doublePentagon(12.5), -1.5, 0.9, { uvMode: 'run', uScale: 3, vScale: 3 }), marble);
  add(prism(doublePentagon(10.2), 0.9, 1.7, { uvMode: 'run', uScale: 3, vScale: 3 }), marble);
  // 塔基三层
  let y = 1.7;
  for (let i = 0; i < 3; i++) {
    const R = 7.4 - i * 0.2;
    add(prism(doublePentagon(R), y, y + 3.6, { uvMode: 'face', vScale: 3.6 }), wallMat);
    y += 3.6;
    const e = eave(doublePentagon(R), y, { overhang: 1.3, drop: 0.9, lift: 0.55 });
    add(e.roof, tiles);
    add(e.fascia, fasciaMat);
  }
  // 塔基顶部白色大理石栏杆
  const railRing = doublePentagon(7.3);
  const posts = [];
  const rails = [];
  for (let i = 0; i < railRing.length; i++) {
    const a = railRing[i];
    const b = railRing[(i + 1) % railRing.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(2, Math.round(len / 1.2));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const p = new THREE.BoxGeometry(0.18, 1.0, 0.18);
      p.translate(a[0] + (b[0] - a[0]) * t, y + 0.5, -(a[1] + (b[1] - a[1]) * t));
      posts.push(p);
    }
    rails.push(rod(new THREE.Vector3(a[0], y + 0.95, -a[1]), new THREE.Vector3(b[0], y + 0.95, -b[1]), 0.07, 4));
  }
  add(mergeGeometries([...posts.map((p) => p.toNonIndexed()), ...rails.map((r) => r.toNonIndexed())]), marble);
  // 塔身十一层（逐层收分）
  const floorH = 3.3;
  for (let i = 0; i < 11; i++) {
    const R = 6.0 - i * 0.12;
    add(prism(doublePentagon(R), y, y + floorH, { uvMode: 'face', vScale: floorH }), wallMat);
    y += floorH;
    const e = eave(doublePentagon(R), y, { overhang: 1.15, drop: 0.85, lift: 0.5 });
    add(e.roof, tiles);
    add(e.fascia, fasciaMat);
  }
  // 钟楼：六面大钟
  const Rb = 4.6;
  const bellRing = doublePentagon(Rb);
  add(prism(bellRing, y, y + 3.4, { uvMode: 'run', uScale: 3, vScale: 3.4 }), kit.paint('#e9e3d3', 'erqi-bell'));
  const clockTex = canvasTexture(256, 256, (x, w) => {
    x.fillStyle = '#f7f3e8';
    x.beginPath();
    x.arc(w / 2, w / 2, w * 0.48, 0, Math.PI * 2);
    x.fill();
    x.lineWidth = w * 0.03;
    x.strokeStyle = '#1b1b1b';
    x.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      x.fillStyle = '#1b1b1b';
      x.fillRect(w / 2 + Math.cos(a) * w * 0.38 - 4, w / 2 + Math.sin(a) * w * 0.38 - 4, 8, 8);
    }
    x.lineCap = 'round';
    x.lineWidth = w * 0.035;
    x.beginPath();
    x.moveTo(w / 2, w / 2);
    x.lineTo(w / 2 + w * 0.2, w / 2 - w * 0.12);
    x.stroke();
    x.lineWidth = w * 0.022;
    x.beginPath();
    x.moveTo(w / 2, w / 2);
    x.lineTo(w / 2, w * 0.14);
    x.stroke();
  });
  const clockMat = kit.glow(new THREE.MeshStandardMaterial({ map: clockTex, roughness: 0.4, emissive: new THREE.Color('#fff4d0'), emissiveMap: clockTex, emissiveIntensity: 0 }), 1.2);
  // 共 8 个外立面，北侧两面不设钟 → 六面大钟
  for (let i = 0; i < bellRing.length; i++) {
    const a = bellRing[i];
    const b = bellRing[(i + 1) % bellRing.length];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const nrm = [b[1] - a[1], -(b[0] - a[0])];
    const l = Math.hypot(nrm[0], nrm[1]);
    const ang = Math.atan2(nrm[1] / l, nrm[0] / l) / D2R;
    if (ang > 60 && ang < 120) continue;
    const c = new THREE.Mesh(new THREE.CircleGeometry(1.35, 40), clockMat);
    c.position.set(mid[0] + (nrm[0] / l) * 0.06, y + 1.7, -(mid[1] + (nrm[1] / l) * 0.06));
    c.lookAt(c.position.x + nrm[0], c.position.y, c.position.z - nrm[1]);
    g.add(c);
  }
  y += 3.4;
  const e = eave(bellRing, y, { overhang: 1.0, drop: 0.7, lift: 0.5 });
  add(e.roof, tiles);
  add(e.fascia, fasciaMat);
  // 双攒尖顶
  const a = Rb * Math.cos(36 * D2R);
  for (const s of [-1, 1]) {
    const cone = new THREE.ConeGeometry(Rb * 1.02, 3.4, 5, 1);
    cone.rotateY(s > 0 ? -Math.PI / 2 : Math.PI / 2);
    cone.translate(s * a, y + 1.7, 0);
    add(cone, tiles);
    const knob = new THREE.SphereGeometry(0.35, 12, 8);
    knob.translate(s * a, y + 3.5, 0);
    add(knob, kit.paint('#c9a13a', 'gold', 0.3));
  }
  // 中央旗杆 + 红五星（总高 63 m）
  const pole = rod(new THREE.Vector3(0, y, 0), new THREE.Vector3(0, 61.6, 0), 0.18, 8);
  add(pole, kit.metal('pole', '#d0d3d6'));
  const starMat = kit.glow(new THREE.MeshStandardMaterial({ color: '#d0141a', roughness: 0.35, metalness: 0.2, emissive: new THREE.Color('#ff2a20'), emissiveIntensity: 0 }), 2.5);
  for (const rot of [0, Math.PI / 2]) {
    const s = new THREE.Mesh(star5(1.3, 0.55, 0.25), starMat);
    s.position.y = 62;
    s.rotation.y = rot;
    g.add(s);
  }
  shadowAll(g);
  return { object: g, height: 63, footprint: doublePentagon(12.5) };
}

// ============================================================== 绿地中心·千玺广场（大玉米）
function dayumi(kit) {
  const g = new THREE.Group();
  const size = 512;
  const drawKernel = (x, w, h, glow) => {
    x.fillStyle = glow ? '#000' : '#cdbb95';
    x.fillRect(0, 0, w, h);
    const cols = 2;
    const rows = 2;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const cx = (i + 0.5) * (w / cols) + (j % 2 ? w / cols / 2 : 0);
        const cy = (j + 0.5) * (h / rows);
        const rw = w / cols / 2 - 6;
        const rh = h / rows / 2 - 5;
        x.beginPath();
        x.ellipse(cx % w, cy, rw, rh, 0, 0, Math.PI * 2);
        if (glow) {
          x.strokeStyle = '#ffc25c';
          x.lineWidth = 7;
          x.stroke();
        } else {
          const gr = x.createLinearGradient(0, cy - rh, 0, cy + rh);
          gr.addColorStop(0, '#9fb3c2');
          gr.addColorStop(1, '#3f5566');
          x.fillStyle = gr;
          x.fill();
          x.strokeStyle = '#efe3c6';
          x.lineWidth = 6;
          x.stroke();
        }
      }
    }
  };
  const map = canvasTexture(size, size, (x, w, h) => drawKernel(x, w, h, false));
  const emap = canvasTexture(size, size, (x, w, h) => drawKernel(x, w, h, true));
  const mat = new THREE.MeshStandardMaterial({ map, emissiveMap: emap, emissive: new THREE.Color('#ffd27a'), emissiveIntensity: 0, roughness: 0.25, metalness: 0.55, envMapIntensity: 1.4 });
  const time = kit.timeUniform;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uT = time;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vH;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvH = position.y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uT;\nvarying float vH;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 0.55 + 0.45 * sin(vH * 0.045 - uT * 1.6);');
  };
  kit.glow(mat, 2.2);
  const prof = smoothProfile(
    [
      [28, 0], [29.6, 25], [30.6, 70], [30.6, 115], [29.4, 160], [26.5, 200], [21.5, 233], [15.5, 257], [9, 271], [3.5, 278.5], [0.01, 280],
    ],
    90,
  );
  // 每层约 4.66 m：v 以层高为单位；横向 64 列“玉米粒”
  const tower = new THREE.Mesh(lathe(prof, { segments: 128, uRepeat: 32, vScale: 9.3 }), mat);
  g.add(tower);
  // 裙楼与入口
  const podium = new THREE.Mesh(new THREE.CylinderGeometry(34, 35, 9, 64), kit.glass('podium', '#5e7c90'));
  podium.position.y = 4.5;
  g.add(podium);
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.9, 12, 8), kit.metal('spire', '#e0d6b8'));
  spire.position.y = 285;
  g.add(spire);
  shadowAll(g);
  return { object: g, height: 290, footprint: circleRing(31, 24) };
}

function circleRing(r, n = 24, cx = 0, cn = 0) {
  return Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * r, cn + Math.sin((i / n) * Math.PI * 2) * r]);
}

// ============================================================== 会展中心（会议中心 + 展览中心）
function conventionCenter(kit, frame, anchor, groundAt) {
  const g = new THREE.Group();
  const toEN = (lon, lat) => {
    const p = frame.toLocal(lon, lat);
    return [p.x - anchor.x, -(p.z - anchor.z)];
  };
  // 会议中心：圆形玻璃大厅 + 扇贝形伞状屋顶 + 中央桅杆斜拉索
  const roofRing = ensureCCW(ZZ_GEO.conventionRoof.map(([lo, la]) => toEN(lo, la)));
  const [ce, cn] = centroid(roofRing);
  const hallR = 62;
  const hallMesh = new THREE.Mesh(new THREE.CylinderGeometry(hallR, hallR, 22, 72, 1, true), kit.glass('conv', '#7d9bb0'));
  hallMesh.position.set(ce, 11, -cn);
  g.add(hallMesh);
  const roofPos = [];
  const apex = [ce, 44, -cn];
  for (let i = 0; i < roofRing.length; i++) {
    const a = roofRing[i];
    const b = roofRing[(i + 1) % roofRing.length];
    roofPos.push(apex[0], apex[1], apex[2], a[0], 24, -a[1], b[0], 24, -b[1]);
    roofPos.push(apex[0], apex[1] - 1.2, apex[2], b[0], 23.2, -b[1], a[0], 23.2, -a[1]);
  }
  const roofGeo = new THREE.BufferGeometry();
  roofGeo.setAttribute('position', new THREE.Float32BufferAttribute(roofPos, 3));
  roofGeo.computeVertexNormals();
  g.add(new THREE.Mesh(roofGeo, kit.metal('conv-roof', '#dfe3e6', 0.3)));
  const mastTop = new THREE.Vector3(ce, 92, -cn);
  const cables = [rod(new THREE.Vector3(ce, 0, -cn), mastTop, 1.6, 12)];
  for (let i = 0; i < roofRing.length; i += 3) cables.push(rod(mastTop, new THREE.Vector3(roofRing[i][0] * 0.85 + ce * 0.15, 25, -(roofRing[i][1] * 0.85 + cn * 0.15)), 0.12, 4));
  g.add(new THREE.Mesh(mergeGeometries(cables.map((c) => c.toNonIndexed())), kit.metal('cable', '#cfd3d6', 0.25)));
  // 展览中心：沿 OSM 轮廓挤出，金属屋面 + 一排桅杆斜拉索
  const exRing = ensureCCW(ZZ_GEO.exhibition.map(([lo, la]) => toEN(lo, la)));
  const exGround = groundAt(anchor.x + centroid(exRing)[0], anchor.z - centroid(exRing)[1]) - anchor.y;
  g.add(new THREE.Mesh(prism(exRing, exGround - 2, exGround + 19, { uScale: 9, vScale: 21, top: false }), kit.glass('expo', '#8aa4b6')));
  const exRoof = cap(exRing, exGround + 21, true);
  g.add(new THREE.Mesh(exRoof, kit.metal('expo-roof', '#e5e7e9', 0.35)));
  const el = elongation(exRing);
  const [ex, en] = centroid(exRing);
  const ux = Math.cos(el.angle);
  const un = Math.sin(el.angle);
  const masts = [];
  for (let k = -3; k <= 3; k++) {
    const t = (k / 3.6) * (el.length / 2);
    const base = new THREE.Vector3(ex + ux * t, exGround + 21, -(en + un * t));
    const top = base.clone().add(new THREE.Vector3(0, 32, 0));
    masts.push(rod(base, top, 0.7, 8));
    for (const s of [-1, 1]) masts.push(rod(top, base.clone().add(new THREE.Vector3(-un * s * 55, 0, -ux * s * 55)), 0.1, 4));
  }
  g.add(new THREE.Mesh(mergeGeometries(masts.map((c) => c.toNonIndexed())), kit.metal('cable', '#cfd3d6', 0.25)));
  shadowAll(g);
  return { object: g, height: 95, footprint: circleRing(92, 32, ce, cn) };
}

// ============================================================== 河南艺术中心（五枚“陶埙”）
function artCenter(kit, frame, anchor) {
  const g = new THREE.Group();
  const shellTex = canvasTexture(512, 256, (x, w, h) => {
    x.fillStyle = '#d8c39a';
    x.fillRect(0, 0, w, h);
    for (let j = 0; j < 24; j++) {
      x.fillStyle = j % 2 ? 'rgba(120,95,60,0.18)' : 'rgba(255,245,220,0.18)';
      x.fillRect(0, (j * h) / 24, w, h / 48);
    }
    for (let i = 0; i < 64; i++) {
      x.fillStyle = 'rgba(90,70,40,0.12)';
      x.fillRect((i * w) / 64, 0, 1, h);
    }
  });
  const shell = new THREE.MeshStandardMaterial({ map: shellTex, roughness: 0.35, metalness: 0.65, envMapIntensity: 1.3 });
  const eggs = [
    [113.716886, 34.772375, 50, 44, 38, 20],
    [113.717487, 34.772798, 26, 30, 30, -10],
    [113.717959, 34.772851, 19, 25, 24, 5],
    [113.718721, 34.771653, 30, 25, 26, 30],
    [113.718292, 34.771247, 31, 28, 27, -25],
  ];
  const foot = [];
  for (const [lon, lat, rx, rz, ry, rot] of eggs) {
    const p = frame.toLocal(lon, lat);
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32, 0, Math.PI * 2, 0, Math.PI * 0.62), shell);
    m.scale.set(rx, ry, rz);
    m.rotation.y = rot * D2R;
    m.rotation.z = 0.12;
    m.position.set(p.x - anchor.x, -ry * 0.28, p.z - anchor.z);
    g.add(m);
    foot.push(circleRing(Math.min(rx, rz) * 0.92, 16, p.x - anchor.x, -(p.z - anchor.z)));
  }
  // 连接各厅的弧形玻璃廊
  const glassMat = kit.glass('art', '#86a8bb');
  const c0 = frame.toLocal(113.7173, 34.7722);
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(c0.x - anchor.x - 30, 0, c0.z - anchor.z + 30),
    new THREE.Vector3(c0.x - anchor.x + 60, 0, c0.z - anchor.z - 20),
    new THREE.Vector3(c0.x - anchor.x + 95, 0, c0.z - anchor.z + 90),
  );
  const tube = new THREE.TubeGeometry(curve, 40, 11, 12, false);
  const tp = tube.attributes.position;
  for (let i = 0; i < tp.count; i++) tp.setY(i, Math.max(0, tp.getY(i)) * 1.1);
  tube.computeVertexNormals();
  g.add(new THREE.Mesh(tube, glassMat));
  shadowAll(g);
  return { object: g, height: 45, footprints: foot };
}

// ============================================================== 中原福塔
function futa(kit) {
  const g = new THREE.Group();
  const steel = kit.metal('futa', '#c9ced3', 0.3);
  const glowMat = kit.glow(new THREE.MeshStandardMaterial({ color: '#c9ced3', roughness: 0.3, metalness: 0.8, emissive: new THREE.Color('#ff5fa2'), emissiveIntensity: 0 }), 1.8);
  // 塔座（鼎）
  const podium = new THREE.Mesh(lathe(smoothProfile([[50, 0], [51, 6], [47, 16], [44, 22], [0.01, 22.5]], 16), { segments: 60, uRepeat: 20, vScale: 6 }), kit.metal('ding', '#b08a52', 0.45));
  g.add(podium);
  const H = 250;
  const r0 = 44;
  const r1 = 24;
  const N = 20;
  const twist = 140 * D2R;
  const tubes = [];
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2;
    for (const s of [1, -1]) {
      const A = new THREE.Vector3(Math.cos(a0) * r0, 20, Math.sin(a0) * r0);
      const B = new THREE.Vector3(Math.cos(a0 + s * twist) * r1, H, Math.sin(a0 + s * twist) * r1);
      tubes.push(rod(A, B, 0.9, 6));
    }
  }
  // 水平环梁：双曲面半径 r(y)
  const rAt = (y) => {
    // 由直母线求该高度处的半径
    const t = (y - 20) / (H - 20);
    const Ax = r0;
    const Bx = Math.cos(twist) * r1;
    const Bz = Math.sin(twist) * r1;
    return Math.hypot(Ax + (Bx - Ax) * t, Bz * t);
  };
  const rings = [];
  for (let y = 36; y < H; y += 16) {
    const r = rAt(y);
    const seg = 40;
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const b = ((k + 1) / seg) * Math.PI * 2;
      rings.push(rod(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r), new THREE.Vector3(Math.cos(b) * r, y, Math.sin(b) * r), 0.45, 4));
    }
  }
  g.add(new THREE.Mesh(mergeGeometries([...tubes, ...rings].map((t) => t.toNonIndexed())), glowMat));
  // 核心筒
  const core = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 7.5, H, 24), kit.paint('#bfc3c6', 'core', 0.6));
  core.position.y = H / 2;
  g.add(core);
  // 塔楼（观光层）
  const pod = [
    [196, 210, 17, 20],
    [210, 222, 20, 22],
    [222, 234, 22, 23],
    [234, 246, 23, 21],
    [246, 256, 21, 15],
  ];
  const podGlass = kit.glow(kit.glass('futa-pod', '#6f8fa3', { night: '#9fd0ff' }), 1.0);
  pod.forEach(([y0, y1, ra, rb], i) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rb, ra, y1 - y0, 48), i % 2 ? steel : podGlass);
    m.position.y = (y0 + y1) / 2;
    g.add(m);
  });
  // 桅杆 120 m（总高 388 m）
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 3.2, 132, 12), steel);
  mast.position.y = 256 + 66;
  g.add(mast);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 8), kit.glow(new THREE.MeshStandardMaterial({ color: '#ff2020', emissive: '#ff2020', emissiveIntensity: 0 }), 6));
  beacon.position.y = 388;
  g.add(beacon);
  shadowAll(g);
  return { object: g, height: 388, footprint: circleRing(50, 24) };
}

// ============================================================== 河南博物院（观星台意象的金字塔形主馆）
function henanMuseum(kit) {
  const g = new THREE.Group();
  const sand = kit.stone('#a8906e', 'museum');
  const sandDark = kit.paint('#8f7858', 'museum-dark', 0.85);
  const tiers = [
    [0, 9, 78],
    [9, 18, 70],
    [18, 27, 60],
    [27, 34, 50],
  ];
  for (const [y0, y1, s] of tiers) {
    const top = s - 5;
    const geo = new THREE.CylinderGeometry(top / Math.SQRT2, s / Math.SQRT2, y1 - y0, 4, 1);
    geo.rotateY(Math.PI / 4);
    const m = new THREE.Mesh(geo, sand);
    m.position.y = (y0 + y1) / 2;
    g.add(m);
  }
  // 冠部：上扬下覆的方斗
  const crown = new THREE.CylinderGeometry(56 / Math.SQRT2, 38 / Math.SQRT2, 10, 4, 1);
  crown.rotateY(Math.PI / 4);
  const cm = new THREE.Mesh(crown, sand);
  cm.position.y = 39;
  g.add(cm);
  const sky = new THREE.Mesh(new THREE.BoxGeometry(40, 2, 40), kit.glow(kit.glass('museum-sky', '#6a8797', { night: '#ffe2a8' }), 1.2));
  sky.position.y = 44.5;
  g.add(sky);
  // 南立面入口竖向凹槽
  const slot = new THREE.Mesh(new THREE.BoxGeometry(10, 30, 3), kit.glow(kit.glass('museum-door', '#2b3a44', { night: '#ffcf85' }), 1.5));
  slot.position.set(0, 15, 37.5);
  g.add(slot);
  const plaza = new THREE.Mesh(new THREE.BoxGeometry(110, 1, 50), kit.stone('#cfc6b6', 'plaza'));
  plaza.position.set(0, -0.3, 60);
  g.add(plaza);
  const steps = new THREE.Mesh(new THREE.BoxGeometry(30, 3, 12), sandDark);
  steps.position.set(0, 1.5, 44);
  g.add(steps);
  shadowAll(g);
  return { object: g, height: 46, footprint: [[-40, -40], [40, -40], [40, 40], [-40, 40]] };
}

// ============================================================== 炎黄二帝巨型塑像
// 实物：背依邙山、面向黄河；整体 106 m（山体 55 m + 像高 51 m），高者炎帝、矮者黄帝。
// 模型局部 +z 为面部朝向，落位时旋转到朝北偏东（面向黄河）。
function sculptHead({ crown = false, beardLen = 1 }) {
  const geo = new THREE.SphereGeometry(1, 128, 96);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  const G = (d, s) => Math.exp(-(d * d) / (2 * s * s));
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    let { x, y, z } = v;
    const f = Math.max(0, z); // 正面权重
    // 下颌收窄、头顶略扁，形成头型
    const jaw = y < 0 ? 1 - 0.18 * Math.min(1, -y * 1.4) : 1 - 0.06 * y;
    x *= jaw;
    z *= y < 0 ? 1 - 0.1 * -y : 1;
    let dz = 0;
    let dy = 0;
    dz += G(Math.hypot(x * 1.4, y + 0.02), 0.16) * 0.34 * f * (y < 0.25 ? 1 : 0.4); // 鼻梁与鼻头
    dz += G(Math.hypot(x, y - 0.3), 0.3) * 0.1 * f; // 眉弓
    dz -= (G(Math.hypot(x - 0.3, y - 0.17), 0.1) + G(Math.hypot(x + 0.3, y - 0.17), 0.1)) * 0.13 * f; // 眼窝
    dz += (G(Math.hypot(x - 0.3, y - 0.19), 0.045) + G(Math.hypot(x + 0.3, y - 0.19), 0.045)) * 0.05 * f; // 眼球
    dz += (G(Math.hypot(x - 0.45, y + 0.02), 0.15) + G(Math.hypot(x + 0.45, y + 0.02), 0.15)) * 0.06 * f; // 颧骨
    dz += G(Math.hypot(x, y + 0.28), 0.16) * 0.12 * f; // 上唇与胡须
    dz -= G(Math.hypot(x * 0.6, y + 0.36), 0.04) * 0.05 * f; // 口缝
    // 长髯：下巴向下延伸
    if (y < -0.35 && f > 0.1) {
      const k = Math.min(1, (-0.35 - y) / 0.65);
      dy -= k * k * 0.75 * beardLen * G(x, 0.5);
      dz += k * 0.12 * f;
    }
    // 耳
    const ax = Math.abs(x);
    const ear = G(Math.hypot(ax - 0.95, y - 0.05), 0.11) * (z < 0.25 && z > -0.3 ? 1 : 0);
    x += Math.sign(x) * ear * 0.14;
    // 发髻或冠
    if (y > 0.62) dy += (y - 0.62) * (crown ? 0.25 : 0.55);
    p.setXYZ(i, x, y + dy, z + dz);
  }
  geo.computeVertexNormals();
  return geo;
}

function rockMass(rx, ry, rz, seed) {
  const geo = new THREE.SphereGeometry(1, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = geo.attributes.position;
  const r = rng(seed);
  const bumps = Array.from({ length: 18 }, () => [r() * 2 - 1, r(), r() * 2 - 1, 0.15 + r() * 0.25, (r() - 0.5) * 0.25]);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    let k = 1;
    for (const [bx, by, bz, s, a] of bumps) k += a * Math.exp(-((v.x - bx) ** 2 + (v.y - by) ** 2 + (v.z - bz) ** 2) / (s * s));
    p.setXYZ(i, v.x * rx * k, v.y * ry * k, v.z * rz * k);
  }
  geo.computeVertexNormals();
  return geo;
}

function yanhuang(kit) {
  const g = new THREE.Group();
  const rock = kit.rock('yanhuang', '#b9ad97');
  // 雕凿山体：从北侧广场（约低 45 m）升起的岩体，二帝胸像由此“长出”
  const base = new THREE.Mesh(rockMass(44, 54, 27, 5), rock);
  base.position.set(0, -50, 30);
  g.add(base);
  // 高者炎帝（像高约 51 m）、矮者黄帝
  for (const [x, s, crown] of [
    [-17, 1.0, false],
    [17, 0.92, true],
  ]) {
    const bust = new THREE.Group();
    const chest = new THREE.Mesh(rockMass(19, 20, 13, x > 0 ? 8 : 9), rock);
    chest.position.y = 0;
    bust.add(chest);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 8.5, 10, 24), rock);
    neck.position.set(0, 19, 1);
    bust.add(neck);
    const head = new THREE.Mesh(sculptHead({ crown, beardLen: 1.1 }), rock);
    head.scale.set(10.5, 13.5, 11.5);
    head.position.set(0, 34, 3);
    bust.add(head);
    if (crown) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 7.2, 5, 24), rock);
      c.position.set(0, 47.5, 2);
      bust.add(c);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(16, 1.2, 12), rock);
      plate.position.set(0, 50.5, 2.5);
      bust.add(plate);
    } else {
      const knot = new THREE.Mesh(new THREE.SphereGeometry(4.2, 24, 16), rock);
      knot.scale.set(1, 1.2, 1);
      knot.position.set(0, 49, -1);
      bust.add(knot);
    }
    bust.scale.setScalar(s);
    bust.position.set(x, 2, 26);
    g.add(bust);
  }
  shadowAll(g);
  return { object: g, height: 56, footprint: circleRing(42, 20) };
}

// ============================================================== 寺庙建筑群（依 OSM 殿宇轮廓生成）
function templeGroup(kit, frame, anchor, halls, groundAt, { wall = 'red', tiles = 'gray', highlight = {} } = {}) {
  const g = new THREE.Group();
  const foot = [];
  for (const h of halls) {
    const p = frame.toLocal(h.c[0], h.c[1]);
    const lx = p.x - anchor.x;
    const lz = p.z - anchor.z;
    const big = h.a > 380;
    const special = highlight[h.name];
    const w = Math.max(4, h.len - 1.5);
    const d = Math.max(3.5, h.wid - 1.5);
    const obj = hall(kit, {
      w,
      d,
      h: special?.h ?? (big ? 7 : h.a > 150 ? 5 : 3.8),
      podium: big ? 1.4 : 0.8,
      double: !!special?.double,
      wall,
      tiles: special?.tiles || tiles,
    });
    obj.rotation.y = h.ang * D2R;
    const gy = groundAt(p.x, p.z) - anchor.y;
    obj.position.set(lx, gy, lz);
    g.add(obj);
    const c = Math.cos(h.ang * D2R);
    const s = Math.sin(h.ang * D2R);
    foot.push(
      [
        [-w / 2, -d / 2],
        [w / 2, -d / 2],
        [w / 2, d / 2],
        [-w / 2, d / 2],
      ].map(([u, vv]) => [lx + u * c + vv * s, -lz + u * s - vv * c]),
    );
  }
  return { object: g, footprints: foot };
}

function talin(kit, frame, anchor, groundAt) {
  const g = new THREE.Group();
  const ring = ZZ_GEO.talin.map(([lo, la]) => {
    const p = frame.toLocal(lo, la);
    return [p.x, p.z];
  });
  let minx = Infinity;
  let maxx = -Infinity;
  let minz = Infinity;
  let maxz = -Infinity;
  for (const [x, z] of ring) {
    minx = Math.min(minx, x);
    maxx = Math.max(maxx, x);
    minz = Math.min(minz, z);
    maxz = Math.max(maxz, z);
  }
  const r = rng(77);
  const inside = (x, z) => {
    let ins = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i];
      const [xj, zj] = ring[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
    }
    return ins;
  };
  const placed = [];
  for (let tries = 0; tries < 2000 && placed.length < 110; tries++) {
    const x = minx + r() * (maxx - minx);
    const z = minz + r() * (maxz - minz);
    if (!inside(x, z) || placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 7)) continue;
    placed.push([x, z]);
    const hgt = 5 + r() * r() * 12;
    const pg = pagoda(kit, { height: hgt, base: 1.6 + hgt * 0.14, sides: r() < 0.6 ? 6 : 4, levels: 3 + Math.floor(r() * 5), seed: tries });
    pg.position.set(x - anchor.x, groundAt(x, z) - anchor.y - 0.3, z - anchor.z);
    pg.rotation.y = r() * Math.PI;
    g.add(pg);
  }
  return { object: g };
}

// ============================================================== 商城遗址城墙
function shangWalls(kit, frame, anchor, groundAt) {
  const g = new THREE.Group();
  const mats = [kit.earth(), kit.grass()];
  for (const w of ZZ_GEO.walls) {
    const pts = w.line.map(([lo, la]) => {
      const p = frame.toLocal(lo, la);
      return [p.x, p.z];
    });
    // 细分折线，贴合地形
    const dense = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 12));
      for (let k = 0; k < n; k++) dense.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
    }
    dense.push(pts[pts.length - 1]);
    if (dense.length < 2) continue;
    const geo = rampart(dense, { base: 20, top: 9, height: 7, groundAt: (x, z) => groundAt(x, z) - anchor.y });
    geo.translate(-anchor.x, 0, -anchor.z);
    const m = new THREE.Mesh(geo, mats[1]);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    const side = new THREE.Mesh(geo, mats[0]);
    side.scale.set(1, 0.999, 1);
    g.add(side);
  }
  return { object: g };
}

// ============================================================== 注册表
export const MODEL_BUILDERS = {
  erqi: ({ kit }) => erqiTower(kit),
  dayumi: ({ kit }) => dayumi(kit),
  convention: ({ kit, frame, anchor, groundAt }) => conventionCenter(kit, frame, anchor, groundAt),
  artcenter: ({ kit, frame, anchor }) => artCenter(kit, frame, anchor),
  futa: ({ kit }) => futa(kit),
  museum: ({ kit }) => henanMuseum(kit),
  yanhuang: ({ kit }) => yanhuang(kit),
  chenghuang: ({ kit, frame, anchor, groundAt }) => templeGroup(kit, frame, anchor, ZZ_GEO.chenghuang, groundAt, { tiles: 'green', highlight: {} }),
  shaolin: ({ kit, frame, anchor, groundAt }) =>
    templeGroup(kit, frame, anchor, ZZ_GEO.shaolin, groundAt, { tiles: 'gray', highlight: { 大雄宝殿: { double: true, h: 8 }, 天王殿: { h: 6 }, 山门: { h: 5 } } }),
  talin: ({ kit, frame, anchor, groundAt }) => talin(kit, frame, anchor, groundAt),
  shangwalls: ({ kit, frame, anchor, groundAt }) => shangWalls(kit, frame, anchor, groundAt),
  ...puyangBuilders(templeGroup),
};

/** 各模型需要从 OSM 建筑中剔除的对象（避免重叠） */
export function exclusionsFor(modelIds, frame) {
  const ex = [];
  const ids = [];
  const circle = (lon, lat, r) => {
    const p = frame.toLocal(lon, lat);
    ex.push({ x: p.x, z: p.z, r });
  };
  for (const id of modelIds) {
    if (id === 'erqi') circle(113.6604, 34.75334, 16);
    if (id === 'dayumi') circle(113.721107, 34.771916, 40);
    if (id === 'convention') {
      circle(113.72281, 34.77069, 100);
      const [lo, la] = centroid(ZZ_GEO.exhibition);
      circle(lo, la, 60);
      ids.push(729747167, 729747161, 729747169);
    }
    if (id === 'futa') circle(113.722807, 34.724677, 60);
    if (id === 'museum') {
      ids.push(725153429, 743428777, 725153428);
      circle(113.66617, 34.78944, 70);
    }
    if (id === 'chenghuang') ids.push(...ZZ_GEO.chenghuang.map((h) => h.id));
    if (id === 'shaolin') ids.push(...ZZ_GEO.shaolin.map((h) => h.id));
    ex.push(...puyangExclusions(id, frame));
  }
  if (ids.length) ex.push({ ids });
  return ex;
}

// ============================================================== 图层
export class LandmarkLayer {
  constructor({ scene, frame, terrain, renderer }) {
    this.frame = frame;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'landmarks';
    scene.add(this.group);
    this.kit = new Kit(renderer.capabilities.getMaxAnisotropy());
    this.items = [];
    this.footprints = [];
  }

  /** models: [{model, lon, lat, rotation?, yOffset?}] */
  async load(models) {
    for (const def of models) {
      const builder = MODEL_BUILDERS[def.model];
      if (!builder) continue;
      const p = this.frame.toLocal(def.lon, def.lat);
      const gy = await this.terrain.ensureHeight(p.x, p.z);
      const anchor = new THREE.Vector3(p.x, gy + (def.yOffset || 0), p.z);
      // 模型内部需要贴地时，预先加载周边高程
      const groundAt = (x, z) => this.terrain.heightAt(x, z, gy);
      if (def.preloadRadius) {
        const r = def.preloadRadius;
        await Promise.all([[-r, -r], [r, -r], [-r, r], [r, r], [0, 0]].map(([dx, dz]) => this.terrain.ensureHeight(p.x + dx, p.z + dz)));
      }
      try {
        const built = builder({ kit: this.kit, frame: this.frame, anchor, groundAt });
        const obj = built.object;
        obj.position.copy(anchor);
        if (def.rotation) obj.rotation.y = def.rotation * D2R;
        obj.name = `lm-${def.model}`;
        obj.updateMatrixWorld(true);
        this.group.add(obj);
        const item = { def, object: obj, height: built.height || 30, anchor };
        this.items.push(item);
        const fps = built.footprints || (built.footprint ? [built.footprint] : []);
        for (const f of fps) {
          const rot = (def.rotation || 0) * D2R;
          const c = Math.cos(rot);
          const s = Math.sin(rot);
          // 局部点 (e,0,-n) 绕 y 轴旋转 rot 后的世界坐标
          const ring = f.map(([e, n]) => [anchor.x + e * c - n * s, anchor.z - e * s - n * c]);
          const xs = ring.map((r) => r[0]);
          const zs = ring.map((r) => r[1]);
          this.footprints.push({ ring, minx: Math.min(...xs), maxx: Math.max(...xs), minz: Math.min(...zs), maxz: Math.max(...zs), top: anchor.y + (built.height || 30), bottom: anchor.y - 5 });
        }
      } catch (e) {
        console.warn('[landmark]', def.model, e);
      }
    }
  }

  setNight(n) {
    this.kit.setNight(n);
  }
  update(camera, dt) {
    this.kit.timeUniform.value += dt;
  }
  pickables() {
    return this.group.children;
  }
  /** 地标台基及外扩 20 m 的广场范围（不种行道树，保持地标底部通透） */
  inPlaza(x, z) {
    for (const f of this.footprints) {
      if (x < f.minx - 20 || x > f.maxx + 20 || z < f.minz - 20 || z > f.maxz + 20) continue;
      if (pointInPolygon(x, z, f.ring)) return true;
      const g = f.ring;
      for (let i = 0, j = g.length - 1; i < g.length; j = i++) if (distToSegment(x, z, g[j][0], g[j][1], g[i][0], g[i][1]) < 20) return true;
    }
    return false;
  }
  collidersNear(x, z, r) {
    return this.footprints.filter((f) => x > f.minx - r && x < f.maxx + r && z > f.minz - r && z < f.maxz + r);
  }
  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
    this.group.parent?.remove(this.group);
  }
}
