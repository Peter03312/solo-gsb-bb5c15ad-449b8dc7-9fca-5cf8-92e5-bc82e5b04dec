'use strict';

// 多视野合并统计
//
// 在同一草稿或同一份已发布报告内选择【至少两个】取样视野，按所选视野净区域
// （外环扣除孔洞）的【几何并集】给出统计：
//   - 并集面积：各视野净区域并集的精确面积（像素² → mm²），重叠部分只计一次；
//   - 细胞计数：细胞【扣除孔洞后的净区域质心】严格位于并集内部才计入，
//     同一细胞只计一次（落在并集外边界上不计；落在某个视野孔洞内但处于另一视野
//     净区域内，仍属于并集内部，计入）；
//   - 每 mm² 密度 = 细胞数 / 并集面积（mm²）；
//   - 计入细胞的净面积总和（mm²）。
// 未定标（scale 为 null）时保留细胞数，面积/密度/总和文本为“待定标”。
//
// 并集面积采用“竖直切片积分（slab integration）”：
// 收集全部环顶点 x 与跨环边交点 x 作为断点，相邻断点之间任一截面并集长度为
// 分段线性且无拐点，以中点截面并集长度乘片宽累加，得到精确并集面积。
// 同环不自交已由视野校验保证，因此只需计算【跨环】边交点。

const geo = require('./geometry');
const fieldsSvc = require('./fields');

const EPS = 1e-9;
const BREAK_EPS = 1e-9;   // 断点 x 去重
const MERGE_EPS = 1e-7;   // 区间相接/浮点误差容忍（px）

function ringEdges(poly) {
  const edges = [];
  for (let i = 0; i < poly.length; i++) edges.push([poly[i], poly[(i + 1) % poly.length]]);
  return edges;
}

// 线段 a-b 与 c-d 若在两条边的【内部】（不含端点、不含共线）相交，返回交点 x，否则 null。
// 端点相接/顶点落在另一环边上的情形其 x 已是某环的顶点断点，无需在此加入。
function crossingX(a, b, c, d) {
  const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(den) <= EPS) return null; // 平行或共线：无跨片拐点
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
  if (t <= EPS || t >= 1 - EPS || u <= EPS || u >= 1 - EPS) return null;
  return a.x + t * (b.x - a.x);
}

// 全部环（外环与孔洞）的顶点 x，并集上跨环边交点 x，排序去重
function unionBreakpoints(fields) {
  const rings = [];
  for (const f of fields) {
    rings.push(f.outer);
    for (const h of f.holes || []) rings.push(h);
  }
  const xs = [];
  for (const ring of rings) for (const p of ring) xs.push(p.x);
  for (let i = 0; i < rings.length; i++) {
    const ei = ringEdges(rings[i]);
    for (let j = i + 1; j < rings.length; j++) {
      const ej = ringEdges(rings[j]);
      for (const [a, b] of ei) {
        for (const [c, d] of ej) {
          const x = crossingX(a, b, c, d);
          if (x !== null) xs.push(x);
        }
      }
    }
  }
  xs.sort((p, q) => p - q);
  const uniq = [];
  for (const x of xs) {
    if (!uniq.length || Math.abs(x - uniq[uniq.length - 1]) > BREAK_EPS) uniq.push(x);
  }
  return uniq;
}

// 竖直线 x 与单个简单环的截面区间（y 成对，按从下到上配对）。
// 水平线与过顶点的 x 被跳过：调用点 x 始终取相邻断点的中点，
// 不会等于任何顶点 x 或跨环交点 x。
function ringSections(ring, x) {
  const ys = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    if (!(x > minX + EPS && x < maxX - EPS)) continue; // 水平边/竖边/顶点处跳过
    const t = (x - a.x) / (b.x - a.x);
    ys.push(a.y + t * (b.y - a.y));
  }
  ys.sort((p, q) => p - q);
  // 单环为简单环，正常情况下 y 两两不同；仅做数值级去重以防浮点重影
  const dedup = [];
  for (const y of ys) {
    if (!dedup.length || Math.abs(y - dedup[dedup.length - 1]) > 1e-9) dedup.push(y);
  }
  const secs = [];
  for (let i = 0; i + 1 < dedup.length; i += 2) secs.push([dedup[i], dedup[i + 1]]);
  return secs;
}

// 从一组区间中减去一个区间（孔洞挖去）
function subtractOne(list, hole) {
  const hlo = hole[0];
  const hhi = hole[1];
  const out = [];
  for (const seg of list) {
    const lo = seg[0];
    const hi = seg[1];
    if (hhi - lo <= MERGE_EPS || hlo - hi >= -MERGE_EPS) { out.push([lo, hi]); continue; }
    if (hlo - lo > MERGE_EPS) out.push([lo, Math.min(hi, hlo)]);
    if (hi - hhi > MERGE_EPS) out.push([Math.max(lo, hhi), hi]);
  }
  return out;
}

// 单个视野净区域（外环扣除其孔洞）在 x 处的截面区间
function fieldNetSections(field, x) {
  let secs = ringSections(field.outer, x);
  for (const h of field.holes || []) {
    for (const hs of ringSections(h, x)) secs = subtractOne(secs, hs);
  }
  return secs;
}

// 区间并集（相接即合并，保证边界零宽重叠不被重复计入）
function mergeSections(secs) {
  const sorted = secs
    .filter((s) => s[1] - s[0] > MERGE_EPS)
    .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const out = [];
  for (const s of sorted) {
    const lo = s[0];
    const hi = s[1];
    if (!out.length) { out.push([lo, hi]); continue; }
    const last = out[out.length - 1];
    if (lo <= last[1] + MERGE_EPS) {
      if (hi > last[1]) last[1] = hi;
    } else {
      out.push([lo, hi]);
    }
  }
  return out;
}

// 所选视野净区域并集的像素面积（精确：slab 积分）
function unionAreaPx(fields) {
  const xs = unionBreakpoints(fields);
  let area = 0;
  for (let k = 0; k + 1 < xs.length; k++) {
    const x0 = xs[k];
    const x1 = xs[k + 1];
    if (x1 - x0 <= BREAK_EPS) continue;
    const xm = (x0 + x1) / 2;
    let secs = [];
    for (const f of fields) secs = secs.concat(fieldNetSections(f, xm));
    secs = mergeSections(secs);
    let len = 0;
    for (const s of secs) len += s[1] - s[0];
    area += (x1 - x0) * len;
  }
  return Math.abs(area);
}

// 点 p 是否严格位于所选视野净区域的并集内部：
// 严格在任一视野外环内且不在该视野任一孔洞（含边界）上；
// 处在并集外边界（含两视野仅相接的公共边）上时所有外环测试均为 false → 不计入。
function pointInUnionNet(p, fields) {
  for (const f of fields) {
    if (!geo.pointStrictlyInside(p, f.outer)) continue;
    let inHole = false;
    for (const h of f.holes || []) {
      if (geo.pointInsideOrOn(p, h)) { inHole = true; break; }
    }
    if (!inHole) return true;
  }
  return false;
}

// 校验选择：必须为数组、至少 2 个、标识不重复且全部存在。
// 返回 { error } 或 { selected: 按请求顺序排列的视野对象 }。
function resolveSelection(fields, fieldIds) {
  if (!Array.isArray(fieldIds)) {
    return { error: '合并统计请求无效：fieldIds 必须是视野标识数组' };
  }
  if (fieldIds.length < 2) {
    return { error: `合并统计至少选择 2 个取样视野（当前选择 ${fieldIds.length} 个），请求被拒绝` };
  }
  const seen = new Set();
  for (const id of fieldIds) {
    if (typeof id !== 'string' || !id) {
      return { error: '合并统计请求无效：视野标识必须是非空字符串' };
    }
    if (seen.has(id)) {
      return { error: `合并统计被拒绝：视野标识「${id}」重复，同一视野只能选择一次` };
    }
    seen.add(id);
  }
  const byId = new Map();
  (fields || []).forEach((f, i) => { if (!byId.has(f.id)) byId.set(f.id, { field: f, index: i }); });
  const selected = [];
  for (const id of fieldIds) {
    const hit = byId.get(id);
    if (!hit) {
      return { error: `合并统计被拒绝：所选视野「${id}」不存在（可能已被删除或重画，请刷新后重新选择）` };
    }
    selected.push(hit);
  }
  return { selected };
}

// 合并统计主入口。fields/cells 为已校验几何数据，scale 为 μm/px（未定标传 null）。
// 选择不合法时返回 { error }，不抛出。
function buildMergeStats(fields, cells, scale, fieldIds) {
  const safeFields = Array.isArray(fields) ? fields : [];
  const safeCells = Array.isArray(cells) ? cells : [];
  const sel = resolveSelection(safeFields, fieldIds);
  if (sel.error) return { error: sel.error };
  const selected = sel.selected;
  const selFields = selected.map((x) => x.field);

  const centroids = fieldsSvc.computeCentroids(safeCells);
  const countedKeys = new Set();
  const counted = [];
  safeCells.forEach((cell, i) => {
    const ctr = centroids[i];
    if (!ctr) return; // 净面积为零的细胞没有良定义质心，不计入
    if (pointInUnionNet(ctr, selFields)) {
      const key = fieldsSvc.cellKey(cell, i);
      if (countedKeys.has(key)) return; // 同一细胞只计一次
      countedKeys.add(key);
      counted.push({ cell, i, key, areaPx: ctr.areaPx });
    }
  });

  const areaPx = unionAreaPx(selFields);
  const countedAreaPx = counted.reduce((s, x) => s + x.areaPx, 0);

  const calibrated = typeof scale === 'number' && Number.isFinite(scale) && scale > 0;
  const areaMm2 = calibrated ? fieldsSvc.px2ToMm2(areaPx, scale) : null;
  const countedAreaMm2 = calibrated ? fieldsSvc.px2ToMm2(countedAreaPx, scale) : null;
  const densityPerMm2 = calibrated && areaMm2 > 0 ? counted.length / areaMm2 : null;

  return {
    fieldCount: selected.length,
    fieldIds: selected.map((x) => x.field.id),
    fieldNames: selected.map((x) => fieldsSvc.fieldLabel(x.field, x.index)),
    cellCount: counted.length,
    countedCellKeys: counted.map((x) => x.key),
    areaPx,
    areaMm2,
    densityPerMm2,
    countedCellAreaMm2: countedAreaMm2,
    // 与逐视野统计同一组展示文本与取整规则
    areaText: calibrated ? String(fieldsSvc.round(areaMm2)) : fieldsSvc.PENDING,
    densityText: calibrated ? String(fieldsSvc.round(densityPerMm2, 4)) : fieldsSvc.PENDING,
    countedCellAreaText: calibrated ? String(fieldsSvc.round(countedAreaMm2)) : fieldsSvc.PENDING,
    calibrated
  };
}

module.exports = {
  unionAreaPx,
  pointInUnionNet,
  resolveSelection,
  buildMergeStats,
  ringSections,
  mergeSections,
  fieldNetSections
};
