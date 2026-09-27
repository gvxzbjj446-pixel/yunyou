// 平面多边形工具（点为 [x, y] 数组，单位米）。浏览器与服务端共用。

export function signedArea(pts) {
  let a = 0;
  const oy = pts[0]?.[1] ?? 0;
  for (let i = 0, n = pts.length, j = n - 1; i < n; j = i++) {
    a += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1] - 2 * oy);
  }
  return a / 2; // >0 为逆时针（y 向上时）
}

export const area = (pts) => Math.abs(signedArea(pts));

export function centroid(pts) {
  // 先平移到第一个顶点再算：经纬度（~113, ~34）直接做叉积会严重相消，小建筑质心可偏差数百米
  const ox = pts[0][0];
  const oy = pts[0][1];
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0, n = pts.length, j = n - 1; i < n; j = i++) {
    const xj = pts[j][0] - ox;
    const yj = pts[j][1] - oy;
    const xi = pts[i][0] - ox;
    const yi = pts[i][1] - oy;
    const f = xj * yi - xi * yj;
    cx += (xj + xi) * f;
    cy += (yj + yi) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-18) {
    let sx = 0;
    let sy = 0;
    for (const p of pts) {
      sx += p[0];
      sy += p[1];
    }
    return [sx / pts.length, sy / pts.length];
  }
  return [ox + cx / (3 * a), oy + cy / (3 * a)];
}

export function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, n = pts.length, j = n - 1; i < n; j = i++) {
    const xi = pts[i][0];
    const yi = pts[i][1];
    const xj = pts[j][0];
    const yj = pts[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 用主成分分析估计长宽比（>=1）与主轴长度 */
export function elongation(pts) {
  const [cx, cy] = centroid(pts);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of pts) {
    const dx = x - cx;
    const dy = y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc;
  const l2 = Math.max(1e-9, tr / 2 - disc);
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  // 沿主轴方向的实际投影长度
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  let min1 = Infinity;
  let max1 = -Infinity;
  let min2 = Infinity;
  let max2 = -Infinity;
  for (const [x, y] of pts) {
    const p = x * ux + y * uy;
    const q = -x * uy + y * ux;
    min1 = Math.min(min1, p);
    max1 = Math.max(max1, p);
    min2 = Math.min(min2, q);
    max2 = Math.max(max2, q);
  }
  const len = max1 - min1;
  const wid = Math.max(0.1, max2 - min2);
  return { ratio: Math.max(Math.sqrt(l1 / l2), len / wid, wid / len), length: Math.max(len, wid), width: Math.min(len, wid), angle };
}

/** 去掉闭合重复点与共线/过近点 */
export function cleanRing(pts, minDist = 0.05) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > minDist) out.push(p);
  }
  if (out.length > 2) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= minDist) out.pop();
  }
  return out;
}

export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
