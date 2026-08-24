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
    classList: (() => {
      const s = new Set();
      return {
        add(c) { s.add(c); },
        remove(c) { s.delete(c); },
        toggle(c, force) {
          if (force === undefined) {
            if (s.has(c)) { s.delete(c); return false; }
            s.add(c); return true;
          }
          if (force) s.add(c); else s.delete(c);
          return !!force;
        },
        contains(c) { return s.has(c); },
      };
    })(),
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
    if (e.stack) console.log(e.stack.split('\n').slice(0, 6).join('\n'));
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
  el('region-x').fire('change'); // 让 state.region 生效，地图坐标换算才正确
  el('V-num').value = '5';
  el('wind-type').value = 'uniform';
  el('res-select').value = '20';
  el('flight-alt').value = '80';
  el('alg-aw').checked = true;
  el('alg-base').checked = true;
  el('alg-rrt').checked = true;
  el('alg-pso').checked = false;
  // 新规则：必须先通过右键添加无人机（起点+终点）才能规划
  el('svg2d').fire('contextmenu', Object.assign(ev(44 + 100 * 0.694, 18 + (1000 - 100) * 0.496), { offsetX: 100, offsetY: 100 }));
  click('ctx-uav');
  el('uav-modal-select').value = 'hexa';
  click('uav-modal-ok');
  el('svg2d').fire('click', ev(44 + 900 * 0.694, 18 + (1000 - 900) * 0.496));
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
  // 清理：删除本测试添加的无人机，恢复 0 架状态
  el('svg2d').fire('contextmenu', Object.assign(ev(44 + 100 * 0.694, 18 + (1000 - 100) * 0.496), { offsetX: 100, offsetY: 100 }));
  click('ctx-del-drone');
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
  assert.equal(el('multi-body').children[0].children[4].firstChild.value, '500', '单机模式下终点应同步到任务表');
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
  assert.ok(el('svg2d').innerHTML.includes('禁飞'), '地图上应显示禁飞区');

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

test('右键无人机显示删除按钮并可删除', () => {
  // 空白处右键：不显示删除无人机
  el('svg2d').fire('contextmenu', Object.assign(ev(44 + 100 * 0.694, 18 + (1000 - 900) * 0.496), { offsetX: 100, offsetY: 100 }));
  assert.equal(el('ctx-del-drone').style.display, 'none', '空白处右键不应显示删除无人机');

  // 添加一架无人机到 (600,300)，终点 (600,400)
  el('svg2d').fire('contextmenu', Object.assign(ev(44 + 600 * 0.694, 18 + (1000 - 300) * 0.496), { offsetX: 100, offsetY: 100 }));
  click('ctx-uav');
  el('uav-modal-select').value = 'hexa';
  click('uav-modal-ok');
  el('svg2d').fire('click', ev(44 + 600 * 0.694, 18 + (1000 - 400) * 0.496));
  assert.ok(el('plan-mode').textContent.includes('协同规划（3 架）'), '添加后应为 3 架协同模式');

  // 右键该无人机起点：显示删除按钮并删除
  el('svg2d').fire('contextmenu', Object.assign(ev(44 + 600 * 0.694, 18 + (1000 - 300) * 0.496), { offsetX: 100, offsetY: 100 }));
  assert.equal(el('ctx-del-drone').style.display, 'block', '右键无人机应显示删除按钮');
  click('ctx-del-drone');
  assert.ok(el('plan-mode').textContent.includes('协同规划（2 架）'), '删除后应回到 2 架协同模式');
});

test('实时遥测侧边栏：协同规划后显示紧凑飞行数据', () => {
  assert.equal(el('live-panel').style.display, '', '协同规划后应显示遥测面板');
  const body = el('live-body').innerHTML;
  assert.ok(body.includes('U1'), '应显示无人机1');
  assert.ok(body.includes('m/s'), '应显示飞行速度');
  assert.ok(body.includes('%'), '应显示进度');
  assert.ok(body.includes('速度') && body.includes('高度') && body.includes('已飞') && body.includes('进度'), '应标注各数据含义');
  assert.ok(body.includes('待命') || body.includes('完成') || body.includes(' s'), '应显示已飞时间/状态');
});

test('显示飞行数据开关：右上角按钮可自行打开/关闭遥测面板并记忆', () => {
  assert.equal(el('live-panel').style.display, '', '默认应显示遥测面板');
  click('live-toggle');
  assert.equal(el('live-panel').style.display, 'none', '关闭后应隐藏遥测面板');
  assert.ok(el('live-toggle').textContent.includes('显示飞行数据'), '按钮应提示可显示');
  assert.equal(localStorageStub.getItem('uav_show_live'), '0', '应记忆关闭状态');
  click('live-toggle');
  assert.equal(el('live-panel').style.display, '', '再次点击应重新显示');
  assert.equal(localStorageStub.getItem('uav_show_live'), '1', '应记忆打开状态');
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

test('3D 拖拽：Shift+左键垂直拖拽只调俯仰、不改变方位；↑↓ 键可微调俯仰', () => {
  if (!el('mode-cap').textContent.includes('3D')) click('btn3d');
  const azBefore = el('az-range').value;
  const cap0 = el('mode-cap').textContent;
  el('svg3d').fire('mousedown', { clientX: 100, clientY: 100, button: 0, shiftKey: true, preventDefault() {} });
  documentStub.fire('mousemove', { clientX: 105, clientY: 180 });
  assert.ok(el('mode-cap').textContent.includes('旋转中：俯仰'), 'Shift+左键拖拽应显示旋转轴为俯仰');
  documentStub.fire('mouseup', {});
  const cap1 = el('mode-cap').textContent;
  assert.equal(el('az-range').value, azBefore, '垂直拖拽不应改变方位角');
  assert.notEqual(cap1, cap0, '俯仰角应随垂直拖拽变化');
  assert.ok(cap1.includes('Shift+左键调俯仰'), '标题栏应提示 Shift+左键调俯仰');
  const cap2 = el('mode-cap').textContent;
  documentStub.fire('keydown', { key: 'ArrowUp', preventDefault() {} });
  const cap3 = el('mode-cap').textContent;
  assert.notEqual(cap3, cap2, '↑ 键应微调俯仰');
});

test('UI 精简：冗余按钮移除、备注标签简化、机型详情支持换行', () => {
  assert.equal(el('multi-plan'), null, '开始协同规划按钮应移除');
  assert.equal(el('multi-gen-starts'), null, '生成起点按钮应移除');
  assert.equal(el('multi-gen-goals'), null, '生成终点按钮应移除');
  assert.equal(el('pick-start'), null, '拾取起点按钮应移除');
  assert.equal(el('pick-goal'), null, '拾取终点按钮应移除');
  const htmlSrc = fs.readFileSync(HTML_PATH, 'utf8');
  assert.ok(htmlSrc.includes('来源 / 备注（选填）'), '备注标签应简化为选填');
  assert.ok(!htmlSrc.includes('便于溯源与答辩说明'), '备注标签不应再提溯源答辩');
  assert.ok(htmlSrc.includes('.uav-item{display:flex;flex-direction:column;gap:1px;min-width:0;'), '机型详情应支持长文本换行');
});

test('主题切换：HUD 与经典主题一键切换并记忆', () => {
  const root = documentStub.getElementById('uavwind-sys');
  if (root.classList.contains('hud')) click('theme-toggle');
  click('theme-toggle');
  assert.ok(root.classList.contains('hud'), '应切到 HUD 主题');
  assert.ok(el('theme-toggle').textContent.includes('经典'), '按钮应显示切换到经典');
  assert.equal(localStorageStub.getItem('uav_theme'), 'hud', '应记忆 HUD 主题');
  assert.ok(el('hud-bar').innerHTML.length > 0, 'HUD 模式下遥测栏应有内容');
  click('theme-toggle');
  assert.ok(!root.classList.contains('hud'), '应切回经典主题');
});

test('自定义机型表单：双列布局且输入框可伸缩，避免裁切', () => {
  const htmlSrc = fs.readFileSync(HTML_PATH, 'utf8');
  assert.ok(htmlSrc.includes('row3 cu-form'), '自定义机型表单应使用双列布局');
  assert.ok(htmlSrc.includes('#uavwind-sys #cu-panel .pair input[type=number]{width:auto;flex:1;min-width:0;'), '输入框应可伸缩');
  assert.ok(htmlSrc.includes('推荐高度范围（m）'), '推荐高度范围应占整行并带单位说明');
});

test('播放控制条：位于规划图下方且样式统一', () => {
  const htmlSrc = fs.readFileSync(HTML_PATH, 'utf8');
  const mapIdx = htmlSrc.indexOf('class="map-stage"');
  const playIdx = htmlSrc.indexOf('id="multi-play-wrap"');
  assert.ok(mapIdx > 0 && playIdx > mapIdx, '播放控制条应位于地图区域之后');
  assert.ok(htmlSrc.includes('class="playbar"'), '播放控制条应有统一样式');
});

test('分段风：可增删时段，回放时按时间切换风况', () => {
  el('wind-seg-on').checked = true;
  el('wind-seg-on').fire('change');
  assert.equal(el('wind-seg-wrap').style.display, '', '开启后应显示时段表');
  click('wind-seg-reset');
  assert.equal(el('wind-seg-body').children.length, 3, '默认应有 3 个时段');
  click('wind-seg-add');
  assert.equal(el('wind-seg-body').children.length, 4, '添加后应有 4 个时段');
  el('multi-time').value = '40';
  el('multi-time').fire('input');
  const body = el('live-body').innerHTML;
  assert.ok(body.includes('风 8.0 m/s'), 't=40 应显示第二段风速 8.0 m/s，实际：' + body);
  assert.ok(body.includes('180°'), 't=40 应显示第二段风向 180°');
  el('multi-time').value = '10';
  el('multi-time').fire('input');
  const body10 = el('live-body').innerHTML;
  assert.ok(body10.includes('风 5.0 m/s'), 't=10 应显示第一段风速 5.0 m/s');
  el('multi-time').value = '40';
  el('multi-time').fire('input');
  const body40 = el('live-body').innerHTML;
  assert.notEqual(body40, body10, '不同时段的风应改变飞行数据（速度/进度）');
});

test('高风速拦截与分段风超限提示，路径随风变化', () => {
  if (el('mode-cap').textContent.includes('3D')) click('btn3d');
  // 1) 未开启分段风：高风速应导致多机规划失败
  el('wind-seg-on').checked = false;
  el('wind-seg-on').fire('change');
  el('V-num').value = '25';
  el('wind-type').value = 'uniform';
  click('btn-plan');
  const fail1 = el('multi-info').textContent;
  assert.ok(fail1.includes('无可用机型') || fail1.includes('不满足安全条件'), '高风速应无法多机规划，实际：' + fail1);
  // 2) 开启分段风后，规划仍按当前平均风计算：高风速依然失败
  el('wind-seg-on').checked = true;
  el('wind-seg-on').fire('change');
  click('wind-seg-reset');
  click('btn-plan');
  const fail2 = el('multi-info').textContent;
  assert.ok(fail2.includes('无可用机型') || fail2.includes('不满足安全条件'), '开启分段风后高风速仍应失败，实际：' + fail2);
  // 3) 恢复低风速 + 混合城区：进入超限时段应提示“风超限”
  el('V-num').value = '5';
  el('preset-select').value = 'mix';
  el('preset-select').fire('change');
  click('wind-seg-reset');
  const speedInp2 = el('wind-seg-body').children[1].children[1].firstChild;
  speedInp2.value = '15';
  speedInp2.fire('change');
  click('btn-plan');
  el('multi-time').value = '35';
  el('multi-time').fire('input');
  assert.ok(el('live-body').innerHTML.includes('风超限'), '超限时段应提示风超限，实际：' + el('live-body').innerHTML);
  // 4) 2D 下不同时段的路径/飞行状态应不同
  el('multi-time').value = '10';
  el('multi-time').fire('input');
  const svg10 = el('svg2d').innerHTML;
  el('multi-time').value = '40';
  el('multi-time').fire('input');
  const svg40 = el('svg2d').innerHTML;
  assert.notEqual(svg10, svg40, '不同时段的路径/飞行状态应不同');
  // 恢复原测试环境
  el('preset-select').value = 'empty';
  el('preset-select').fire('change');
});

test('单机规划：高风速被拦截并提示机型抗风不足', () => {
  // 删除所有无人机，回到单机规划
  [[225, 633], [945, 432]].forEach(p => {
    el('svg2d').fire('contextmenu', Object.assign(ev(44 + p[0] * 0.694, 18 + (1000 - p[1]) * 0.496), { offsetX: 100, offsetY: 100 }));
    click('ctx-del-drone');
  });
  el('wind-seg-on').checked = false;
  el('wind-seg-on').fire('change');
  el('V-num').value = '25';
  // 添加一架无人机（起点 400,400 / 终点 500,500），再测高风速拦截
  el('svg2d').fire('contextmenu', Object.assign(ev(44 + 400 * 0.694, 18 + (1000 - 400) * 0.496), { offsetX: 100, offsetY: 100 }));
  click('ctx-uav');
  el('uav-modal-select').value = 'quad';
  click('uav-modal-ok');
  el('svg2d').fire('click', ev(44 + 500 * 0.694, 18 + (1000 - 500) * 0.496));
  click('btn-plan');
  const msg = el('plan-msg').textContent;
  assert.ok(msg.includes('未执行') && (msg.includes('不满足安全条件') || msg.includes('无可用机型')), '高风速应拦截单机规划，实际：' + msg);
  assert.ok(el('plan-mode').textContent.includes('单机规划（1 架）'), '应处于单机规划（1 架）模式');
});

test('无无人机时：不显示起点终点，点击规划提示先添加无人机', () => {
  // 删除上一测试添加的无人机
  el('svg2d').fire('contextmenu', Object.assign(ev(44 + 400 * 0.694, 18 + (1000 - 400) * 0.496), { offsetX: 100, offsetY: 100 }));
  click('ctx-del-drone');
  assert.ok(el('plan-mode').textContent.includes('单机规划（0 架）'), '应为 0 架');
  const svg = el('svg2d').innerHTML;
  assert.ok(!svg.includes('>起点<') && !svg.includes('>终点<'), '无无人机时不应标注起点终点');
  click('btn-plan');
  assert.ok(el('plan-msg').textContent.includes('添加无人机'), '无无人机时规划应被拦截，实际：' + el('plan-msg').textContent);
});

test('地图下方显示各无人机机型与基本信息', () => {
  assert.equal(el('drone-info-wrap').style.display, 'none', '无无人机时表格应隐藏');
  el('svg2d').fire('contextmenu', Object.assign(ev(44 + 400 * 0.694, 18 + (1000 - 400) * 0.496), { offsetX: 100, offsetY: 100 }));
  click('ctx-uav');
  el('uav-modal-select').value = 'hexa';
  click('uav-modal-ok');
  el('svg2d').fire('click', ev(44 + 500 * 0.694, 18 + (1000 - 500) * 0.496));
  assert.equal(el('drone-info-wrap').style.display, '', '添加无人机后应显示机型表格');
  const txt = el('drone-info-body').textContent;
  assert.ok(txt.includes('六旋翼') && txt.includes('10 m/s') && txt.includes('3.0 kg') && txt.includes('12 m/s'), '应显示机型及抗风/载重/巡航，实际：' + txt);
});

test('添加无人机后：未设置终点前不显示终点标记且无法规划', () => {
  // 删除上一测试的无人机（起点 400,400）
  el('svg2d').fire('contextmenu', Object.assign(ev(44 + 400 * 0.694, 18 + (1000 - 400) * 0.496), { offsetX: 100, offsetY: 100 }));
  click('ctx-del-drone');
  // 新添一架无人机，但先不设置终点
  el('svg2d').fire('contextmenu', Object.assign(ev(44 + 300 * 0.694, 18 + (1000 - 300) * 0.496), { offsetX: 100, offsetY: 100 }));
  click('ctx-uav');
  el('uav-modal-select').value = 'hexa';
  click('uav-modal-ok');
  assert.ok(!el('svg2d').innerHTML.includes('>终点<'), '未设置终点前不应出现终点标记');
  click('btn-plan');
  assert.ok(el('plan-msg').textContent.includes('设置终点'), '未设置终点时应提示先设置终点，实际：' + el('plan-msg').textContent);
  // 左键设置终点
  el('svg2d').fire('click', ev(44 + 500 * 0.694, 18 + (1000 - 500) * 0.496));
  assert.ok(el('svg2d').innerHTML.includes('>终点<'), '设置终点后应显示终点标记');
});

test('任务分配：可为每架无人机设置任务载重并影响可行性', () => {
  el('V-num').value = '5';
  const row = el('drone-info-body').children[0];
  const loadInp = row.children[5].firstChild;
  assert.ok(loadInp, '机型表中应有任务载重输入框');
  // 超限载重：hexa 载重上限 3.0 kg
  loadInp.value = '5';
  loadInp.fire('change');
  click('btn-plan');
  const msg1 = el('plan-msg').textContent;
  assert.ok(msg1.includes('载重') && msg1.includes('不满足安全条件'), '超载应被拦截，实际：' + msg1);
  // 合理载重
  const loadInp2 = el('drone-info-body').children[0].children[5].firstChild;
  loadInp2.value = '1';
  loadInp2.fire('change');
  click('btn-plan');
  const msg2 = el('plan-msg').textContent;
  assert.ok(!msg2.includes('不满足安全条件'), '合理载重应可规划，实际：' + msg2);
});

test('任务分配：可逐机设置悬停时长，固定翼含悬停被拦截', () => {
  // 当前 1 架 hexa（起点 300,300 → 终点 500,500）
  const row0 = el('drone-info-body').children[0];
  const hoverInp0 = row0.children[6].firstChild;
  assert.ok(hoverInp0, '机型表应有悬停时长输入');
  hoverInp0.value = '5';
  hoverInp0.fire('change');
  click('btn-plan');
  assert.ok(!el('plan-msg').textContent.includes('不满足安全条件'), '六旋翼含悬停应可规划，实际：' + el('plan-msg').textContent);
  // 添加固定翼并设置悬停 → 该机应规划失败
  el('svg2d').fire('contextmenu', Object.assign(ev(44 + 600 * 0.694, 18 + (1000 - 300) * 0.496), { offsetX: 100, offsetY: 100 }));
  click('ctx-uav');
  el('uav-modal-select').value = 'fixed';
  click('uav-modal-ok');
  el('svg2d').fire('click', ev(44 + 700 * 0.694, 18 + (1000 - 400) * 0.496));
  const row1 = el('drone-info-body').children[1];
  const hoverInp1 = row1.children[6].firstChild;
  hoverInp1.value = '5';
  hoverInp1.fire('change');
  click('btn-plan');
  const info = el('multi-info').textContent;
  assert.ok(info.includes('规划失败'), '固定翼含悬停应规划失败，实际：' + info);
});

test('建筑列表：超过 4 个时可展开/收起', () => {
  el('preset-select').value = 'grid';
  el('preset-select').fire('change');
  assert.equal(el('obs-body').children.length, 4, '默认只显示前 4 行');
  assert.ok(el('obs-expand').textContent.includes('展开全部建筑'), '应显示展开按钮');
  click('obs-expand');
  assert.equal(el('obs-body').children.length, 16, '展开后应显示全部建筑');
  click('obs-expand');
  assert.equal(el('obs-body').children.length, 4, '收起后回到前 4 行');
  el('preset-select').value = 'empty';
  el('preset-select').fire('change');
});

test('右键建筑物可删除', () => {
  // 拖拽添加一个建筑
  click('ctx-build');
  el('svg2d').fire('mousedown', ev(44 + 400 * 0.694, 18 + (1000 - 300) * 0.496));
  el('svg2d').fire('mousemove', ev(44 + 480 * 0.694, 18 + (1000 - 360) * 0.496));
  el('svg2d').fire('mouseup', ev(44 + 480 * 0.694, 18 + (1000 - 360) * 0.496));
  el('build-name').value = '待删建筑';
  click('build-ok');
  assert.ok(el('obs-body').textContent.includes('待删建筑'), '建筑应已添加');
  // 右键建筑内部 → 显示删除建筑物
  el('svg2d').fire('contextmenu', Object.assign(ev(44 + 440 * 0.694, 18 + (1000 - 330) * 0.496), { offsetX: 100, offsetY: 100 }));
  assert.equal(el('ctx-del-building').style.display, 'block', '右键建筑应显示删除按钮');
  click('ctx-del-building');
  assert.ok(!el('obs-body').textContent.includes('待删建筑'), '建筑应已删除');
});

test('右键禁飞区可删除', () => {
  // T9 已在 (200,200)-(400,400) 布置禁飞区
  el('svg2d').fire('contextmenu', Object.assign(ev(44 + 300 * 0.694, 18 + (1000 - 300) * 0.496), { offsetX: 100, offsetY: 100 }));
  assert.equal(el('ctx-del-nf').style.display, 'block', '右键禁飞区应显示删除按钮');
  click('ctx-del-nf');
  el('svg2d').fire('contextmenu', Object.assign(ev(44 + 300 * 0.694, 18 + (1000 - 300) * 0.496), { offsetX: 100, offsetY: 100 }));
  assert.equal(el('ctx-del-nf').style.display, 'none', '删除后同一位置不再有禁飞区');
});

test('起点/终点：鼠标左键可自由拖拽移动', () => {
  // 当前第 1 架无人机起点 (300,300) → 终点 (500,500)
  const ev2 = (x, y) => ev(44 + x * 0.694, 18 + (1000 - y) * 0.496);
  el('svg2d').fire('mousedown', ev2(300, 300));
  el('svg2d').fire('mousemove', ev2(340, 340));
  el('svg2d').fire('mouseup', ev2(340, 340));
  assert.equal(el('multi-body').children[0].children[2].firstChild.value, '340', '拖拽后起点 X 应更新');
  assert.equal(el('multi-body').children[0].children[3].firstChild.value, '340', '拖拽后起点 Y 应更新');
  el('svg2d').fire('mousedown', ev2(500, 500));
  el('svg2d').fire('mousemove', ev2(520, 520));
  el('svg2d').fire('mouseup', ev2(520, 520));
  assert.equal(el('multi-body').children[0].children[4].firstChild.value, '520', '拖拽后终点 X 应更新');
  assert.equal(el('multi-body').children[0].children[5].firstChild.value, '520', '拖拽后终点 Y 应更新');
});

test('多机回放：两架无人机都显示并运动', () => {
  // 复位第2架悬停为0，避免固定翼含悬停失败
  const row1 = el('drone-info-body').children[1];
  const hoverInp1 = row1.children[6].firstChild;
  hoverInp1.value = '0';
  hoverInp1.fire('change');
  el('V-num').value = '5';
  click('btn-plan');
  assert.ok(el('multi-info').textContent.includes('多机协同'), '应完成多机规划');
  el('multi-time').value = '3';
  el('multi-time').fire('input');
  const svg3 = el('svg2d').innerHTML;
  assert.ok(svg3.includes('>UAV1<') && svg3.includes('>UAV2<'), 't=3 时两架无人机都应显示');
  el('multi-time').value = '20';
  el('multi-time').fire('input');
  const svg20 = el('svg2d').innerHTML;
  assert.notEqual(svg3, svg20, '播放过程中标记应移动');
  const live = el('live-body').innerHTML;
  assert.ok(live.includes('U1') && live.includes('U2'), '遥测应显示两架无人机');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
