'use strict';

// 多视野合并统计自测（node test-merge.js）：
// 并集面积（重叠只计一次/孔洞/相接不算重叠/旋转多边形精确）、
// 质心严格位于并集内部才计入（去重、外边界排除、孔洞经由另一视野仍计入）、
// 未定标“待定标”、选择校验（不足 2 个/重复/不存在/非数组）。
const assert = require('assert');
const geo = require('./server/geometry');
const merge = require('./server/merge');

// scale: 1 px = 1 μm = 0.001 mm → 1 px² = 1e-6 mm²
const SCALE = 1;

const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

function cellAt(cx, cy, half = 5, id) {
  // 以 (cx,cy) 为质心的正方形细胞
  return { id: id || `c-${cx}-${cy}`, name: id || `c-${cx}-${cy}`,
           outer: rect(cx - half, cy - half, half * 2, half * 2), holes: [] };
}

// ---------- 并集面积 ----------

// 1. 单视野并集 = 其净面积
{
  const fields = [{ id: 'F1', outer: rect(0, 0, 100, 100), holes: [] }];
  assert.ok(Math.abs(merge.unionAreaPx(fields) - 10000) < 1e-9);
  console.log('ok 1 单视野并集面积等于净面积');
}

// 2. 重叠视野：重叠部分只计一次
{
  const fields = [
    { id: 'A', outer: rect(0, 0, 60, 60), holes: [] },   // 3600
    { id: 'B', outer: rect(40, 40, 60, 60), holes: [] }  // 3600；重叠 20×20=400
  ];
  const a = merge.unionAreaPx(fields);
  assert.ok(Math.abs(a - 6800) < 1e-9, `area=${a}`);
  console.log('ok 2 重叠区域并集只计一次');
}

// 3. 完全包含：并集 = 大面积
{
  const fields = [
    { id: 'big', outer: rect(0, 0, 100, 100), holes: [] },
    { id: 'in', outer: rect(10, 10, 20, 20), holes: [] }
  ];
  const a = merge.unionAreaPx(fields);
  assert.ok(Math.abs(a - 10000) < 1e-9, `area=${a}`);
  console.log('ok 3 包含关系并集为大面积');
}

// 4. 仅相接（边重合但无面积重叠）：并集 = 两者之和
{
  const fields = [
    { id: 'L', outer: rect(0, 0, 50, 50), holes: [] },
    { id: 'R', outer: rect(50, 0, 50, 50), holes: [] }
  ];
  const a = merge.unionAreaPx(fields);
  assert.ok(Math.abs(a - 5000) < 1e-9, `area=${a}`);
  console.log('ok 4 仅边相接按两者之和计（无面积重叠）');
}

// 5. 孔洞被扣除；孔洞与另一视野重叠时，该区域仍属于并集
{
  // A: 100×100 挖 20×20 孔（孔在 40..60），净 9600
  // B: 正好覆盖该孔洞（40,40,20,20），并集恢复为 10000
  const fields = [
    { id: 'A', outer: rect(0, 0, 100, 100), holes: [rect(40, 40, 20, 20)] },
    { id: 'B', outer: rect(40, 40, 20, 20), holes: [] }
  ];
  const a = merge.unionAreaPx(fields);
  assert.ok(Math.abs(a - 10000) < 1e-9, `area=${a}`);

  // 仅 A（带孔）时净面积 9600
  assert.ok(Math.abs(merge.unionAreaPx([fields[0]]) - 9600) < 1e-9);
  console.log('ok 5 视野孔洞扣除，且被另一视野覆盖的孔洞区域计入并集');
}

// 6. 各视野孔洞都要扣除：两重叠大视野各在不重叠区有孔
{
  const fields = [
    { id: 'A', outer: rect(0, 0, 60, 60), holes: [rect(0, 0, 10, 10)] },       // 3600-100
    { id: 'B', outer: rect(40, 40, 60, 60), holes: [rect(90, 90, 10, 10)] }    // 3600-100；重叠 400
  ];
  const a = merge.unionAreaPx(fields);
  assert.ok(Math.abs(a - 6600) < 1e-9, `area=${a}`);
  console.log('ok 6 各视野自身孔洞均从并集扣除');
}

// 7. 旋转 45° 菱形：slab 积分精确
{
  // 菱形顶点 (50,0)(100,50)(50,100)(0,50)，面积 = 对角线乘积/2 = 100*100/2 = 5000
  const diamond = [{ x: 50, y: 0 }, { x: 100, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 50 }];
  const fields = [
    { id: 'd1', outer: diamond, holes: [] },
    { id: 'd2', outer: diamond.map((p) => ({ x: p.x + 20, y: p.y })), holes: [] }
  ];
  // 单菱形 5000；重叠为两菱形平移 20 的交，数值至少满足：面积在 (5000, 10000) 且对称平移对称
  const single = merge.unionAreaPx([fields[0]]);
  assert.ok(Math.abs(single - 5000) < 1e-9, `single=${single}`);
  const both = merge.unionAreaPx(fields);
  // 重叠菱形交：用裁剪计算验证——交为另一菱形区域，这里直接核对对称区间公式
  // 平移 20 时交集面积：菱形|x-50|+|y-50|<=50 与 |x-70|+|y-50|<=50 的交
  // 交在 x∈[20,100]：按 x 分段截面长度积分
  let expectOverlap = 0;
  const secLen = (cx0, x) => 2 * (50 - Math.abs(x - cx0)); // 菱形在 x 处竖直截面全长
  for (let k = 0; k < 8000; k++) {
    const x0 = 20 + (k / 8000) * 80;
    const x1 = 20 + ((k + 1) / 8000) * 80;
    const xm = (x0 + x1) / 2;
    const l = Math.min(secLen(50, xm), secLen(70, xm));
    expectOverlap += (x1 - x0) * l;
  }
  assert.ok(Math.abs(both - (10000 - expectOverlap)) < 1e-6,
    `both=${both}, expect~${10000 - expectOverlap}`);
  assert.ok(both > 5000 && both < 10000);
  console.log('ok 7 旋转多边形与斜向重叠面积正确');
}

// 8. 顶点 x 落在另一环边上的 T 接情形（相接不算重叠）
{
  const fields = [
    { id: 'A', outer: rect(0, 0, 50, 100), holes: [] },
    // 三角形左边顶点 x=50 贴在 A 的右边上，仅点/边相接
    { id: 'B', outer: [{ x: 50, y: 25 }, { x: 50, y: 75 }, { x: 100, y: 50 }], holes: [] }
  ];
  const a = merge.unionAreaPx(fields);
  // 三角形面积 = 50*50/2 = 1250
  assert.ok(Math.abs(a - 6250) < 1e-9, `area=${a}`);
  console.log('ok 8 T 接/点相接不错计为重叠');
}

// ---------- 质心归属与去重 ----------

// 9. 重叠处细胞只计一次；并集外细胞不计
{
  const cells = [
    cellAt(50, 50, 5, 'mid'),  // 位于两视野重叠区 (40..60,40..60)
    cellAt(10, 10, 5, 'a'),    // 仅 A
    cellAt(90, 90, 5, 'b'),    // 仅 B
    cellAt(5, 95, 2, 'out')    // 并集外
  ];
  const fields = [
    { id: 'A', outer: rect(0, 0, 60, 60), holes: [] },
    { id: 'B', outer: rect(40, 40, 60, 60), holes: [] }
  ];
  const s = merge.buildMergeStats(fields, cells, SCALE, ['A', 'B']);
  assert.strictEqual(s.cellCount, 3, JSON.stringify(s.countedCellKeys));
  assert.deepStrictEqual(s.countedCellKeys, ['mid', 'a', 'b']);
  console.log('ok 9 重叠细胞去重一次、并集外细胞不计');
}

// 10. 质心落在并集外边界上不计入（但落在视野内部公共边上计入）
{
  // 细胞质心 x=60，恰好是 A 的右边、B 的内部（B 从 40 起）→ 位于并集内部 → 计入
  const cells1 = [cellAt(60, 50, 2, 'onInner')];
  const fields = [
    { id: 'A', outer: rect(0, 0, 60, 60), holes: [] },
    { id: 'B', outer: rect(60, 0, 40, 60), holes: [] } // 与 A 仅相接于 x=60
  ];
  // 相接情形：x=60 是并集外边界 → 严格不在并集内 → 不计入
  const s1 = merge.buildMergeStats(fields, cells1, SCALE, ['A', 'B']);
  assert.strictEqual(s1.cellCount, 0, JSON.stringify(s1.countedCellKeys));

  // 改为 B 从 40 起（重叠），x=60 在 B 内部 → 计入
  const fields2 = [
    { id: 'A', outer: rect(0, 0, 60, 60), holes: [] },
    { id: 'B', outer: rect(40, 0, 60, 60), holes: [] }
  ];
  const s2 = merge.buildMergeStats(fields2, cells1, SCALE, ['A', 'B']);
  assert.strictEqual(s2.cellCount, 1);
  assert.deepStrictEqual(s2.countedCellKeys, ['onInner']);
  console.log('ok 10 并集外边界不计入；重叠区内部公共边计入');
}

// 11. 细胞质心在 A 的孔洞内，但该孔洞被 B 净区域覆盖 → 计入并集
{
  const cells = [cellAt(50, 50, 2, 'inHole')];
  const fields = [
    { id: 'A', outer: rect(0, 0, 100, 100), holes: [rect(40, 40, 20, 20)] },
    { id: 'B', outer: rect(40, 40, 20, 20), holes: [] }
  ];
  const s = merge.buildMergeStats(fields, cells, SCALE, ['A', 'B']);
  assert.strictEqual(s.cellCount, 1, JSON.stringify(s.countedCellKeys));

  // 只有 A 时该细胞不计入
  const sOnly = merge.buildMergeStats([fields[0]], cells, SCALE, undefined);
  assert.ok(sOnly.error); // 只有一个视野不能做合并；直接测 pointInUnionNet
  assert.strictEqual(merge.pointInUnionNet({ x: 50, y: 50 }, [fields[0]]), false);
  assert.strictEqual(merge.pointInUnionNet({ x: 50, y: 50 }, fields), true);
  console.log('ok 11 孔洞由另一视野覆盖时质心计入并集');
}

// 12. 净面积为零的细胞不计入
{
  const cells = [
    { id: 'z', outer: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }], holes: [] }
  ];
  const fields = [
    { id: 'A', outer: rect(0, 0, 50, 50), holes: [] },
    { id: 'B', outer: rect(0, 0, 100, 100), holes: [] }
  ];
  const s = merge.buildMergeStats(fields, cells, SCALE, ['A', 'B']);
  assert.strictEqual(s.cellCount, 0);
  console.log('ok 12 净面积零细胞不计入合并统计');
}

// 13. 数值：面积 mm²、密度、计入净面积总和；选择顺序不影响结果
{
  const cells = [cellAt(10, 10, 5, 'a'), cellAt(90, 90, 5, 'b')]; // 每个 100 px²
  const fields = [
    { id: 'F1', name: '区一', outer: rect(0, 0, 60, 60), holes: [] },
    { id: 'F2', name: '区二', outer: rect(40, 40, 60, 60), holes: [] }
  ];
  const s = merge.buildMergeStats(fields, cells, SCALE, ['F1', 'F2']);
  assert.ok(Math.abs(s.areaMm2 - 0.0068) < 1e-12, `area=${s.areaMm2}`);
  assert.strictEqual(s.cellCount, 2);
  assert.ok(Math.abs(s.densityPerMm2 - 2 / 0.0068) < 1e-6, `density=${s.densityPerMm2}`);
  assert.ok(Math.abs(s.countedCellAreaMm2 - 0.0002) < 1e-12, `sum=${s.countedCellAreaMm2}`);
  assert.strictEqual(s.areaText, '0.0068');
  assert.deepStrictEqual(s.fieldNames, ['区一', '区二']);

  const sRev = merge.buildMergeStats(fields, cells, SCALE, ['F2', 'F1']);
  assert.strictEqual(sRev.cellCount, s.cellCount);
  assert.ok(Math.abs(sRev.areaMm2 - s.areaMm2) < 1e-12);
  assert.deepStrictEqual(sRev.countedCellKeys.slice().sort(), s.countedCellKeys.slice().sort());
  assert.deepStrictEqual(sRev.fieldNames, ['区二', '区一']); // 名称按请求顺序
  console.log('ok 13 合并数值正确，选择顺序不改变统计');
}

// 14. 未定标：保留细胞数，面积/密度/总和“待定标”
{
  const cells = [cellAt(10, 10)];
  const fields = [
    { id: 'A', outer: rect(0, 0, 50, 50), holes: [] },
    { id: 'B', outer: rect(0, 0, 60, 60), holes: [] }
  ];
  const s = merge.buildMergeStats(fields, cells, null, ['A', 'B']);
  assert.strictEqual(s.calibrated, false);
  assert.strictEqual(s.cellCount, 1);
  assert.strictEqual(s.areaMm2, null);
  assert.strictEqual(s.densityPerMm2, null);
  assert.strictEqual(s.countedCellAreaMm2, null);
  assert.strictEqual(s.areaText, '待定标');
  assert.strictEqual(s.densityText, '待定标');
  assert.strictEqual(s.countedCellAreaText, '待定标');
  assert.ok(s.areaPx > 0, '像素面积仍用于内部计算');
  console.log('ok 14 未定标显示待定标，细胞数保留');
}

// ---------- 选择校验 ----------

const goodFields = [
  { id: 'A', outer: rect(0, 0, 50, 50), holes: [] },
  { id: 'B', outer: rect(0, 0, 60, 60), holes: [] }
];

// 15. 不足两个 / 非数组
{
  assert.match(merge.resolveSelection(goodFields, ['A']).error, /至少选择 2 个/);
  assert.match(merge.resolveSelection(goodFields, []).error, /至少选择 2 个/);
  assert.match(merge.resolveSelection(goodFields, undefined).error, /必须是视野标识数组/);
  assert.match(merge.resolveSelection(goodFields, 'A,B').error, /必须是视野标识数组/);
  assert.match(merge.buildMergeStats(goodFields, [], SCALE, ['A']).error, /至少选择 2 个/);
  console.log('ok 15 不足两个视野或非数组被明确拒绝');
}

// 16. 标识重复
{
  assert.match(merge.resolveSelection(goodFields, ['A', 'A']).error, /重复/);
  assert.match(merge.buildMergeStats(goodFields, [], SCALE, ['A', 'B', 'A']).error, /「A」重复/);
  console.log('ok 16 重复标识被明确拒绝');
}

// 17. 标识不存在 / 空标识
{
  assert.match(merge.resolveSelection(goodFields, ['A', 'X']).error, /「X」不存在/);
  assert.match(merge.resolveSelection(goodFields, ['A', '']).error, /非空字符串/);
  assert.match(merge.resolveSelection(goodFields, ['A', null]).error, /非空字符串/);
  assert.match(merge.buildMergeStats(goodFields, [], SCALE, ['A', 'X']).error, /不存在/);
  console.log('ok 17 不存在/非法标识被明确拒绝');
}

// 18. 合法选择按请求顺序返回
{
  const r = merge.resolveSelection(goodFields, ['B', 'A']);
  assert.strictEqual(r.error, undefined);
  assert.deepStrictEqual(r.selected.map((x) => x.field.id), ['B', 'A']);
  console.log('ok 18 合法选择通过并保持顺序');
}

// ---------- 与逐视野统计的一致性 ----------

// 19. 合并统计不改写逐视野统计；无重叠时并集面积 = 各视野净面积之和
{
  const fieldsSvc = require('./server/fields');
  const cells = [cellAt(10, 10, 5, 'a'), cellAt(90, 90, 5, 'b')];
  const fields = [
    { id: 'A', name: 'A', outer: rect(0, 0, 50, 50), holes: [] },
    { id: 'B', name: 'B', outer: rect(50, 50, 50, 50), holes: [] }
  ];
  const perField = fieldsSvc.buildFieldStats(fields, cells, SCALE);
  const s = merge.buildMergeStats(fields, cells, SCALE, ['A', 'B']);
  const sumArea = perField.reduce((t, x) => t + x.areaMm2, 0);
  assert.ok(Math.abs(s.areaMm2 - sumArea) < 1e-12, `${s.areaMm2} vs ${sumArea}`);
  // 逐视野细胞数之和 = 合并细胞数（无重叠归属）
  assert.strictEqual(s.cellCount, perField.reduce((t, x) => t + x.cellCount, 0));
  // 验证净质心函数仍可用
  assert.ok(geo.netCentroid(cells[0].outer, []));
  console.log('ok 19 无重叠时合并面积等于逐视野面积之和');
}

console.log('\n全部多视野合并统计自测通过 ✔');
