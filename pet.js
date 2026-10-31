const petWrap = document.getElementById('pet-wrap');
const petImg = document.getElementById('pet-img');
const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');

// 形态列表（与 main.js 中 FORMS 顺序保持一致）
const FORM_FILES = [
  'assets/juju-idle.png',
  'assets/form-stand.png',
  'assets/form-hug.png',
  'assets/form-music.png',
  'assets/form-birth.png',
  'assets/form-mbti.png'
];
const FORM_LINES = [
  '啾~（Juju 安宁~）',
  '站得直直的！',
  '抱抱…',
  '总是戴着耳机听歌（其实一直在放歌）',
  '今天是生日吗？？？？',
  'ISFJ 微笑服务中'
];
// 每形态当前生效台词（默认 = FORM_LINES，被用户自定义覆盖；空数组 = 不说话）
let formLines = FORM_LINES.map((s) => [s]);
function applyLinesSetting(lines) {
  formLines = FORM_LINES.map((d, i) => Array.isArray(lines && lines[i]) ? lines[i] : [d]);
}

// 系统事件台词（用户在编辑器里可自定义；空/缺失 = 用内置默认）
const EVENT_DEFAULTS = {
  pat: '摸头杀…（开心）',
  hand: '牵牵手…（最喜欢你了）',
  musicStop: '音乐停了…',
  sleep: 'Zzz…（Juju 睡着了）',
  wake: '哈欠……（揉眼睛醒来）',
  unlock: '你回来啦！（一直在这儿等你）',
  sedentary: '已经坐了 45 分钟啦！站起来动一动',
  water: '该喝水啦！（推来一杯水）',
  batteryOff: '没插电源…（记得充电）',
  batteryOn: '充上电啦！',
  netOffline: '断网了…（世界安静了）',
  netOnline: '网回来啦！',
  pomoStart: '开始专注！{min} 分钟（我会安静陪着你的）',
  pomoBreak: '专注结束！休息 {min} 分钟～',
  pomoLong: '完成 4 轮！大休息 {min} 分钟，最棒了！',
  pomoResume: '休息结束！新一轮专注开始',
  levelUp: '我们的感情升级啦！现在是 Lv.{lv} · {lvName} ♡',
  pomoStop: '番茄钟停止了（下次再来）',
  pomoWarn1: '还剩 1 分钟～',
  pomoWarn10: '还剩 10 秒！',
  todoDone: '又搞定一件！{left}',
  todoAllDone: '待办全都做完啦，今天可以轻轻松松',
  reminder: '⏰ 到点啦：{text}',
  reminderSoon: '⏰ 还有 5 分钟：{text}',
  todoSay: '待办：{list}{more}',
  hourly: '{h} 点整啦~'
};
let evtLines = {};   // { key: [自定义台词] }
function applyEventLinesSetting(ev) {
  evtLines = {};
  if (ev && typeof ev === 'object') {
    for (const k of Object.keys(EVENT_DEFAULTS)) {
      if (Array.isArray(ev[k])) evtLines[k] = ev[k];
    }
  }
}
// 取事件台词：用户保存过（含空数组=清空）→ 按用户池（空=不说话）；
// 从未保存过 → 内置默认（仅作为编辑器里的示例初始值）
function eventLine(key, vars) {
  const arr = evtLines[key];
  let text = Array.isArray(arr) ? (arr.length ? pickRandom(arr) : '') : (EVENT_DEFAULTS[key] || '');
  let line = renderLine(text);
  const pomoDurMap = { pomoStart: pomoDur.focus, pomoBreak: pomoDur.break, pomoLong: pomoDur.long };
  if (pomoDurMap[key] !== undefined && line.includes('{min}')) line = line.split('{min}').join(pomoDurMap[key]);
  if (vars) for (const k of Object.keys(vars)) line = line.split(`{${k}}`).join(String(vars[k]));
  return line;
}

// 每个形态的显示宽度（px）：按"猫身体视觉宽度一致"校准
// （听歌音符占宽多故整体更宽，抱抱/生日画面撑满故略缩）
const FORM_WIDTHS = [100, 96, 88, 124, 84, 96];

// 三档整体缩放（中档 110px 为基准 1.0）
let scaleMul = 1;
let currentIdx = 0;    // 当前形态索引（点击循环切换用）

function applyFormWidth(idx) {
  const w = Math.round((FORM_WIDTHS[idx] || 100) * scaleMul);
  petWrap.style.width = w + 'px';
  petWrap.style.marginLeft = -(w / 2) + 'px';
  // 上报宠物实际视觉宽度，主进程吸附时以宠物本体为基准
  if (window.petAPI && window.petAPI.reportWidth) window.petAPI.reportWidth(w);
  reportMetrics();
  if (petImg.complete && petImg.naturalWidth) buildEyes(idx);
}

// 上报宠物在窗口内的垂直位置与高度（顶边栖息要对齐屏幕顶边）
let lastMetrics = { top: -1, height: -1 };
function reportMetrics() {
  if (!window.petAPI || !window.petAPI.reportMetrics) return;
  requestAnimationFrame(() => {
    const r = petWrap.getBoundingClientRect();
    const top = Math.round(r.top), height = Math.round(r.height);
    if (Math.abs(top - lastMetrics.top) < 1 && Math.abs(height - lastMetrics.height) < 1) return;
    lastMetrics = { top, height };
    window.petAPI.reportMetrics(top, height);
  });
}

// ============================================================
// 眼睛跟随鼠标 + 眨眼（裁剪平移方案：每只睁眼叠一个小图层，
// 背景用原图裁剪对齐，随鼠标方向平移 1~2px，纯色脸颊内无缝）
// ============================================================
// 每形态眼位（百分比坐标，rad = 眼半径 / 图宽 %）；null = 闭眼形态不做跟随
const FORM_EYES = [
  { l: [27, 53], r: [68, 53], rad: 6.3 },   // 待机
  { l: [27, 52], r: [68, 52], rad: 5.5 },   // 站立
  null,                                      // 抱抱（眯眼）
  null,                                      // 听歌（眯眼）
  { l: [27, 57], r: [68, 57], rad: 5.0 },   // 生日
  { l: null,     r: [70, 48], rad: 5.0 }    // 微笑（只有右眼睁着）
];
const EYE_MAX = 1.6;          // 眼层最大平移像素
const petVisual = document.getElementById('pet-visual');
let eyeEls = [];              // [{el, bx, by}]
let eyeCfg = null;
let eyeTarget = { x: 0, y: 0 };
let eyeCur = { x: 0, y: 0 };
let faceColors = {};          // 每形态脸颊色（主进程采样），眨眼盖板用
let reactPrevIdx = -1;        // 悬停反应前的形态，恢复用
let reactTimer = null;        // 悬停反应的恢复计时器

// 启动时取主进程采样的脸颊色（眨眼盖板），取到后重建当前眼层
try {
  const fc = window.petAPI && window.petAPI.getFaceColors && window.petAPI.getFaceColors();
  if (Array.isArray(fc)) {
    fc.forEach((c, i) => { if (typeof c === 'string' && c) faceColors[i] = c; });
    buildEyes(currentIdx);
  }
} catch (_) {}

function buildEyes(idx) {
  eyeEls.forEach((e) => e.el.remove());
  eyeEls = [];
  eyeCfg = FORM_EYES[idx] || null;
  if (!eyeCfg) return;
  // 用布局尺寸（offsetWidth/Height）而不是 getBoundingClientRect：
  // 后者包含呼吸/hop/摇摆等动画变换，动画进行中量到的尺寸是歪的，
  // 眼层会永久错位（"偶尔卡住怪眼睛"就是这个原因）
  const W = petImg.offsetWidth, H = petImg.offsetHeight;
  if (!W || !H) return;
  const face = faceColors[idx] || '#d8c3e9';
  for (const side of ['l', 'r']) {
    const c = eyeCfg[side];
    if (!c) continue;
    const px = c[0], py = c[1];
    const s = 4.4 * eyeCfg.rad / 100 * W;            // 层边长（正方形像素）
    const el = document.createElement('div');
    el.className = 'eyeball';
    el.style.left = (px / 100 * W - s / 2) + 'px';
    el.style.top = (py / 100 * H - s / 2) + 'px';
    el.style.width = s + 'px';
    el.style.height = s + 'px';
    el.style.backgroundImage = 'url("' + FORM_FILES[idx] + '")';
    el.style.backgroundSize = W + 'px ' + H + 'px';
    const lid = document.createElement('div');
    lid.className = 'lid';
    lid.style.background = face;
    el.appendChild(lid);
    petVisual.appendChild(el);
    // 层左上角对应的原图像素坐标（背景定位基准）
    eyeEls.push({ el, bx: px / 100 * W - s / 2, by: py / 100 * H - s / 2 });
  }
}

// 主进程推送光标位置 → 换算成眼睛注视方向
if (window.petAPI && window.petAPI.onCursor) {
  window.petAPI.onCursor((p) => {
    const r = petImg.getBoundingClientRect();
    const cx = window.screenX + r.left + r.width / 2;
    const cy = window.screenY + r.top + r.height / 2;
    eyeTarget.x = Math.max(-1, Math.min(1, (p.x - cx) / 350)) * EYE_MAX;
    eyeTarget.y = Math.max(-1, Math.min(1, (p.y - cy) / 350)) * EYE_MAX;
  });
}

// 平滑趋近 + 写入背景定位（跑步动画状态由主进程按实际速度驱动，避免位移阈值导致闪烁）
let isRunning = false;
let wasFaceLeft = false;
requestAnimationFrame(function eyeLoop() {
  // 关闭「眼睛跟随」后视线缓动回中，眨眼照旧（眨眼在 scheduleBlink 里独立运行）
  if (!eyeFollowOn) { eyeTarget.x = 0; eyeTarget.y = 0; }
  eyeCur.x += (eyeTarget.x - eyeCur.x) * 0.18;
  eyeCur.y += (eyeTarget.y - eyeCur.y) * 0.18;
  if (eyeEls.length) {
    // 翻转朝向时，眼层水平偏移取反（镜像补偿）
    const ex = wasFaceLeft ? -eyeCur.x : eyeCur.x;
    for (const e of eyeEls) {
      // 背景定位加 eyeCur（而非减）：图层内容朝光标方向移动
      e.el.style.backgroundPosition = (-(e.bx) + ex).toFixed(2) + 'px ' + (-(e.by) + eyeCur.y).toFixed(2) + 'px';
    }
  }
  requestAnimationFrame(eyeLoop);
});

// 主进程推送跑步状态：moving = 是否在跑，dir = 朝向
if (window.petAPI && window.petAPI.onFollowState) {
  window.petAPI.onFollowState((st) => {
    isRunning = !!st.moving;
    document.body.classList.toggle('running', isRunning);
    if (st.dir) {
      wasFaceLeft = st.dir < 0;
      document.body.classList.toggle('face-left', wasFaceLeft);
    }
    if (isRunning) hoverZone = null;   // 跑动中不触发悬停部位反应
  });
}

// 随机眨眼（每 2.5~6.5 秒）
(function scheduleBlink() {
  setTimeout(() => {
    if (eyeEls.length) {
      eyeEls.forEach((e) => e.el.classList.add('blink'));
      setTimeout(() => eyeEls.forEach((e) => e.el.classList.remove('blink')), 150);
    }
    scheduleBlink();
  }, 2500 + Math.random() * 4000);
})();

// 统一的形态视觉切换入口（keepReact=true 时不取消悬停反应的恢复计时，仅 doReact 内部用）
function setFormVisual(idx, keepReact) {
  if (!keepReact && reactTimer) {
    clearTimeout(reactTimer);
    reactTimer = null;
    reactPrevIdx = -1;
  }
  currentIdx = idx;
  const changed = petImg.getAttribute('src') !== FORM_FILES[idx];
  petImg.src = FORM_FILES[idx];
  applyFormWidth(idx);
  if (changed) {
    petImg.onload = () => buildEyes(idx);   // 新图解码完再对齐眼层
  }
}
setFormVisual(0);

// 台词池（默认示例，已被"编辑台词"功能取代，保留随机抽取逻辑）
// 生气彩蛋：快速连点时触发
const ANGRY_LINES = [
  '给我撒娇气存在！哼！',
  '（新米猫外星人形态上线…）'
];

// 左键单击轮换的形态（默认 待机/站立/抱抱/生日/微笑；听歌归音频联动）
// 右键 → 功能开关 → 单击动作 → 切换形态的轮换队列 可自由增删
let CLICK_CYCLE = [0, 1, 2, 4, 5];
// 悬停反应映射：zone → 目标形态索引；-1 = 只做动效+台词不换姿势；-2 = 完全不响应
let hoverMap = { head: 5, hand: 2 };
let eyeFollowOn = true;   // 眼睛跟随鼠标开关（关闭后眼层回中，眨眼保留）

let bubbleTimer = null;
function showBubble(text) {
  // 空台词或单个 "-" = 静默：不弹框、不打断当前气泡
  const t = String(text == null ? '' : text).trim();
  if (!t || t === '-') return;
  bubbleText.textContent = t;
  bubble.classList.add('show');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.remove('show'), 2600);
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// 台词变量：{greet} 时段问候 / {now} 当前时间 / {date} 日期
function renderLine(t) {
  const now = new Date();
  const h = now.getHours();
  const greet = h >= 5 && h < 11 ? '早上好'
    : h < 14 ? '中午好'
    : h < 18 ? '下午好'
    : h < 23 ? '晚上好'
    : '夜深了';
  return String(t)
    .replace(/\{greet\}/g, greet)
    .replace(/\{now\}/g, `${String(h).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`)
    .replace(/\{date\}/g, `${now.getMonth() + 1}月${now.getDate()}日`);
}

// ---------- 番茄钟状态（顶层声明：点击台词也要读取） ----------
const pomo = { running: false, phase: null, endsAt: 0, cycles: 0, warned1: false, warned10: false };
let pomoDur = { focus: 25, break: 5, long: 15 };   // 各阶段时长（分钟），随设置同步

// 专注安静：番茄钟专注阶段 + 开关打开时，不散步、不报时、不主动闲聊
function isQuietFocus() {
  return T.focusQuiet !== false && pomo.running && pomo.phase === 'focus';
}

function pomoRemainingText() {
  const remain = Math.max(0, pomo.endsAt - Date.now());
  const m = Math.floor(remain / 60000);
  const s = Math.floor((remain % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---------- 拖拽 & 点击（Pointer Events + 指针捕获） ----------
// 用 setPointerCapture 后，按下期间光标即使跑出窗口（快速拖动时窗口跟不上），
// pointerup 也会保证送达本窗口（Chromium 底层调用 Win32 SetCapture），
// 彻底避免 mouseup 丢失导致 dragging 卡死、宠物"粘"在光标上被拉回原位。
let dragging = false;
let moved = 0;
let lastX = 0, lastY = 0, lastT = 0;
let velX = 0, velY = 0;   // 甩出速度 px/ms（平滑值）
let hoverZone = null;     // 悬停中的部位热区（head/hand）
let lastHoverAt = 0;      // 上次悬停触发时间（冷却防连发）

petWrap.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;   // 只响应左键
  dragging = true;
  moved = 0;
  lastX = e.screenX;
  lastY = e.screenY;
  lastT = performance.now();
  velX = 0; velY = 0;
  document.body.classList.add('drag');
  try { petWrap.setPointerCapture(e.pointerId); } catch (_) {}
});

window.addEventListener('pointermove', (e) => {
  // 悬停可交互区域判断，其余区域点击穿透
  // 拖拽期间强制保持可交互：否则快速拖动时鼠标跑到透明区会切成穿透，收不到 pointerup
  const hit = dragging || (e.target.closest && (e.target.closest('#pet-wrap') || e.target.closest('#bubble')));
  if (window.petAPI) window.petAPI.setClickable(!!hit);

  if (!dragging) {
    // 悬停部位反应（无需点击）：光标进入头/手热区 → 跳一下 + 台词，1.5s 冷却防连发
    const z = hitZone({ clientX: e.clientX, clientY: e.clientY });
    const ts = Date.now();
    if (z && z !== hoverZone && ts - lastHoverAt > 1500 && !isRunning) {
      hoverZone = z;
      lastHoverAt = ts;
      // doReact 返回 false = 该部位设为「无反应」，此时连台词也不弹；专注时只做动作不出声
      if (doReact(z) && !isQuietFocus()) showBubble(eventLine(z === 'hand' ? 'hand' : 'pat'));
    } else if (!z) {
      hoverZone = null;
    }
    return;
  }
  const now = performance.now();
  const dx = e.screenX - lastX;
  const dy = e.screenY - lastY;
  const dt = Math.max(1, now - lastT);
  moved += Math.abs(dx) + Math.abs(dy);
  // 指数平滑速度；单次事件位移异常大（追踪丢失后重新进入）时按重新抓取处理，不计入速度
  if (Math.abs(dx) < 120 && Math.abs(dy) < 120) {
    velX = velX * 0.7 + (dx / dt) * 0.3;
    velY = velY * 0.7 + (dy / dt) * 0.3;
  } else {
    velX = 0; velY = 0;
  }
  lastX = e.screenX;
  lastY = e.screenY;
  lastT = now;
  if (window.petAPI) window.petAPI.move(dx, dy);
});

function endDrag() {
  if (!dragging) return;
  dragging = false;
  document.body.classList.remove('drag');

  if (moved < 8) {
    handleClick();
  } else {
    // 松手：按甩出速度滑行（主进程处理惯性 + 吸附）
    if (window.petAPI) window.petAPI.fling(velX, velY);
    document.body.classList.add('drop');
    setTimeout(() => document.body.classList.remove('drop'), 460);
  }
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);
// 兜底：窗口失焦（如拖拽中按了 Win 键等）时强制结束拖拽，防卡死
window.addEventListener('blur', endDrag);

// 双击判定窗口 = 系统"鼠标双击速度"设置（主进程读注册表，默认 500ms）
const DBL_MS = (() => {
  try {
    const v = window.petAPI && window.petAPI.getDblMs && window.petAPI.getDblMs();
    if (v) return Math.max(200, Math.min(900, v));
  } catch (_) {}
  return 500;
})();

// 部位热区（百分比矩形 [x1,y1,x2,y2]）：手部优先于头部；都没命中 = 切换形态
const FORM_ZONES = [
  { head: [12, 8, 88, 80],   hands: [[0, 46, 17, 72], [83, 46, 100, 72]] },   // 待机（两侧小手）
  { head: [12, 10, 88, 78],  hands: [[0, 50, 20, 76], [80, 50, 100, 76]] },   // 站立
  { head: [10, 5, 90, 80],   hands: [[28, 58, 72, 98]] },                      // 抱抱（抱着小狗）
  { head: [20, 22, 80, 80],  hands: [[3, 38, 26, 62], [74, 38, 97, 62]] },    // 听歌（两侧耳机手）
  { head: [8, 12, 92, 80],   hands: [[28, 58, 72, 80]] },                      // 生日（双爪举起）
  { head: [6, 12, 92, 75],   hands: [[58, 62, 95, 98]] }                       // 微笑（挥手）
];
function hitZone(pt) {
  if (!pt) return null;
  const r = petImg.getBoundingClientRect();
  if (!r.width) return null;
  const x = (pt.clientX - r.left) / r.width * 100;
  const y = (pt.clientY - r.top) / r.height * 100;
  const z = FORM_ZONES[currentIdx];
  if (!z) return null;
  const inRect = (rc) => x >= rc[0] && x <= rc[2] && y >= rc[1] && y <= rc[3];
  if ((z.hands || []).some(inRect)) return 'hand';
  if (inRect(z.head)) return 'head';
  return null;
}

function doHop() {
  document.body.classList.remove('hop');
  void document.body.offsetWidth;
  document.body.classList.add('hop');
}

// 悬停部位反应：按用户配置切姿势（默认摸头→微笑、牵手→抱抱）+ 变形动画，1.4s 后自动恢复
// （参考社区桌宠做法：真动作 = 换姿势贴图，变形动画只作辅助）
// 返回 false 表示该部位被设为「无反应」，调用方不要弹台词
const REACT_MS = { giggle: 750, wave: 700 };
const HOVER_HOLD_MS = 1400;
function doReact(zone) {
  const target = hoverMap[zone];
  if (target === -2) return false;              // 完全不响应
  const cls = zone === 'hand' ? 'wave' : 'giggle';
  document.body.classList.remove('giggle', 'wave');
  void document.body.offsetWidth;
  document.body.classList.add(cls);
  setTimeout(() => document.body.classList.remove(cls), REACT_MS[cls] + 50);
  // 目标为 -1（只动效）或已经是当前姿势 → 不换图
  if (target >= 0 && target < FORM_FILES.length && target !== currentIdx) {
    clearTimeout(reactTimer);
    if (reactPrevIdx < 0) reactPrevIdx = currentIdx;
    setFormVisual(target, true);
    reactTimer = setTimeout(() => {
      if (reactPrevIdx >= 0) setFormVisual(reactPrevIdx, true);
      reactPrevIdx = -1;
      reactTimer = null;
    }, HOVER_HOLD_MS);
  }
  return true;
}

// 摸头彩蛋：跳一下 + 摸头台词（顺带涨好感）
function doPat() {
  document.body.classList.remove('hop');
  void document.body.offsetWidth;
  document.body.classList.add('hop');
  showBubble(eventLine('pat'));
  if (window.petAPI && window.petAPI.affectionGain) window.petAPI.affectionGain();
}

// 动作执行：cycle / pat / none 本地处理（要配合动画），其余交给主进程
function runAction(id) {
  if (id === 'cycle') { cycleForm(); return; }
  if (id === 'pat') { doPat(); return; }
  if (!id || id === 'none') return;
  if (window.petAPI && window.petAPI.runAction) window.petAPI.runAction(id);
}
// 本地就能完成、不需要等双击判定窗的动作（保证手感）
const INSTANT_ACTIONS = ['cycle', 'pat'];

function handleClick() {
  // 双击判定：距上次单击在系统双击时限内 → 触发"双击动作"
  const now = Date.now();
  if (now - lastClickAt < DBL_MS) {
    lastClickAt = 0;
    // 若第一击排了「延迟执行」的单击动作，双击时取消它，避免一个手势触发两件事
    if (pendingClick) { clearTimeout(pendingClick); pendingClick = null; }
    doDblAction();
    return;
  }
  lastClickAt = now;
  if (INSTANT_ACTIONS.includes(clickAct)) { runAction(clickAct); return; }
  if (clickAct === 'none') return;
  // 其他单击动作：等过了双击判定窗再执行，这样双击不会被单击动作抢跑
  if (pendingClick) clearTimeout(pendingClick);
  pendingClick = setTimeout(() => {
    pendingClick = null;
    runAction(clickAct);
  }, DBL_MS);
}

// 按轮换表切到下一个形态
function cycleForm() {
  // 悬停反应正在展示临时姿势时，以反应前的形态为基准算下一个，避免"原地打转"
  const baseIdx = reactPrevIdx >= 0 ? reactPrevIdx : currentIdx;
  const cycle = CLICK_CYCLE.length ? CLICK_CYCLE : [0];
  let pos = cycle.indexOf(baseIdx);
  let next;
  if (pos < 0) {
    // 当前形态不在轮换表里（如手动进过抱抱/微笑、或自动进入的听歌）→ 取轮换表里第一个更大的，否则回到第一个
    next = cycle.find((i) => i > baseIdx);
    if (next === undefined) next = cycle[0];
  } else {
    next = cycle[(pos + 1) % cycle.length];
  }
  doHop();
  if (window.petAPI) window.petAPI.selectForm(next);
}

// 双击动作（右键菜单 → 功能开关 → 双击动作 可配置）
let dblAct = 'pat';
// 单击动作（右键菜单 → 功能开关 → 单击动作）：cycle 切形态 | menu 打开菜单 | lines 编辑台词 | pomo 番茄钟 | none 无响应
let clickAct = 'cycle';
let pendingClick = null;   // 非切形态的单击动作延迟执行句柄（等双击判定窗）
let lastClickAt = 0;   // 上一次单击时间，用于双击判定
function doDblAction() {
  // 双击动作和单击动作共用同一份动作表（双菜单里不提供「切换形态」，见主进程 DBL_SKIP）
  runAction(dblAct);
}

// 右键菜单
petWrap.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (window.petAPI) window.petAPI.showMenu();
});

// ---------- 形态切换 ----------
if (window.petAPI) {
  window.petAPI.onSetForm((idx) => {
    if (idx < 0 || idx >= FORM_FILES.length) return;
    setFormVisual(idx);
    // 番茄钟运行中：气泡显示剩余时间（形态照常切换）
    if (pomo.running) {
      const tag = pomo.phase === 'focus' ? '专注中' : (pomo.phase === 'long' ? '长休息中' : '休息中');
      showBubble(`${tag}，还剩 ${pomoRemainingText()}（已完成 ${pomo.cycles} 轮）`);
    } else {
      // 该形态配置了台词则随机抽一条（删空则不说话），支持 {greet}/{now}/{date} 变量
      const arr = formLines[idx] || [];
      if (arr.length) showBubble(renderLine(pickRandom(arr)));
    }
    // 手动选择 → 锁定 10 分钟，期间暂停自动切换（音频联动除外，结束后恢复）
    state.manualUntil = Date.now() + 10 * 60 * 1000;
    state.manualIdx = idx;
    state.autoMode = 'manual';
    document.body.classList.remove('sleeping', 'music');
    stopWalkNow();
  });
}

// ============================================================
// 环境感知状态机：睡觉 > 听歌 > 待机，手动锁定优先于一切
// ============================================================
const MUSIC_IDX = 3;
const COOLDOWN = 30 * 1000;        // 自动切换最小间隔
// 睡觉 / 散步的触发时长与方式（主进程设置同步，默认 10 分钟入睡、3 分钟开始逛）
let idleSleepSec = 600;
let walkStartSec = 180;
let walkMode = 'continuous';       // continuous 一直逛 | occasion 走一段歇一段
let sleepOnLock = true;
let walkPhaseEnd = 0;              // occasion：这一趟走到什么时候
let walkRestEnd = 0;               // occasion：歇到什么时候再走
function applyIdleSetting(s) {
  const it = (s && s.idle) || {};
  idleSleepSec = Math.max(0, Number(it.sleepMin) || 0) * 60;
  walkStartSec = Math.max(0, Number(it.walkMin) || 0) * 60;
  walkMode = it.walkMode === 'occasion' ? 'occasion' : 'continuous';
  sleepOnLock = it.sleepOnLock !== false;
  T.sleep = idleSleepSec > 0;      // 0 分钟 = 从不自动睡
  T.walk = walkStartSec > 0;
}

const state = {
  autoMode: 'idle',   // idle | music | sleep | manual
  manualUntil: 0,
  manualIdx: -1,      // 手动选择的形态，音乐结束后恢复
  idleSec: 0,
  music: false,
  lastSwitch: 0,
  walking: false,
  lockSleep: false    // 锁屏导致睡着（解锁或用户有操作就清掉）
};

// 功能开关（主进程设置同步）
let T = { audio: true, sleep: true, walk: true, sedentary: true, water: true, typing: true, groove: true };

// ---------- 自行散步 ----------
function stopWalkNow() {
  if (!state.walking) return;
  state.walking = false;
  document.body.classList.remove('walking');
  petImg.style.transform = '';
  if (window.petAPI) window.petAPI.walkStop();
}
if (window.petAPI) {
  window.petAPI.onWalkDir((dir) => {
    petImg.style.transform = dir < 0 ? 'scaleX(-1)' : '';
  });
}

function autoSetForm(idx, line, mode) {
  const now = Date.now();
  // 听歌形态的进出实时响应（自身有滞回防抖），不受冷却限制
  const musicSwitch = mode === 'music' || state.autoMode === 'music';
  if (!musicSwitch && mode !== 'sleep' && now - state.lastSwitch < COOLDOWN) return;
  state.lastSwitch = now;
  state.autoMode = mode;
  setFormVisual(idx);
  showBubble(line);
  document.body.classList.remove('sleeping', 'music');
  if (mode === 'sleep') document.body.classList.add('sleeping');
  if (mode === 'music') document.body.classList.add('music');
  if (window.petAPI) window.petAPI.syncForm(idx);
}

// 睡意判定：与听歌形态共存（听歌形象 + Zzz），不抢形态
function sleepDue() {
  return (T.sleep && state.idleSec >= idleSleepSec) || state.lockSleep === true;
}

function updateAutoState() {
  const now = Date.now();

  // 听歌形态实时跟随系统音频（不受手动锁定/冷却影响）；
  // 听歌时犯困不换睡姿，只在听歌形象上冒 Zzz
  if (state.music) {
    if (state.autoMode !== 'music') {
      stopWalkNow();
      // 进入听歌形态：台词池有内容才说话（清空 = 安静进入）
      const musicLines = formLines[MUSIC_IDX] || [];
      autoSetForm(MUSIC_IDX,
        musicLines.length ? renderLine(pickRandom(musicLines)) : '',
        'music');
    }
    document.body.classList.toggle('sleeping', sleepDue());
    return;
  }
  if (!state.music && state.autoMode === 'music') {
    // 音乐结束。刚才若已在听歌形态上睡着（Zzz 挂着），转为普通睡觉，安静别吵醒
    if (document.body.classList.contains('sleeping')) {
      state.autoMode = 'sleep';
      setFormVisual(0);
      document.body.classList.remove('music');
      return;
    }
    // 音乐结束：若还在手动锁定期内，恢复用户手选的形态，否则回待机
    if (now < state.manualUntil && state.manualIdx >= 0) {
      setFormVisual(state.manualIdx);
      document.body.classList.remove('sleeping', 'music');
      state.autoMode = 'manual';
      // 手动锁定期内恢复手选形态，也要说"音乐停了"（之前静默恢复导致该台词无法触发）
      showBubble(eventLine('musicStop'));
    } else {
      // 音乐结束回到待机：事件台词（可自定义）
      autoSetForm(0, eventLine('musicStop'), 'idle');
    }
    return;
  }

  // 手动锁定期间不自动切换
  if (now < state.manualUntil) return;
  if (state.autoMode === 'manual') state.autoMode = 'idle';

  // 睡觉：无操作到点，或锁屏后睡着（「锁屏时也睡觉」）；听歌形态除外（在上面已用 Zzz 共存处理）
  if (sleepDue()) {
    if (state.autoMode !== 'sleep') {
      stopWalkNow();
      autoSetForm(0, eventLine('sleep'), 'sleep');
    }
    return;
  }
  if (state.autoMode === 'sleep') {
    state.autoMode = 'idle';
    document.body.classList.remove('sleeping');
    showBubble(eventLine('wake'));
    state.lastSwitch = now;
    return;
  }

  // 自行散步：待机状态、超过设定空闲时长、开关打开（专注阶段不散步，别打扰）
  // 睡觉时长设为「从不」时没有上限，一直逛
  const sleepLimit = idleSleepSec > 0 ? idleSleepSec : Infinity;
  // 有人动了（空闲清零）→ 散步节奏重新算，避免沿用上一轮的「走/歇」计时
  if (state.idleSec < walkStartSec) { walkPhaseEnd = 0; walkRestEnd = 0; }
  let walkOk = T.walk
    && !isQuietFocus()
    && !document.body.classList.contains('perch')   // 挂在顶边时不散步
    && state.autoMode === 'idle'
    && !state.music
    && state.idleSec >= walkStartSec
    && state.idleSec < sleepLimit;
  // 「走一段歇一段」：走 6~14 秒，歇 15~45 秒再走，比一刻不停更像活的
  if (walkOk && walkMode === 'occasion') {
    if (state.walking) {
      if (now >= walkPhaseEnd) {
        stopWalkNow();
        walkRestEnd = now + 15000 + Math.random() * 30000;
        walkOk = false;
      }
    } else {
      walkOk = now >= walkRestEnd;
    }
  }
  if (walkOk && !state.walking) {
    state.walking = true;
    if (walkMode === 'occasion') walkPhaseEnd = now + 6000 + Math.random() * 8000;
    document.body.classList.add('walking');
    if (window.petAPI) window.petAPI.walkStart();
  } else if (!walkOk && state.walking) {
    stopWalkNow();
  }
}
setInterval(updateAutoState, 200);

// 睡觉 / 听歌状态同步给主进程：睡觉时不掉星星，听歌时不掉也不追星星
if (window.petAPI && window.petAPI.sleepState) {
  new MutationObserver(() => {
    window.petAPI.sleepState(document.body.classList.contains('sleeping'));
    if (window.petAPI.musicState) window.petAPI.musicState(document.body.classList.contains('music'));
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

// ---------- 空闲 / 设置 / 提醒（主进程事件） ----------
let activeMs = 0;            // 连续活跃时长（久坐提醒）
let lastWaterAt = Date.now() + 22 * 60 * 1000;  // 喝水提醒起点错开久坐 22 分钟

function applyToggles() {
  // 音频联动关闭时强制退出听歌状态
  if (!T.audio && state.music) state.music = false;
  // 眼睛跟随开关：关闭后视线缓动回中（眨眼不受影响）
  eyeFollowOn = T.eyeFollow !== false;
}

// 单击轮换表 + 悬停反应映射（菜单里可自定义）
function applyMotionSettings(s) {
  if (Array.isArray(s.clickCycle)) {
    const list = s.clickCycle.filter((i) => Number.isInteger(i) && i >= 0 && i < FORM_FILES.length);
    CLICK_CYCLE = list.length ? list : [0];
  }
  const h = s.hover || {};
  const pick = (v, dflt) => (Number.isInteger(v) ? Math.max(-2, Math.min(FORM_FILES.length - 1, v)) : dflt);
  hoverMap = { head: pick(h.head, 5), hand: pick(h.hand, 2) };
}

if (window.petAPI) {
  window.petAPI.onEnvIdle((sec) => {
    state.idleSec = sec;
    // 久坐统计：5 秒内有输入视为活跃；离开超过 5 分钟视为休息过了
    if (sec <= 5) { activeMs += 5000; state.lockSleep = false; }
    else if (sec >= 300) activeMs = 0;
  });
  window.petAPI.onEnvPower((onBattery) => {
    showBubble(eventLine(onBattery ? 'batteryOff' : 'batteryOn'));
  });
  // 原生音频助手：任何输出设备出声/静音（带 0.5s 滞回，主进程判定）
  window.petAPI.onHelperAudio((data) => {
    if (!T.audio) return;
    if (state.music !== data.music) {
      console.log('[helper-audio] music=' + data.music + ' peak=' + data.peak);
    }
    state.music = data.music;
  });

  // 音乐节拍：跟着晃一下（跑动 / 睡觉 / 专注安静时不晃）
  let grooveTimer = null;
  if (window.petAPI.onBeat) {
    window.petAPI.onBeat(() => {
      if (T.groove === false || isRunning || isQuietFocus()) return;
      if (document.body.classList.contains('sleeping') || document.body.classList.contains('running')) return;
      document.body.classList.remove('groove');
      void document.body.offsetWidth;
      document.body.classList.add('groove');
      clearTimeout(grooveTimer);
      grooveTimer = setTimeout(() => document.body.classList.remove('groove'), 380);
    });
  }

  // 打字模仿：跟着你的键盘/鼠标节奏轻点（睡着、专注、跑动时不打扰）
  let typingTimer = null;
  if (window.petAPI.onInputActivity) {
    window.petAPI.onInputActivity(() => {
      if (T.typing === false) return;
      if (document.body.classList.contains('sleeping') || isRunning || isQuietFocus()) return;
      document.body.classList.add('typing');
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => document.body.classList.remove('typing'), 700);
    });
  }

  // 锁屏 / 解锁：回来打个招呼，顺手把睡觉状态叫醒
  if (window.petAPI.onEnvUnlock) {
    window.petAPI.onEnvUnlock(() => {
      const wasSleeping = document.body.classList.contains('sleeping');
      document.body.classList.remove('sleeping');
      state.lockSleep = false;
      state.idleSec = 0;   // 人回来了：不解零的话下一轮自动状态机会立刻又睡回去
      walkRestEnd = 0; walkPhaseEnd = 0;
      if (state.autoMode === 'sleep') state.autoMode = 'idle';   // 听歌形态保持，音乐停了自然会退出
      state.lastSwitch = Date.now();
      state.manualUntil = 0;
      if (wasSleeping) showBubble(eventLine('wake'));   // 睡着的按"醒来"打招呼
      else showBubble(eventLine('unlock'));
      doHop();
    });
  }
  if (window.petAPI.onEnvLock) {
    window.petAPI.onEnvLock(() => {
      // 锁屏等于离开：把空闲计时推满，避免解锁瞬间乱切形态
      state.idleSec = Math.max(state.idleSec, idleSleepSec > 0 ? idleSleepSec : 600);
      // 「锁屏时也睡觉」：听歌形态上直接挂 Zzz 继续睡，别的形态换成睡姿
      if (sleepOnLock && state.autoMode !== 'sleep') {
        stopWalkNow();
        state.lockSleep = true;
        state.lastSwitch = Date.now();
        if (state.autoMode === 'music') {
          document.body.classList.add('sleeping');
        } else {
          state.autoMode = 'sleep';
          setFormVisual(0);
          document.body.classList.remove('music');
          document.body.classList.add('sleeping');
        }
      }
    });
  }

  // 顶边栖息：窗口被贴到屏幕顶 → 翻转挂住（气泡改到下方，走路暂停）
  if (window.petAPI.onPerch) {
    window.petAPI.onPerch((on) => {
      document.body.classList.toggle('perch', on);
      if (on) {
        state.walking = false;
        document.body.classList.remove('walking');
        document.body.classList.add('perch-pop');
        setTimeout(() => document.body.classList.remove('perch-pop'), 600);
      }
      // 进出栖息后宠物在窗口里的位置变了，重新上报尺寸
      setTimeout(reportMetrics, 120);
      setTimeout(reportMetrics, 400);
    });
  }

  // 躲猫猫：主进程把宠物挪开了，这里补一个受惊的压缩动画
  if (window.petAPI.onDodge) {
    window.petAPI.onDodge(() => {
      document.body.classList.remove('dodge');
      void document.body.offsetWidth;
      document.body.classList.add('dodge');
      setTimeout(() => document.body.classList.remove('dodge'), 320);
    });
  }

  // 设置同步（缩放 / 开关）
  window.petAPI.onSettings((s) => {
    scaleMul = [80, 110, 160][s.scaleIdx] / 110;
    T = Object.assign({}, T, s.toggles || {});
    if (s.pomodoro) pomoDur = Object.assign({}, pomoDur, s.pomodoro);
    if (typeof s.dblclick === 'string' && s.dblclick) dblAct = s.dblclick;
    if (typeof s.clickAction === 'string' && s.clickAction) clickAct = s.clickAction;
    applyIdleSetting(s);
    applyLinesSetting(s.lines);
    applyEventLinesSetting(s.eventLines);
    applyMotionSettings(s);
    applyToggles();
    applyFormWidth(currentIdx);
  });
  // 启动时先拉一次设置（不等广播）
  const s0 = window.petAPI.getSettings();
  if (s0) {
    scaleMul = [80, 110, 160][s0.scaleIdx] / 110;
    T = Object.assign({}, T, s0.toggles || {});
    if (s0.pomodoro) pomoDur = Object.assign({}, pomoDur, s0.pomodoro);
    if (typeof s0.dblclick === 'string' && s0.dblclick) dblAct = s0.dblclick;
    if (typeof s0.clickAction === 'string' && s0.clickAction) clickAct = s0.clickAction;
    applyIdleSetting(s0);
    applyLinesSetting(s0.lines);
    applyEventLinesSetting(s0.eventLines);
    applyMotionSettings(s0);
    applyToggles();
    applyFormWidth(currentIdx);
  }
  window.petAPI.onSetScale((idx) => {
    scaleMul = [80, 110, 160][idx] / 110;
    applyFormWidth(currentIdx);
  });

  // ---------- 久坐提醒 ----------
  setInterval(() => {
    if (!T.sedentary) { activeMs = 0; return; }
    if (activeMs >= 45 * 60 * 1000) {
      activeMs = 0;
      showBubble(eventLine('sedentary'));
      document.body.classList.remove('hop');
      void document.body.offsetWidth;
      document.body.classList.add('hop');
    }
  }, 5000);

  // ---------- 喝水提醒 ----------
  setInterval(() => {
    if (!T.water) return;
    if (Date.now() - lastWaterAt >= 45 * 60 * 1000 && state.idleSec < 120) {
      lastWaterAt = Date.now();
      showBubble(eventLine('water'));
    }
  }, 60 * 1000);

  // ---------- 番茄钟（pomo / pomoDur 已在顶层声明，点击台词需要读取） ----------
  function pomoStop(silent) {
    pomo.running = false;
    pomo.phase = null;
    window.petAPI.pomodoroState({ running: false });
    if (!silent) showBubble(eventLine('pomoStop'));
  }
  window.petAPI.onPomodoroCmd((cmd) => {
    if (cmd === 'start' && !pomo.running) {
      pomo.running = true;
      pomo.phase = 'focus';
      pomo.cycles = 0;
      pomo.endsAt = Date.now() + pomoDur.focus * 60 * 1000;
      pomo.warned1 = pomo.warned10 = false;
      window.petAPI.pomodoroState({ running: true });
      showBubble(eventLine('pomoStart'));
    } else if (cmd === 'stop') {
      pomoStop(false);
    }
  });
  setInterval(() => {
    if (!pomo.running) return;
    const remain = pomo.endsAt - Date.now();
    if (remain <= 0) {
      if (pomo.phase === 'focus') {
        pomo.cycles++;
        window.petAPI.pomodoroDone(pomoDur.focus);   // 上报主进程：今日番茄 +1、专注分钟数、连续天数
        const long = pomo.cycles % 4 === 0;
        pomo.phase = long ? 'long' : 'break';
        pomo.endsAt = Date.now() + (long ? pomoDur.long : pomoDur.break) * 60 * 1000;
        showBubble(eventLine(long ? 'pomoLong' : 'pomoBreak'));
        document.body.classList.remove('hop');
        void document.body.offsetWidth;
        document.body.classList.add('hop');
      } else {
        pomo.phase = 'focus';
        pomo.endsAt = Date.now() + pomoDur.focus * 60 * 1000;
        pomo.warned1 = pomo.warned10 = false;
        showBubble(eventLine('pomoResume'));
      }
      pomo.warned1 = pomo.warned10 = false;
      return;
    }
    if (remain <= 10 * 1000 && !pomo.warned10) {
      pomo.warned10 = true;
      showBubble(eventLine('pomoWarn10'));
    } else if (remain <= 60 * 1000 && !pomo.warned1) {
      pomo.warned1 = true;
      showBubble(eventLine('pomoWarn1'));
    }
  }, 1000);

  // ---------- 待办到点（台词可在「待办 → 台词设置」里改） ----------
  window.petAPI.onShowReminder((payload) => {
    // 兼容老版本只传字符串
    const kind = payload && payload.kind ? payload.kind : 'due';
    const text = typeof payload === 'string' ? payload : ((payload && payload.text) || '');
    const line = eventLine(kind === 'soon' ? 'reminderSoon' : 'reminder', { text });
    if (line) showBubble(line);   // 用户把这条台词删空 = 不出气泡，但仍跳一下提醒
    document.body.classList.remove('hop');
    void document.body.offsetWidth;
    document.body.classList.add('hop');
  });

  // ---------- 念待办 ----------
  if (window.petAPI.onTodoSay) {
    window.petAPI.onTodoSay((d) => {
      const line = !d || !d.count
        ? eventLine('todoAllDone')
        : eventLine('todoSay', { list: (d && d.list) || '', more: (d && d.more) || '' });
      showBubble(line);
    });
  }

  // ---------- 待办勾完成：桌宠跳一下说句话（台词可自定义） ----------
  if (window.petAPI.onTodoDone) {
    window.petAPI.onTodoDone((left) => {
      const line = left > 0
        ? eventLine('todoDone', { left: `还有 ${left} 件等着你` })
        : eventLine('todoAllDone');
      showBubble(line);
      document.body.classList.remove('hop');
      void document.body.offsetWidth;
      document.body.classList.add('hop');
    });
  }

  // ---------- 通用提示（如发现新版本），不打断动作 ----------
  if (window.petAPI.onNotice) {
    window.petAPI.onNotice((text) => { showBubble(text); });
  }
}

// ---------- 整点报时（睡觉时不打扰） ----------
let lastHour = new Date().getHours();
setInterval(() => {
  const h = new Date().getHours();
  if (h !== lastHour) {
    lastHour = h;
    if (!document.body.classList.contains('sleeping') && !isQuietFocus()) {
      showBubble(eventLine('hourly', { h }));
    }
  }
}, 30 * 1000);

// ---------- 系统音频监听（已改由原生助手进程 audio_watch.py 提供，Chromium 回环流仅作后备） ----------
const ENABLE_AUDIO = false;
let audioStream = null;    // 当前回环流，设备切换时需要重建
let audioLoopTimer = null; // 分析循环，重建时清掉旧的避免双循环打架
let audioCtx = null;       // AudioContext，重建时关闭旧的
async function watchAudio() {
  try {
    if (!window.petAPI) return; // 浏览器预览时跳过
    // 必须先取一个屏幕源 ID，直接用 chromeMediaSource:'desktop' 会导致渲染进程崩溃
    const sourceId = await window.petAPI.getScreenSource();
    if (!sourceId) {
      console.warn('未获取到屏幕源，听歌联动未启用');
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId }
      },
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxFrameRate: 1
        }
      }
    });
    // 只留音频轨做分析，视频轨立即停掉省资源
    stream.getVideoTracks().forEach((t) => t.stop());
    audioStream = stream;
    const ctx = new AudioContext();
    if (audioCtx && audioCtx !== ctx) audioCtx.close().catch(() => {});
    audioCtx = ctx;
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);

    const buf = new Float32Array(analyser.fftSize);
    const RMS_ON = 0.004, RMS_OFF = 0.002;  // 滞回阈值（实测底噪≈0.0000-0.0009，正常播放≈0.010+）
    const TICK = 100;              // 采样间隔 100ms
    const SWITCH_MS = 500;         // 出声/静音持续 0.5s 即切换
    let loudStreak = 0, quietStreak = 0;
    let tick = 0;
    let windowMax = 0;             // 诊断：报告周期内的峰值能量

    clearInterval(audioLoopTimer);
    audioLoopTimer = setInterval(() => {
      // AudioContext 若被自动播放策略挂起，持续尝试恢复
      if (ctx.state === 'suspended') ctx.resume();
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      if (rms > windowMax) windowMax = rms;

      loudStreak = rms > RMS_ON ? loudStreak + TICK : 0;
      quietStreak = rms < RMS_OFF ? quietStreak + TICK : 0;
      if (loudStreak >= SWITCH_MS) state.music = true;
      if (quietStreak >= SWITCH_MS) state.music = false;

      // 诊断日志：每 10 秒报一次窗口峰值；连续静音窗口计数供看门狗使用
      if (++tick % 100 === 0) {
        console.log(`[audio] peak10s=${windowMax.toFixed(4)} last=${rms.toFixed(4)} music=${state.music}`);
        silentWindows = windowMax === 0 ? silentWindows + 1 : 0;
        windowMax = 0;
      }
    }, TICK);
  } catch (err) {
    console.warn('系统音频采集不可用，听歌联动未启用', err);
  }
}

// 看门狗：连续 3 分钟绝对静音（每 10s 窗口峰值恒为 0）→ 回环流大概率失效（默认输出设备变更未触发事件）→ 自动重建
let silentWindows = 0;
setInterval(() => {
  if (silentWindows >= 18) {
    silentWindows = 0;
    console.log('[audio] 连续 3 分钟绝对静音，自动重建采集');
    rebuildAudio();
  }
}, 30000);

function teardownAudio() {
  if (audioLoopTimer) { clearInterval(audioLoopTimer); audioLoopTimer = null; }
  if (audioStream) { audioStream.getTracks().forEach((t) => t.stop()); audioStream = null; }
  if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
}
function rebuildAudio() {
  teardownAudio();
  watchAudio();
}

if (ENABLE_AUDIO) {
  watchAudio();
  // 输出设备切换（插拔耳机、连接蓝牙）时，回环流会失效 → 自动重建采集
  let restarting = false;
  navigator.mediaDevices.addEventListener('devicechange', () => {
    if (restarting) return;
    restarting = true;
    setTimeout(() => {
      try {
        rebuildAudio();
        console.log('[audio] 输出设备变化，已重新采集系统音频');
      } finally {
        restarting = false;
      }
    }, 800); // 等设备切换稳定
  });
}

// ---------- 网络状态 ----------
window.addEventListener('offline', () => showBubble(eventLine('netOffline')));
window.addEventListener('online', () => showBubble(eventLine('netOnline')));

// ---------- 睡觉 Zzz 粒子 ----------
setInterval(() => {
  if (!document.body.classList.contains('sleeping')) return;
  const z = document.createElement('span');
  z.className = 'zzz';
  z.textContent = 'Z';
  z.style.left = (55 + Math.random() * 30) + '%';
  document.body.appendChild(z);
  setTimeout(() => z.remove(), 3000);
}, 1500);

// ---------- 状态角标：头顶小胶囊（💤 睡觉 / 🎧 听歌 / ⏱ 专注 / ☕ 休息 / 🚶 散步） ----------
(function () {
  const badgeEl = document.getElementById('badge');
  if (!badgeEl) return;
  let cur = '';
  function badgeNow() {
    if (document.body.classList.contains('sleeping')) return '💤';
    if (document.body.classList.contains('music')) return '🎧';
    if (pomo.running) return pomo.phase === 'focus' ? '⏱' : '☕';
    if (state.walking) return '🚶';
    return '';
  }
  setInterval(() => {
    const t = badgeNow();
    if (t === cur) return;
    const wasShown = cur !== '';
    cur = t;
    if (!t) { badgeEl.classList.remove('show'); return; }
    badgeEl.textContent = t;
    badgeEl.classList.add('show');
    if (wasShown) {   // 状态切换时小弹跳一下
      badgeEl.classList.remove('pop');
      void badgeEl.offsetWidth;
      badgeEl.classList.add('pop');
    }
  }, 400);
})();

// ---------- 好感度：爱心粒子 + 升级庆祝 ----------
(function () {
  function spawnHearts(n, big) {
    for (let i = 0; i < n; i++) {
      const h = document.createElement('span');
      h.className = 'aff-heart' + (big ? ' big' : '');
      h.textContent = Math.random() < 0.3 ? '♥' : '♡';
      h.style.left = (38 + Math.random() * 34) + '%';
      h.style.animationDelay = (i * 0.12) + 's';
      document.body.appendChild(h);
      setTimeout(() => h.remove(), 2200 + i * 120);
    }
  }
  if (window.petAPI && window.petAPI.onAffection) {
    window.petAPI.onAffection((a) => {
      spawnHearts(a.leveled ? 8 : 1, a.leveled);
      if (a.leveled) {
        showBubble(eventLine('levelUp', { lv: a.level + 1, lvName: a.lvName }));
        document.body.classList.remove('hop');
        void document.body.offsetWidth;
        document.body.classList.add('hop');
      }
    });
  }
})();
