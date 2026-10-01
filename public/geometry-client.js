'use strict';

// 前端几何工具：实时测量（与服务端公式一致）+ 保存前即时校验。
// 服务端会再次校验，所有非法输入均以服务端拒绝为准。

const GEOM_EPS = 1e-9;

function gCross(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function gPointOnSegment(px, py, ax, ay, bx, by) {
  if (Math.abs(gCross(ax, ay, bx, by, px, py)) > GEOM_EPS) return false;
  return Math.min(ax, bx) - GEOM_EPS <= px && px <= Math.max(ax, bx) + GEOM_EPS &&
         Math.min(ay, by) - GEOM_EPS <= py && py <= Math.max(ay, by) + GEOM_EPS;
}

function gSegsTouch(a, b, c, d) {
  const o1 = gCross(a.x, a.y, b.x, b.y, c.x, c.y);
  const o2 = gCross(a.x, a.y, b.x, b.y, d.x, d.y);
  const o3 = gCross(c.x, c.y, d.x, d.y, a.x, a.y);
  const o4 = gCross(c.x, c.y, d.x, d.y, b.x, b.y);
  if (Math.abs(o1) <= GEOM_EPS && gPointOnSegment(c.x, c.y, a.x, a.y, b.x, b.y)) return true;
  if (Math.abs(o2) <= GEOM_EPS && gPointOnSegment(d.x, d.y, a.x, a.y, b.x, b.y)) return true;
  if (Math.abs(o3) <= GEOM_EPS && gPointOnSegment(a.x, a.y, c.x, c.y, d.x, d.y)) return true;
  if (Math.abs(o4) <= GEOM_EPS && gPointOnSegment(b.x, b.y, c.x, c.y, d.x, d.y)) return true;
  return ((o1 > GEOM_EPS && o2 < -GEOM_EPS) || (o1 < -GEOM_EPS && o2 > GEOM_EPS)) &&
         ((o3 > GEOM_EPS && o4 < -GEOM_EPS) || (o3 < -GEOM_EPS && o4 > GEOM_EPS));
}

function gSelfIntersection(poly) {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      const c = poly[j], d = poly[(j + 1) % n];
      const adjacent = (i + 1) % n === j || (j + 1) % n === i;
      if (adjacent) {
        const shared = (p) =>
          (Math.abs(p.x - a.x) <= GEOM_EPS && Math.abs(p.y - a.y) <= GEOM_EPS) ||
          (Math.abs(p.x - b.x) <= GEOM_EPS && Math.abs(p.y - b.y) <= GEOM_EPS);
        const contacts = [];
        if (gPointOnSegment(c.x, c.y, a.x, a.y, b.x, b.y)) contacts.push(c);
        if (gPointOnSegment(d.x, d.y, a.x, a.y, b.x, b.y)) contacts.push(d);
        if (contacts.length && !contacts.every(shared)) return [i + 1, j + 1];
        continue;
      }
      if (gSegsTouch(a, b, c, d)) return [i + 1, j + 1];
    }
  }
  return null;
}

function gPointStrictlyInside(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (gPointOnSegment(p.x, p.y, a.x, a.y, b.x, b.y)) return false;
    const intersect = (a.y > p.y) !== (b.y > p.y) &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

function gEdges(poly) {
  const e = [];
  for (let i = 0; i < poly.length; i++) e.push([poly[i], poly[(i + 1) % poly.length]]);
  return e;
}

function gRingStrictlyInside(hole, outer) {
  if (!hole.every((p) => gPointStrictlyInside(p, outer))) return false;
  for (const [a, b] of gEdges(outer))
    for (const [c, d] of gEdges(hole))
      if (gSegsTouch(a, b, c, d)) return false;
  return true;
}

function gArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

function gPerimeter(poly) {
  let p = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    p += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return p;
}

function gDupPoint(poly) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (Math.abs(a.x - b.x) <= GEOM_EPS && Math.abs(a.y - b.y) <= GEOM_EPS) return i + 1;
  }
  return null;
}

// 整份草稿即时校验，返回错误字符串或 null
function clientValidate(cells, width, height) {
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const label = cell.name ? `细胞「${cell.name}」` : `第 ${i + 1} 个细胞`;
    const outer = cell.outer;
    if (outer.length < 3) return `${label}：外轮廓至少需要 3 个顶点`;
    const dup = gDupPoint(outer);
    if (dup) return `${label}：第 ${dup} 个点重复`;
    const oob = outer.findIndex((p) => p.x < 0 || p.y < 0 || p.x > width || p.y > height);
    if (oob >= 0) return `${label}：第 ${oob + 1} 个顶点越出图片范围`;
    const si = gSelfIntersection(outer);
    if (si) return `${label}：第 ${si[0]}、${si[1]} 条边相交/接触，轮廓不得自交`;

    for (let hi = 0; hi < cell.holes.length; hi++) {
      const hole = cell.holes[hi];
      const hl = `${label} 的孔洞 ${hi + 1}`;
      if (hole.length < 3) return `${hl}：至少需要 3 个顶点`;
      if (gDupPoint(hole)) return `${hl}：存在重复点`;
      if (hole.some((p) => p.x < 0 || p.y < 0 || p.x > width || p.y > height))
        return `${hl}：顶点越出图片范围`;
      const hsi = gSelfIntersection(hole);
      if (hsi) return `${hl}：自交`;
      if (!gRingStrictlyInside(hole, outer))
        return `${hl}：必须严格位于所属外轮廓内部，且不得接触外轮廓`;
    }
    for (let a = 0; a < cell.holes.length; a++) {
      for (let b = a + 1; b < cell.holes.length; b++) {
        let touch = gPointStrictlyInside(cell.holes[b][0], cell.holes[a]) ||
                    gPointStrictlyInside(cell.holes[a][0], cell.holes[b]);
        if (!touch) {
          for (const [p1, p2] of gEdges(cell.holes[a])) {
            for (const [q1, q2] of gEdges(cell.holes[b])) {
              if (gSegsTouch(p1, p2, q1, q2)) { touch = true; break; }
            }
            if (touch) break;
          }
        }
        if (touch) return `${label}：孔洞 ${a + 1} 与孔洞 ${b + 1} 相互接触或重叠`;
      }
    }
  }
  return null;
}

function gPointInsideOrOn(p, poly) {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (gPointOnSegment(p.x, p.y, poly[i].x, poly[i].y, poly[j].x, poly[j].y)) return true;
  }
  return gPointStrictlyInside(p, poly);
}

function gSignedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

function gRingMoments(poly) {
  let qx = 0, qy = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const cr = a.x * b.y - b.x * a.y;
    qx += (a.x + b.x) * cr;
    qy += (a.y + b.y) * cr;
  }
  return { qx: qx / 6, qy: qy / 6 };
}

// 扣除孔洞后的净区域质心（净面积非正时返回 null；与服务端 netCentroid 同公式）
function gNetCentroid(outer, holes) {
  const aOuter = gSignedArea(outer);
  const m = gRingMoments(outer);
  let area = aOuter, qx = m.qx, qy = m.qy;
  for (const h of holes || []) {
    const ah = gSignedArea(h);
    const mh = gRingMoments(h);
    const sign = (aOuter >= 0 ? 1 : -1) * (ah >= 0 ? -1 : 1);
    area += sign * ah;
    qx += sign * mh.qx;
    qy += sign * mh.qy;
  }
  if (!(Math.abs(area) > GEOM_EPS)) return null;
  return { x: qx / area, y: qy / area, areaPx: Math.abs(area) };
}

// 点是否严格位于视野净区域（严格在外环内，且不在任何孔洞内/边界上）
function gPointInFieldNet(p, field) {
  if (!gPointStrictlyInside(p, field.outer)) return false;
  for (const h of field.holes || []) if (gPointInsideOrOn(p, h)) return false;
  return true;
}

// 视野整批即时校验：规则与服务端 validateField 一致（含净面积非正）
function clientValidateFields(fields, width, height) {
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const label = f.name ? `视野「${f.name}」` : `第 ${i + 1} 个视野`;
    const outer = f.outer;
    if (outer.length < 3) return `${label}：外轮廓至少需要 3 个顶点`;
    const dup = gDupPoint(outer);
    if (dup) return `${label}：第 ${dup} 个点重复`;
    if (outer.some((p) => p.x < 0 || p.y < 0 || p.x > width || p.y > height))
      return `${label}：存在越出图片范围的顶点`;
    const si = gSelfIntersection(outer);
    if (si) return `${label}：第 ${si[0]}、${si[1]} 条边相交/接触，轮廓不得自交`;

    for (let hi = 0; hi < (f.holes || []).length; hi++) {
      const hole = f.holes[hi];
      const hl = `${label} 的孔洞 ${hi + 1}`;
      if (hole.length < 3) return `${hl}：至少需要 3 个顶点`;
      if (gDupPoint(hole)) return `${hl}：存在重复点`;
      if (hole.some((p) => p.x < 0 || p.y < 0 || p.x > width || p.y > height))
        return `${hl}：顶点越出图片范围`;
      if (gSelfIntersection(hole)) return `${hl}：自交`;
      if (!gRingStrictlyInside(hole, outer))
        return `${hl}：必须严格位于视野外轮廓内部，且不得接触外轮廓`;
    }
    for (let a = 0; a < (f.holes || []).length; a++) {
      for (let b = a + 1; b < f.holes.length; b++) {
        let touch = gPointStrictlyInside(f.holes[b][0], f.holes[a]) ||
                    gPointStrictlyInside(f.holes[a][0], f.holes[b]);
        if (!touch) {
          for (const [p1, p2] of gEdges(f.holes[a])) {
            for (const [q1, q2] of gEdges(f.holes[b])) {
              if (gSegsTouch(p1, p2, q1, q2)) { touch = true; break; }
            }
            if (touch) break;
          }
        }
        if (touch) return `${label}：孔洞 ${a + 1} 与孔洞 ${b + 1} 相互接触或重叠`;
      }
    }
    const netPx = gArea(outer) - (f.holes || []).reduce((s, h) => s + gArea(h), 0);
    if (!(netPx > GEOM_EPS)) return `${label}：扣除孔洞后的净面积必须为正`;
  }
  return null;
}

// 全部视野实时统计；scale = μm/px，未定标传 null
function clientFieldStats(fields, cells, scale) {
  const centroids = cells.map((c) => {
    try { return gNetCentroid(c.outer, c.holes); } catch { return null; }
  });
  return (fields || []).map((f, fi) => {
    const counted = [];
    cells.forEach((cell, ci) => {
      const ctr = centroids[ci];
      if (ctr && gPointInFieldNet(ctr, f)) counted.push({ cell, ci, areaPx: ctr.areaPx });
    });
    const areaPx = gArea(f.outer) - (f.holes || []).reduce((s, h) => s + gArea(h), 0);
    const calibrated = typeof scale === 'number' && Number.isFinite(scale) && scale > 0;
    const areaMm2 = calibrated ? areaPx * scale * scale / 1e6 : null;
    const countedMm2 = calibrated ? counted.reduce((s, x) => s + x.areaPx, 0) * scale * scale / 1e6 : null;
    const density = calibrated && areaMm2 > 0 ? counted.length / areaMm2 : null;
    return {
      name: (f.name && f.name.trim()) || `视野 ${fi + 1}`,
      holes: (f.holes || []).length,
      cellCount: counted.length,
      areaMm2, countedMm2, density, calibrated,
      countedCellKeys: counted.map((x) => x.cell.id || `#${x.ci}`)
    };
  });
}

// 实时测量（scale = μm/px）；无定标时返回 null
function clientMeasure(cells, scale) {
  if (scale == null) return null;
  return cells.map((c) => {
    const areaPx = gArea(c.outer) - c.holes.reduce((s, h) => s + gArea(h), 0);
    const perPx = gPerimeter(c.outer) + c.holes.reduce((s, h) => s + gPerimeter(h), 0);
    return { areaUm2: areaPx * scale * scale, perimeterUm: perPx * scale };
  });
}

// ---------- 多视野合并统计（与服务端 server/merge.js 同算法） ----------
// 按所选视野净区域（外环扣除孔洞）的几何并集：slab 积分精确面积 +
// 细胞净区域质心严格位于并集内部才计入（同一细胞只计一次）。

const MERGE_EPS = 1e-7;

function mgEdges(poly) {
  const e = [];
  for (let i = 0; i < poly.length; i++) e.push([poly[i], poly[(i + 1) % poly.length]]);
  return e;
}

// 两线段在各自边内部相交的交点 x（端点/共线返回 null）
function mgCrossingX(a, b, c, d) {
  const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(den) <= GEOM_EPS) return null;
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
  if (t <= GEOM_EPS || t >= 1 - GEOM_EPS || u <= GEOM_EPS || u >= 1 - GEOM_EPS) return null;
  return a.x + t * (b.x - a.x);
}

function mgBreakpoints(fields) {
  const rings = [];
  fields.forEach((f) => { rings.push(f.outer); (f.holes || []).forEach((h) => rings.push(h)); });
  const xs = [];
  rings.forEach((r) => r.forEach((p) => xs.push(p.x)));
  for (let i = 0; i < rings.length; i++) {
    for (let j = i + 1; j < rings.length; j++) {
      for (const [a, b] of mgEdges(rings[i])) {
        for (const [c, d] of mgEdges(rings[j])) {
          const x = mgCrossingX(a, b, c, d);
          if (x !== null) xs.push(x);
        }
      }
    }
  }
  xs.sort((p, q) => p - q);
  const uniq = [];
  for (const x of xs) {
    if (!uniq.length || Math.abs(x - uniq[uniq.length - 1]) > GEOM_EPS) uniq.push(x);
  }
  return uniq;
}

function mgRingSections(ring, x) {
  const ys = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
    if (!(x > minX + GEOM_EPS && x < maxX - GEOM_EPS)) continue;
    const t = (x - a.x) / (b.x - a.x);
    ys.push(a.y + t * (b.y - a.y));
  }
  ys.sort((p, q) => p - q);
  const dedup = [];
  for (const y of ys) {
    if (!dedup.length || Math.abs(y - dedup[dedup.length - 1]) > GEOM_EPS) dedup.push(y);
  }
  const secs = [];
  for (let i = 0; i + 1 < dedup.length; i += 2) secs.push([dedup[i], dedup[i + 1]]);
  return secs;
}

function mgSubtractOne(list, hole) {
  const hlo = hole[0], hhi = hole[1];
  const out = [];
  for (const seg of list) {
    const lo = seg[0], hi = seg[1];
    if (hhi - lo <= MERGE_EPS || hlo - hi >= -MERGE_EPS) { out.push([lo, hi]); continue; }
    if (hlo - lo > MERGE_EPS) out.push([lo, Math.min(hi, hlo)]);
    if (hi - hhi > MERGE_EPS) out.push([Math.max(lo, hhi), hi]);
  }
  return out;
}

function mgFieldSections(field, x) {
  let secs = mgRingSections(field.outer, x);
  for (const h of field.holes || []) {
    for (const hs of mgRingSections(h, x)) secs = mgSubtractOne(secs, hs);
  }
  return secs;
}

function mgMergeSections(secs) {
  const sorted = secs
    .filter((s) => s[1] - s[0] > MERGE_EPS)
    .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const out = [];
  for (const s of sorted) {
    if (!out.length) { out.push([s[0], s[1]]); continue; }
    const last = out[out.length - 1];
    if (s[0] <= last[1] + MERGE_EPS) {
      if (s[1] > last[1]) last[1] = s[1];
    } else {
      out.push([s[0], s[1]]);
    }
  }
  return out;
}

function gUnionAreaPx(fields) {
  const xs = mgBreakpoints(fields);
  let area = 0;
  for (let k = 0; k + 1 < xs.length; k++) {
    const x0 = xs[k], x1 = xs[k + 1];
    if (x1 - x0 <= GEOM_EPS) continue;
    const xm = (x0 + x1) / 2;
    let secs = [];
    fields.forEach((f) => { secs = secs.concat(mgFieldSections(f, xm)); });
    secs = mgMergeSections(secs);
    let len = 0;
    secs.forEach((s) => { len += s[1] - s[0]; });
    area += (x1 - x0) * len;
  }
  return Math.abs(area);
}

// 点严格位于所选视野净区域并集内部
function gPointInUnionNet(p, fields) {
  for (const f of fields) {
    if (!gPointStrictlyInside(p, f.outer)) continue;
    let inHole = false;
    for (const h of f.holes || []) {
      if (gPointInsideOrOn(p, h)) { inHole = true; break; }
    }
    if (!inHole) return true;
  }
  return false;
}

// 选择校验：返回 null（通过）或错误信息字符串
function clientMergeValidate(fields, fieldIds) {
  if (!Array.isArray(fieldIds)) return '合并统计请求无效：fieldIds 必须是视野标识数组';
  if (fieldIds.length < 2) {
    return `合并统计至少选择 2 个取样视野（当前选择 ${fieldIds.length} 个），请求被拒绝`;
  }
  const seen = new Set();
  for (const id of fieldIds) {
    if (typeof id !== 'string' || !id) return '合并统计请求无效：视野标识必须是非空字符串';
    if (seen.has(id)) return `合并统计被拒绝：视野标识「${id}」重复，同一视野只能选择一次`;
    seen.add(id);
  }
  const byId = new Map((fields || []).map((f) => [f.id, f]));
  for (const id of fieldIds) {
    if (!byId.has(id)) {
      return `合并统计被拒绝：所选视野「${id}」不存在（可能已被删除或重画，请刷新后重新选择）`;
    }
  }
  return null;
}

// 多视野合并实时统计；返回 { error } 或统计对象（字段与服务端一致）
function clientMergeStats(fields, cells, scale, fieldIds) {
  const err = clientMergeValidate(fields, fieldIds);
  if (err) return { error: err };
  const all = fields || [];
  const byId = new Map();
  all.forEach((f, i) => { if (!byId.has(f.id)) byId.set(f.id, { field: f, index: i }); });
  const selected = fieldIds.map((id) => byId.get(id));
  const selFields = selected.map((x) => x.field);

  const centroids = (cells || []).map((c) => {
    try { return gNetCentroid(c.outer, c.holes); } catch { return null; }
  });
  const keySet = new Set();
  const counted = [];
  (cells || []).forEach((cell, ci) => {
    const ctr = centroids[ci];
    if (!ctr) return;
    if (gPointInUnionNet(ctr, selFields)) {
      const key = cell.id || `#${ci}`;
      if (keySet.has(key)) return;
      keySet.add(key);
      counted.push({ cell, ci, key, areaPx: ctr.areaPx });
    }
  });

  const areaPx = gUnionAreaPx(selFields);
  const countedAreaPx = counted.reduce((s, x) => s + x.areaPx, 0);
  const calibrated = typeof scale === 'number' && Number.isFinite(scale) && scale > 0;
  const areaMm2 = calibrated ? areaPx * scale * scale / 1e6 : null;
  const countedMm2 = calibrated ? countedAreaPx * scale * scale / 1e6 : null;
  const density = calibrated && areaMm2 > 0 ? counted.length / areaMm2 : null;
  const nameOf = (f, i) => (f.name && f.name.trim()) || `视野 ${i + 1}`;
  const round6 = (v) => Math.round(v * 1e6) / 1e6;
  const round4 = (v) => Math.round(v * 1e4) / 1e4;
  return {
    fieldCount: selected.length,
    fieldIds: selFields.map((f) => f.id),
    fieldNames: selected.map((x) => nameOf(x.field, x.index)),
    cellCount: counted.length,
    countedCellKeys: counted.map((x) => x.key),
    areaMm2,
    densityPerMm2: density,
    countedCellAreaMm2: countedMm2,
    areaText: calibrated ? String(round6(areaMm2)) : '待定标',
    densityText: calibrated ? String(round4(density)) : '待定标',
    countedCellAreaText: calibrated ? String(round6(countedMm2)) : '待定标',
    calibrated
  };
}

window.ClientGeom = {
  clientValidate, clientMeasure,
  clientValidateFields, clientFieldStats,
  clientMergeValidate, clientMergeStats,
  gArea, gPerimeter, gSelfIntersection, gPointStrictlyInside,
  gRingStrictlyInside, gEdges, gSegsTouch, gDupPoint,
  gPointInsideOrOn, gNetCentroid, gPointInFieldNet,
  gUnionAreaPx, gPointInUnionNet
};
