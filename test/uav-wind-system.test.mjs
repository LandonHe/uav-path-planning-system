import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const HTML_PATH = process.argv[2] || 'uav-wind-system.html';
const html = fs.readFileSync(HTML_PATH, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error('script block not found in ' + HTML_PATH);
const code = m[1];

// ---------- DOM stubs ----------
function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    _id: '',
    style: {},
    _text: '',
    _value: '',
    checked: false,
    _innerHTML: '',
    className: '',
    type: '',
    href: '',
    download: '',
    disabled: false,
    placeholder: '',
    accept: '',
    children: [],
    listeners: {},
    parent: null,
    firstChild: null,
    set id(v) { this._id = String(v || ''); if (this._id) byId.set(this._id, this); },
    get id() { return this._id; },
    set value(v) { this._value = String(v ?? ''); },
    get value() { return this._value; },
    set innerHTML(v) { this._innerHTML = String(v ?? ''); this.children = []; this.firstChild = null; },
    get innerHTML() { return this._innerHTML; },
    appendChild(c) { c.parent = this; this.children.push(c); if (!this.firstChild) this.firstChild = c; return c; },
    removeChild(c) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      if (this.firstChild === c) this.firstChild = this.children[0] || null;
      return c;
    },
    insertBefore(c, ref) {
      c.parent = this;
      const i = this.children.indexOf(ref);
      if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
      return c;
    },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    removeEventListener(t, fn) {
      const a = this.listeners[t];
      if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
    },
    click() { this.fire('click'); },
    fire(t, ev = {}) { (this.listeners[t] || []).slice().forEach(fn => fn(ev)); },
    setAttribute() {},
    getAttribute() { return null; },
    getBBox() { return { x: 0, y: 0, width: 1, height: 1 }; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 760, height: 540, right: 760, bottom: 540 }; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  };
  Object.defineProperty(el, 'textContent', {
    configurable: true,
    get() {
      if (this.children.length) return this.children.map(c => c.textContent ?? '').join('');
      return this._text;
    },
    set(v) { this._text = String(v ?? ''); this.children = []; this.firstChild = null; },
  });
  return el;
}

const byId = new Map();
const docListeners = {};
const documentStub = {
  getElementById(id) {
    return byId.has(id) ? byId.get(id) : null;
  },
  addEventListener(t, fn) { (docListeners[t] = docListeners[t] || []).push(fn); },
  removeEventListener(t, fn) {
    const a = docListeners[t];
    if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  },
  fire(t, ev = {}) { (docListeners[t] || []).slice().forEach(fn => fn(ev)); },
  createElement(tag) { return makeEl(tag); },
  createElementNS(ns, tag) { return makeEl(tag); },
  createTextNode(t) { const e = makeEl('#text'); e.textContent = t; return e; },
  body: makeEl('body'),
  head: makeEl('head'),
};

// Pre-register every element id present in the HTML, like a real document.
{
  const idRe = /id="([^"]+)"/g;
  let idMatch;
  while ((idMatch = idRe.exec(html)) !== null) {
    if (!byId.has(idMatch[1])) byId.set(idMatch[1], makeEl('div'));
  }
}

const store = new Map();
const localStorageStub = {
  getItem(k) { return store.has(k) ? store.get(k) : null; },
  setItem(k, v) { store.set(k, String(v)); },
  removeItem(k) { store.delete(k); },
  clear() { store.clear(); },
};

const downloads = [];
class BlobStub {
  constructor(parts, opts) { this.parts = parts; this.type = (opts && opts.type) || ''; }
  text() { return Promise.resolve(this.parts.join('')); }
}
const URLStub = {
  createObjectURL(b) { downloads.push(b); return 'blob:fake'; },
  revokeObjectURL() {},
};

const ctx = {
  document: documentStub,
  localStorage: localStorageStub,
  Blob: BlobStub,
  URL: URLStub,
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  performance,
  Math, JSON, Date, String, Number, parseInt, parseFloat, isFinite, Infinity, NaN,
  Array, Object, Boolean, RegExp, Error, Promise, Uint8Array, Float64Array,
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

const el = id => documentStub.getElementById(id);
const click = id => el(id).click();
const fire = (id, type) => el(id).fire(type);
const ev = (x, y) => ({ clientX: x, clientY: y, button: 0, preventDefault() {} });
const clearDownloads = () => { downloads.length = 0; };

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('PASS ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL ' + name + ' :: ' + e.message);
  }
}

// T4 (run first, before any planning): export without results is blocked with a hint.
test('导出结果：未规划时提示且不生成文件', () => {
  clearDownloads();
  click('export-results');
  assert.ok(downloads.length === 0, '不应生成文件');
  assert.ok(el('plan-msg').textContent.includes('请先完成一次路径规划'), '应提示先规划');
});

// T1: built-in drone type shows an honest data-source label.
test('内置机型：详情卡片显示数据来源', () => {
  el('uav-select').value = 'quad';
  fire('uav-select', 'change');
  const det = el('uav-detail').innerHTML;
  assert.ok(det.includes('数据来源'), '详情应包含“数据来源”项');
  assert.ok(det.includes('内置示例参数'), '应显示内置示例参数口径');
  assert.ok(det.includes('实测标定'), '应提示正式研究以实测标定为准');
});

// T2: custom drone type keeps an optional source/remark and shows it.
test('自定义机型：可选来源备注被保存并显示', () => {
  el('cu-name').value = '测试机A';
  el('cu-source').value = '实验室实测标定';
  el('cu-maxwind').value = '9';
  el('cu-load').value = '2';
  el('cu-cruise').value = '14';
  el('cu-hoverw').value = '400';
  el('cu-cruisewh').value = '1.0';
  el('cu-climbwh').value = '0.2';
  el('cu-endur').value = '35';
  el('cu-cost').value = '2';
  el('cu-altmin').value = '5';
  el('cu-altmax').value = '150';
  click('cu-save');
  const saved = JSON.parse(localStorageStub.getItem('uav_custom_types') || '[]');
  const t = saved.find(x => x.name === '测试机A');
  assert.ok(t, '自定义机型应已保存');
  assert.equal(t.source, '实验室实测标定', '来源备注应随机型保存');
  assert.ok(el('cu-body').textContent.includes('实验室实测标定'), '列表中应显示来源备注');
});

test('自定义机型：来源留空时列表显示未填写来源', () => {
  el('cu-name').value = '测试机B';
  el('cu-source').value = '';
  click('cu-save');
  const saved = JSON.parse(localStorageStub.getItem('uav_custom_types') || '[]');
  const t = saved.find(x => x.name === '测试机B');
  assert.ok(t, '自定义机型应已保存');
  assert.equal(t.source, '', '来源可留空');
  assert.ok(el('cu-body').textContent.includes('未填写来源'), '应显示未填写来源');
});

// T3: after a successful planning run, one CSV with info/metrics/waypoints is exported.
test('导出结果：规划后生成含基本信息/指标/航点的 CSV', () => {
  el('preset-select').value = 'empty';
  fire('preset-select', 'change');
  el('region-x').value = '1000'; el('region-y').value = '1000'; el('region-z').value = '120';
  el('V-num').value = '5';
  el('wind-type').value = 'uniform';
  el('res-select').value = '20';
  el('flight-alt').value = '80';
  el('start-x').value = '100'; el('start-y').value = '100';
  el('goal-x').value = '900'; el('goal-y').value = '900';
  el('alg-aw').checked = true;
  el('alg-base').checked = true;
  el('alg-rrt').checked = true;
  el('alg-pso').checked = false;
  click('btn-plan');
  const msg = el('plan-msg').textContent;
  assert.ok(!msg.includes('规划出错'), '规划不应报错，实际：' + msg);
  assert.ok(el('metrics-body').textContent.includes('风感知 A*'), '指标表应包含风感知 A*');

  clearDownloads();
  click('export-results');
  assert.equal(downloads.length, 1, '应恰好导出一个文件');
  const csv = downloads[0].parts.join('');
  assert.equal(csv.charCodeAt(0), 0xFEFF, 'CSV 应带 UTF-8 BOM（Excel 中文不乱码）');
  assert.ok(csv.includes('=== 基本信息 ==='), '应包含基本信息区块');
  assert.ok(csv.includes('=== 算法指标 ==='), '应包含算法指标区块');
  assert.ok(csv.includes('=== 航点 ==='), '应包含航点区块');
  assert.ok(csv.includes('风感知 A*'), '指标表应含风感知 A*');
  assert.ok(csv.includes('传统 A*'), '指标表应含传统 A*');
  assert.ok(csv.includes('机型数据来源'), '基本信息应含机型数据来源');
  assert.ok(/风感知 A\*（本文方法）,1,/.test(csv), '航点区应含风感知 A* 的首个航点');
  if (process.env.DUMP_CSV) {
    fs.writeFileSync(process.env.DUMP_CSV, csv, 'utf8');
  }
});

// T6: right-click on the 2D map opens a context menu with three add options.
test('右键菜单：平面图右键显示添加建筑物/无人机/禁飞区', () => {
  el('svg2d').fire('contextmenu', Object.assign(ev(200, 200), { offsetX: 120, offsetY: 120 }));
  const txt = el('ctx-menu').textContent;
  assert.ok(txt.includes('添加建筑物'), '菜单应含添加建筑物');
  assert.ok(txt.includes('添加无人机'), '菜单应含添加无人机');
  assert.ok(txt.includes('添加禁飞区'), '菜单应含添加禁飞区');
});

// T7: building drag (diagonal) then height input creates a building.
test('添加建筑物：拖拽生成建筑并可输入高度', () => {
  click('ctx-build');
  el('svg2d').fire('mousedown', ev(44 + 100 * 0.694, 18 + (1000 - 100) * 0.496));
  el('svg2d').fire('mousemove', ev(44 + 300 * 0.694, 18 + (1000 - 240) * 0.496));
  el('svg2d').fire('mouseup', ev(44 + 300 * 0.694, 18 + (1000 - 240) * 0.496));
  el('build-name').value = '拖拽建筑A';
  el('build-h').value = '45';
  click('build-ok');
  const txt = el('obs-body').textContent;
  assert.ok(txt.includes('拖拽建筑A'), '建筑应加入列表');
  assert.ok(txt.includes('45'), '建筑高度应为 45');
  assert.ok(txt.includes('200') && txt.includes('170') && txt.includes('140'), '中心(200,170) 长200 宽140 应正确');
});

// T8: right-click add drone → choose type → set start/goal; mode switches to 协同 with 2+ drones.
test('添加无人机：选型→起点→终点，单机/协同自动切换', () => {
  el('svg2d').fire('contextmenu', Object.assign(ev(200, 200), { offsetX: 100, offsetY: 100 }));
  click('ctx-uav');
  el('uav-modal-select').value = 'hexa';
  click('uav-modal-ok');
  assert.ok(el('plan-msg').textContent.includes('无人机1'), '应提示无人机1，实际：' + el('plan-msg').textContent);
  assert.ok(el('plan-msg').textContent.includes('终点'), '应提示设置终点');
  el('svg2d').fire('click', ev(44 + 500 * 0.694, 18 + (1000 - 500) * 0.496));
  assert.equal(el('goal-x').value, '500', '单机模式下终点应同步到终点输入框');
  assert.ok(el('plan-mode').textContent.includes('单机规划'), '1 架应显示单机规划');

  el('svg2d').fire('contextmenu', Object.assign(ev(700, 300), { offsetX: 100, offsetY: 100 }));
  click('ctx-uav');
  el('uav-modal-select').value = 'fixed';
  click('uav-modal-ok');
  el('svg2d').fire('click', ev(44 + 800 * 0.694, 18 + (1000 - 600) * 0.496));
  assert.ok(el('plan-mode').textContent.includes('协同规划'), '2 架应显示协同规划');
  assert.equal(el('multi-count').value, '2', '协同模式下多机数量应为 2');

  click('btn-plan');
  assert.ok(el('multi-info').textContent.includes('多机协同'), '应执行协同规划');
});

// T9: draw a free-form no-fly polygon, set bottom/top height; it blocks planning in that zone.
test('禁飞区：自由描绘多边形并设置高度范围，规划避开', () => {
  click('ctx-nf');
  [[200, 200], [400, 200], [400, 400], [200, 400]].forEach(p =>
    el('svg2d').fire('click', ev(44 + p[0] * 0.694, 18 + (1000 - p[1]) * 0.496))
  );
  el('svg2d').fire('dblclick', ev(44 + 200 * 0.694, 18 + (1000 - 200) * 0.496));
  el('nf-z1-input').value = '15';
  el('nf-z2-input').value = '45';
  click('nf-ok');
  const txt = el('nf-body').textContent;
  assert.ok(txt.includes('15–45'), '应显示高度范围 15–45');
  assert.ok(txt.includes('多边形'), '应标注为多边形');

  // 在无人机1起点→终点的直线上添加禁飞区 → 协同规划必须绕行（耗时变长）
  const baseline = (el('multi-info').textContent.match(/无人机1：起点1→终点1 (\d+)s/) || [])[1];
  click('ctx-nf');
  [[280, 480], [460, 480], [460, 620], [280, 620]].forEach(p =>
    el('svg2d').fire('click', ev(44 + p[0] * 0.694, 18 + (1000 - p[1]) * 0.496))
  );
  el('svg2d').fire('dblclick', ev(44 + 280 * 0.694, 18 + (1000 - 480) * 0.496));
  el('nf-z1-input').value = '0';
  el('nf-z2-input').value = '120';
  click('nf-ok');
  click('btn-plan');
  const info = el('multi-info').textContent;
  assert.ok(!info.includes('规划失败'), '禁飞区只应绕行不应让规划失败，实际：' + info);
  const detour = (info.match(/无人机1：起点1→终点1 (\d+)s/) || [])[1];
  assert.ok(parseInt(detour, 10) > parseInt(baseline, 10), '路径应绕开禁飞区（耗时 ' + baseline + 's → ' + detour + 's）');
});

// T10: left-drag on the 3D view rotates azimuth and elevation.
test('3D 视图：左键拖拽旋转（方位角与俯仰）', () => {
  click('btn3d');
  const az0 = parseInt(el('az-range').value, 10) || 0;
  el('svg3d').fire('mousedown', ev(100, 100));
  documentStub.fire('mousemove', { clientX: 160, clientY: 140 });
  documentStub.fire('mouseup', {});
  const az1 = parseInt(el('az-range').value, 10) || 0;
  assert.ok(az1 !== az0, '方位角应随水平拖拽变化');
  assert.ok(el('mode-cap').textContent.includes('俯仰'), '应显示俯仰角');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
