const { app, BrowserWindow, ipcMain, Menu, Tray, screen, powerMonitor, nativeImage, globalShortcut, shell, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');

let win = null;
let tray = null;
let reminderWin = null;

// 兜底：桌宠是长期挂在桌面的常驻程序，任何单次未捕获异常都不应该弹 Error 框杀掉进程
process.on('uncaughtException', (err) => {
  try { console.error('[main] uncaught:', err); } catch (_) {}
});
process.on('unhandledRejection', (err) => {
  try { console.error('[main] unhandledRejection:', err); } catch (_) {}
});

// 形态列表（与 pet.js 中 FORM_FILES / FORM_LINES 顺序保持一致）
const FORMS = [
  { label: '待机', file: 'assets/juju-idle.png' },
  { label: '站立', file: 'assets/form-stand.png' },
  { label: '抱抱', file: 'assets/form-hug.png' },
  { label: '听歌', file: 'assets/form-music.png' },
  { label: '生日', file: 'assets/form-birth.png' },
  { label: '微笑', file: 'assets/form-mbti.png' }
];
let currentForm = 0;

// 各形态默认台词（用户可在"编辑台词…"里增删改；删除后保存空数组即不再说话）
const DEFAULT_LINES = [
  ['啾~（Juju 安宁~）'],
  ['站得直直的！'],
  ['抱抱…'],
  ['总是戴着耳机听歌（其实一直在放歌）'],
  ['今天是生日吗？？？？'],
  ['ISFJ 微笑服务中']
];

// 三档整体缩放：宠物显示宽度基准（中档=当前 110px）
const SCALES = [
  { label: '小 (80px)', petW: 80 },
  { label: '中 (110px)', petW: 110 },
  { label: '大 (160px)', petW: 160 }
];
const SCALE_BASE = 110;

// ---------- 关于 / 更新 / 联系 ----------
const REPO = 'uuno-123/JJUUILIEN-desktop-pet';
const LINKS = {
  home: 'https://uuno-123.github.io/JJUUILIEN-desktop-pet/',
  latest: `https://github.com/${REPO}/releases/latest`,
  releases: `https://github.com/${REPO}/releases`,
  issues: `https://github.com/${REPO}/issues`,
  repo: `https://github.com/${REPO}`,
  threads: 'https://www.threads.net/@netis.go'
};
const APP_VERSION = app.getVersion();

// ---------- 设置持久化 ----------
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const CYCLE_DEFAULT = [0, 1, 2, 4, 5];   // 单击轮换默认：待机/站立/抱抱/生日/微笑（听歌归音频联动）
const defaults = {
  x: null, y: null,
  scaleIdx: 1,
  form: 0,
  toggles: {
    audio: true, sleep: true, walk: true, sedentary: true, water: true, hotkey: true,
    followMouse: false, eyeFollow: true,
    quietFullscreen: true,   // 全屏看视频/玩游戏时自动隐身
    focusQuiet: true,        // 番茄钟专注阶段保持安静（不散步、不报时、不闲聊）
    groove: true,            // 跟着音乐节拍晃动
    starDrop: true,          // 偶尔掉落小星星，跑过去捡
    hideAndSeek: true        // 光标突然冲过来时闪开（躲猫猫）
  },
  hover: { head: 5, hand: 2 },        // 悬停反应：head/hand → 目标形态索引；-1 只动效+台词；-2 无反应
  idle: {
    sleepMin: 10,           // 无操作多少分钟入睡（0 = 从不）
    walkMin: 3,             // 无操作多少分钟开始散步（0 = 从不）
    walkMode: 'continuous', // continuous 一直来回逛 | occasion 走一段歇一段
    sleepOnLock: true       // 锁屏时也当作睡着（解锁时说「醒来」）
  },
  clickCycle: CYCLE_DEFAULT.slice(),  // 单击轮换的形态，用户可在「单击动作 → 编辑轮换队列…」里自由增删
  reminders: [],         // 待办：[{id, text, due, day, done, createdAt, doneAt, notified}]（due=0 不提醒；day=所属那一天 0 点，用于区分今日/往期）
  pomodoro: { focus: 25, break: 5, long: 15 },  // 番茄钟时长（分钟）
  dblclick: 'pat',       // 双击动作：见 PET_ACTIONS
  clickAction: 'todo',   // 单击动作：默认打开今日待办清单（可在菜单里改派任意动作）
  lines: {},             // 每形态自定义台词 { [formIdx]: [台词, ...] }
  eventLines: {},        // 系统事件自定义台词 { [事件key]: [台词, ...] }（空/缺失 = 用内置默认）
  stats: { date: '', tomatoes: 0, focusMin: 0, streak: 0, lastFocusDate: '', stars: 0, pats: 0 },
  lastUpdateCheck: 0,                 // 上次自动检查更新的时间戳（24h 内不重复检查）
  skipVersion: ''                     // 用户点了「以后再说」的版本，该版本不再弹提示
};
let settings = JSON.parse(JSON.stringify(defaults));
let cycleMigrated = false;   // 队列默认值迁移过 → 启动后落盘一次
let clickMigrated = false;   // 单击默认动作迁移到「待办清单」→ 落盘一次
try {
  const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  settings = Object.assign(defaults, s);
  settings.toggles = Object.assign({}, defaults.toggles, s.toggles || {});
  settings.pomodoro = Object.assign({}, defaults.pomodoro, s.pomodoro || {});
  if (!Array.isArray(settings.reminders)) settings.reminders = [];
  settings.stats = Object.assign({}, defaults.stats, s.stats || {});
  // 悬停反应映射 & 单击轮换表：老配置文件没有这两项时补默认
  settings.hover = Object.assign({ head: 5, hand: 2 }, s.hover || {});
  settings.idle = Object.assign({}, defaults.idle, s.idle || {});
  // 老版本只有 toggles.sleep / toggles.walk 两个开关 → 迁移成分钟数（关 = 0）
  if (!s.idle) {
    if (s.toggles && s.toggles.sleep === false) settings.idle.sleepMin = 0;
    if (s.toggles && s.toggles.walk === false) settings.idle.walkMin = 0;
  }
  if (!Array.isArray(settings.clickCycle) || !settings.clickCycle.length) {
    settings.clickCycle = CYCLE_DEFAULT.slice();
  }
  // 迁移：v1.2.0 测试版曾把默认队列写成 [0,1,4]，没手动改过的恢复成默认 5 形态
  if (!settings.cycleMigrated && settings.clickCycle.join() === '0,1,4') {
    settings.clickCycle = CYCLE_DEFAULT.slice();
    cycleMigrated = true;
  }
  settings.cycleMigrated = true;
  // 迁移：单击默认动作改为「打开今日待办」（v1.2.0），没手动改过的旧配置一起换过来
  if (!settings.clickMigrated) {
    if (!settings.clickAction || settings.clickAction === 'cycle') { settings.clickAction = 'todo'; clickMigrated = true; }
    settings.clickMigrated = true;
  }
} catch (_) { /* 首次运行 */ }
// 台词：缺失的形态补默认示例（用户删空的形态保留为 []，不重新填充）
for (let i = 0; i < FORMS.length; i++) {
  if (!Array.isArray(settings.lines[i])) settings.lines[i] = DEFAULT_LINES[i].slice();
}
// 清理历史版本混入台词的乱码字符「쮝」（旧默认台词批量替换事故，一次性迁移）
let mojiCleaned = false;
const cleanLine = (t) => String(t).replace(/쮝/g, '').replace(/[ \u3000]+([，。！～…）])/g, '$1');
for (const key of ['lines', 'eventLines']) {
  const obj = settings[key];
  if (!obj || typeof obj !== 'object') continue;
  for (const k of Object.keys(obj)) {
    if (!Array.isArray(obj[k])) continue;
    const before = obj[k].join('\u0001');
    const after = obj[k].map(cleanLine).filter((t) => t.trim());
    if (after.join('\u0001') !== before) { obj[k] = after; mojiCleaned = true; }
  }
}
const todoShaped = ensureTodoShape();   // 老待办补 id/done 字段
if (cycleMigrated || clickMigrated || mojiCleaned || todoShaped) saveSettings();   // 迁移结果落盘（函数声明可提升，此处调用安全）

function saveSettings() {
  try { fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2)); } catch (e) { console.warn('保存设置失败', e); }
}
function broadcastSettings() {
  if (win) win.webContents.send('settings', settings);
}

// ---------- 缩放换算 ----------
function scaleMul() { return SCALES[settings.scaleIdx].petW / SCALE_BASE; }
function windowSize() {
  const m = scaleMul();
  return { w: Math.round(320 * m) + 20, h: Math.round(250 * m) + 30 };
}

// 部分机器/远程环境下 GPU 进程不可用，禁用硬件加速改用软件渲染
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('no-sandbox');
// 允许 AudioContext 在无用户手势时运行（音频检测必需）
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// 单实例：重复启动时唤出已有宠物
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }
app.on('second-instance', () => {
  if (win) { win.show(); win.focus(); }
});

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const size = windowSize();

  let x = settings.x, y = settings.y;
  if (x == null || y == null) {
    x = workArea.x + workArea.width - size.w - 20;
    y = workArea.y + workArea.height - size.h - 10;
  } else {
    // 兜底：上次保存的位置若在屏幕外（异常退出/分辨率变化），拉回工作区内（允许探头一半）
    const { minX, maxX } = petHBounds(workArea, size.w);
    if (x < minX) x = minX;
    if (x > maxX) x = maxX;
    if (y < workArea.y) y = workArea.y;
    if (y + size.h > workArea.y + workArea.height) y = workArea.y + workArea.height - size.h;
    x = Math.round(x); y = Math.round(y);
  }

  win = new BrowserWindow({
    width: size.w,
    height: size.h,
    x, y,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // 保证永远压在大多数窗口之上
  win.setAlwaysOnTop(true, 'screen-saver');
  // 允许渲染进程采集系统音频（桌面回环），用于"播放音乐时戴耳机"
  win.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media');
  });
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[renderer] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.log('[renderer gone]', JSON.stringify(details));
    if (details.reason !== 'clean-exit' && win) {
      setTimeout(() => { if (win) win.loadFile('index.html'); }, 1000);
    }
  });
  win.on('moved', savePos);
  win.loadFile('index.html');
  win.setIgnoreMouseEvents(true, { forward: true });
  startCursorWatch();

  win.on('closed', () => { win = null; });
}

let savePosTimer = null;
function savePos() {
  if (!win) return;
  clearTimeout(savePosTimer);
  savePosTimer = setTimeout(() => {
    if (!win) return;
    const [x, y] = win.getPosition();
    settings.x = x; settings.y = y;
    saveSettings();
  }, 500);
}

// ---------- 拖拽 / 惯性 / 吸附 / 散步 ----------
let glideTimer = null;
let walkTimer = null;
let walkDir = 1;

function stopGlide() { if (glideTimer) { clearInterval(glideTimer); glideTimer = null; } }
function stopWalk() { if (walkTimer) { clearInterval(walkTimer); walkTimer = null; } }

// 宠物实际视觉宽度（渲染层按形态上报），吸附/夹取以宠物本体为基准
let petVisualW = 110;
ipcMain.on('pet-width', (_e, w) => {
  const v = Number(w);
  if (v > 40 && v < 400) petVisualW = v;
});

// 以宠物本体为基准的水平夹取范围：允许本体最多一半伸出屏幕外（探头效果），但永不完全消失
function petHBounds(workArea, ww) {
  const pw = Math.min(petVisualW, ww);
  const off = (ww - pw) / 2;
  return {
    off,
    minX: workArea.x - off - pw / 2,                          // 左半藏出屏幕
    maxX: workArea.x + workArea.width + off + pw / 2 - ww     // 右半藏出屏幕
  };
}

// 把窗口夹回工作区，并做边缘吸附（吸附以"宠物本体"为基准，透明边距允许伸出屏幕）
function snapWindow() {
  if (!win) return;
  const { workArea } = screen.getPrimaryDisplay();
  const [wx, wy] = win.getPosition();
  const [ww, wh] = win.getSize();
  const { off, minX, maxX } = petHBounds(workArea, ww);
  let x = wx, y = wy;

  // 边界夹取：宠物本体最多一半探出屏幕左右边缘，上下完整保留
  if (x < minX) x = minX;
  if (x > maxX) x = maxX;
  if (y < workArea.y) y = workArea.y;
  if (y + wh > workArea.y + workArea.height) y = workArea.y + workArea.height - wh;

  // 边缘吸附：宠物本体距屏幕左右边缘 <28px 时，让宠物精确贴住边缘
  const petLeft = x + off, petRight = x + ww - off;
  if (Math.abs(petRight - (workArea.x + workArea.width)) < 28) x = workArea.x + workArea.width - ww + off;
  else if (Math.abs(petLeft - workArea.x) < 28) x = workArea.x - off;

  x = Math.round(x); y = Math.round(y);
  if (x !== wx || y !== wy) win.setPosition(x, y);
  savePos();
}

// 点击穿透开关：鼠标悬停在宠物/气泡上时可交互，其余区域穿透
// （v1.0 重写时丢失过该处理器，导致窗口永远穿透无法选中）
ipcMain.on('set-clickable', (_e, flag) => {
  if (!win) return;
  win.setIgnoreMouseEvents(!flag, { forward: true });
});

ipcMain.on('move-window', (_e, dx, dy) => {
  if (!win) return;
  stopGlide();  // 拖拽接管，取消滑行
  lastDragAt = Date.now();   // 拖拽期间暂停「跟着鼠标跑」
  const [x, y] = win.getPosition();
  win.setPosition(x + Math.round(dx), y + Math.round(dy));
});

// 甩出惯性：vx/vy 为 px/ms
ipcMain.on('fling', (_e, vx, vy) => {
  if (!win) return;
  stopGlide();
  stopWalk();
  lastDragAt = Date.now();   // 甩出滑行期间暂停跟随，滑行结束前不抢控制权
  vx = Math.max(-2.5, Math.min(2.5, vx || 0));
  vy = Math.max(-2.5, Math.min(2.5, vy || 0));
  // 甩动方向意图明显时，抹平另一轴的分量（人手横向甩常带向下小弧度，会导致斜着下坠）
  if (Math.abs(vx) > Math.abs(vy) * 1.5) vy = 0;
  else if (Math.abs(vy) > Math.abs(vx) * 1.5) vx = 0;
  if (Math.abs(vx) < 0.05 && Math.abs(vy) < 0.05) { snapWindow(); return; }

  let last = Date.now();
  glideTimer = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(32, now - last);
    last = now;
    const [x, y] = win.getPosition();
    let nx = x + vx * dt;
    let ny = y + vy * dt;

    // 摩擦减速
    const f = Math.pow(0.995, dt);
    vx *= f; vy *= f;

    // 边界约束以"宠物本体"为基准（允许探头一半出屏），碰到夹取边界原位反弹
    const { workArea } = screen.getPrimaryDisplay();
    const [ww, wh] = win.getSize();
    const { off, minX, maxX } = petHBounds(workArea, ww);
    if (nx < minX) { nx = minX; vx = -vx * 0.4; }
    if (nx > maxX) { nx = maxX; vx = -vx * 0.4; }
    if (ny < workArea.y) { ny = workArea.y; vy = -vy * 0.4; }
    if (ny + wh > workArea.y + workArea.height) { ny = workArea.y + workArea.height - wh; vy = -vy * 0.4; }

    win.setPosition(Math.round(nx), Math.round(ny));
    if (Math.abs(vx) < 0.03 && Math.abs(vy) < 0.03) {
      stopGlide();
      snapWindow();
    }
  }, 16);
});

// 自行散步（渲染层判断时机，主进程执行移动）
ipcMain.on('walk-start', () => {
  if (!win || walkTimer) return;
  if (settings.toggles.followMouse) return;   // 跟随模式优先，不自行散步
  stopGlide();
  walkDir = Math.random() < 0.5 ? -1 : 1;
  if (win) win.webContents.send('walk-dir', walkDir);
  walkTimer = setInterval(() => {
    if (!win) { stopWalk(); return; }
    const { workArea } = screen.getPrimaryDisplay();
    const [x, y] = win.getPosition();
    const [ww] = win.getSize();
    const { minX, maxX } = petHBounds(workArea, ww);
    let nx = x + walkDir * 0.7;
    if (nx <= minX) { nx = minX; walkDir = 1; if (win) win.webContents.send('walk-dir', 1); }
    if (nx >= maxX) { nx = maxX; walkDir = -1; if (win) win.webContents.send('walk-dir', -1); }
    win.setPosition(Math.round(nx), y);
  }, 60);
});
ipcMain.on('walk-stop', () => {
  if (walkTimer) { stopWalk(); savePos(); }
});

// ---------- 节拍检测（驱动音乐律动） ----------
// 助手每 100ms 报一次峰值；相对"基线"突然抬高即视为一拍，带 200ms 冷却防连击
let beatBase = 0.01;
let lastBeatSent = 0;
function detectBeat(v) {
  if (settings.toggles.groove === false) return;
  beatBase = beatBase * 0.97 + v * 0.03;
  const now = Date.now();
  if (v > Math.max(0.018, beatBase * 1.5) && now - lastBeatSent > 200) {
    lastBeatSent = now;
    if (win && !win.isDestroyed()) win.webContents.send('beat', v);
  }
}

// ---------- 形态 / 大小 ----------
function setForm(idx) {
  currentForm = idx;
  settings.form = idx;
  saveSettings();
  if (win) win.webContents.send('set-form', idx);
}

ipcMain.on('select-form', (_e, idx) => setForm(idx));
ipcMain.on('sync-form', (_e, idx) => { currentForm = idx; });

function setScale(idx) {
  settings.scaleIdx = Math.max(0, Math.min(2, idx));
  saveSettings();
  if (!win) { buildTrayMenu(); return; }
  const size = windowSize();
  const [x, y] = win.getPosition();
  win.setBounds({ x, y, width: size.w, height: size.h });
  snapWindow();
  win.webContents.send('set-scale', settings.scaleIdx);
  broadcastSettings();
  buildTrayMenu(); // 重建单选勾选
}
ipcMain.on('set-scale', (_e, idx) => setScale(idx));

// ---------- 功能开关 ----------
ipcMain.on('toggle-setting', (_e, key) => {
  if (!(key in settings.toggles)) return;
  settings.toggles[key] = !settings.toggles[key];
  saveSettings();
  broadcastSettings();
  buildTrayMenu();
});

ipcMain.on('get-settings', (e) => { e.returnValue = settings; });

// ---------- 番茄钟（渲染层计时，菜单触发） ----------
ipcMain.on('pomodoro-cmd', (_e, cmd) => {
  if (win) win.webContents.send('pomodoro-cmd', cmd);
});
ipcMain.on('pomodoro-state', (_e, st) => { pomodoroRunning = st.running; buildTrayMenu(); });
let pomodoroRunning = false;

// ---------- 待办清单（今日 Todolist 面板） ----------
let todoWin = null;
const newTodoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
// 用 function 声明（启动时第 144 行 ensureTodoShape() 会提前调用，箭头函数常量有暂时性死区）
function dayStartOf(ts) {
  const d = new Date(Number(ts) || Date.now());
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function todayStart() { return dayStartOf(Date.now()); }

// 老数据只有 {text, due} → 补齐 id / done / createdAt / notified / day
function ensureTodoShape() {
  let changed = false;
  const kept = [];
  for (const r of settings.reminders) {
    if (!r || typeof r.text !== 'string') { changed = true; continue; }
    if (!r.id) { r.id = newTodoId(); changed = true; }
    if (typeof r.done !== 'boolean') { r.done = false; changed = true; }
    if (typeof r.due !== 'number') { r.due = Number(r.due) || 0; changed = true; }
    if (!r.createdAt) { r.createdAt = r.due || Date.now(); changed = true; }
    if (typeof r.notified !== 'boolean') { r.notified = false; changed = true; }
    // day：这条待办算哪一天的事（有提醒时间就跟提醒走，否则跟创建时间）
    if (typeof r.day !== 'number' || !r.day) {
      r.day = dayStartOf(r.due || r.createdAt);
      changed = true;
    }
    kept.push(r);
  }
  if (kept.length !== settings.reminders.length) { settings.reminders = kept; changed = true; }
  return changed;
}

function pushTodo() {
  if (todoWin && !todoWin.isDestroyed()) todoWin.webContents.send('todo-data', { items: settings.reminders });
}

const TODO_MIN_W = 330, TODO_MIN_H = 440, TODO_MAX_W = 900, TODO_MAX_H = 1300;

function openTodoList() {
  // 已经开着 → 再点一次收起来（单击宠物就像开关）
  if (todoWin) { todoWin.close(); return; }
  // 记住上次关窗时的位置和大小
  const saved = settings.todoBounds || {};
  let w = Math.min(Math.max(Number(saved.width) || 380, TODO_MIN_W), TODO_MAX_W);
  let h = Math.min(Math.max(Number(saved.height) || 566, TODO_MIN_H), TODO_MAX_H);
  let x, y;
  try {
    const area = screen.getPrimaryDisplay().workArea;
    if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      x = saved.x; y = saved.y;   // 上次的位置（哪怕屏变了也别飞太远，下面夹回可视区）
      x = Math.min(Math.max(x, area.x - w + 80), area.x + area.width - 80);
      y = Math.min(Math.max(y, area.y - 20), area.y + area.height - 80);
    } else {
      x = area.x + area.width - w - 44;
      y = area.y + Math.round((area.height - h) / 2);
    }
  } catch (_) {}
  todoWin = new BrowserWindow({
    width: w,
    height: h,
    x, y,
    minWidth: TODO_MIN_W,
    minHeight: TODO_MIN_H,
    maxWidth: TODO_MAX_W,
    maxHeight: TODO_MAX_H,
    frame: false,
    resizable: true,           // 允许系统级缩放（面板内还有拖拽手柄，两条路都能用）
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  todoWin.loadFile('todo.html');
  // 记住尺寸（拖完就存，不必等关窗）
  let saveTimer = null;
  const rememberBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!todoWin || todoWin.isDestroyed()) return;
      try { settings.todoBounds = todoWin.getBounds(); saveSettings(); } catch (_) {}
    }, 400);
  };
  todoWin.on('resize', rememberBounds);
  todoWin.on('move', rememberBounds);
  todoWin.on('close', () => {
    try { settings.todoBounds = todoWin.getBounds(); saveSettings(); } catch (_) {}
  });
  todoWin.on('closed', () => { todoWin = null; });
}

// 面板右/下/右下角拖拽缩放（渲染层发过来的目标尺寸）
ipcMain.on('todo-resize', (_e, w, h) => {
  if (!todoWin || todoWin.isDestroyed()) return;
  const width = Math.min(Math.max(Math.round(w), TODO_MIN_W), TODO_MAX_W);
  const height = Math.min(Math.max(Math.round(h), TODO_MIN_H), TODO_MAX_H);
  try {
    const b = todoWin.getBounds();
    if (b.width === width && b.height === height) return;   // 没变化就别折腾窗口
    todoWin.setBounds({ x: b.x, y: b.y, width, height });
  } catch (_) {}
});

ipcMain.on('todo-resize-end', () => {
  if (!todoWin || todoWin.isDestroyed()) return;
  try { settings.todoBounds = todoWin.getBounds(); saveSettings(); } catch (_) {}
});

ipcMain.on('todo-ready', () => pushTodo());
ipcMain.on('todo-add', (_e, text, due) => {
  ensureTodoShape();
  const t = String(text || '').trim().slice(0, 80);
  if (!t) return;
  const dueTs = Number(due) || 0;
  settings.reminders.push({
    id: newTodoId(),
    text: t,
    due: dueTs,
    day: dueTs ? dayStartOf(dueTs) : todayStart(),
    done: false,
    createdAt: Date.now(),
    doneAt: 0,
    // 建的时候时间就已经过了 → 不再立刻弹提醒（但时间照留，面板会显示「已到点」）
    notified: dueTs > 0 && dueTs <= Date.now(),
    warned: dueTs > 0 && dueTs <= Date.now()
  });
  saveSettings(); pushTodo(); buildTrayMenu();
});
// 编辑：改文字 / 改提醒时间（due 传 0 = 清除提醒）
ipcMain.on('todo-update', (_e, id, text, due) => {
  ensureTodoShape();
  const r = settings.reminders.find((x) => x.id === id);
  if (!r) return;
  const t = String(text || '').trim().slice(0, 80);
  if (!t) return;
  const dueTs = Number(due) || 0;
  const dueChanged = dueTs !== r.due;
  r.text = t;
  r.due = dueTs;
  if (dueTs) r.day = dayStartOf(dueTs);   // 改了提醒时间 → 归到那一天
  if (dueChanged) {
    // 改成已经过去的时间：时间保留，但别立刻弹提醒
    r.notified = dueTs > 0 && dueTs <= Date.now();
    r.warned = r.notified;
  }
  saveSettings(); pushTodo(); buildTrayMenu();
});
// 顺延：把「往期未完成」挪到今天（过期的提醒时间一并清掉，避免立刻弹窗）
ipcMain.on('todo-carry', (_e, id) => {
  ensureTodoShape();
  const r = settings.reminders.find((x) => x.id === id);
  if (!r) return;
  r.day = todayStart();
  if (r.due && r.due < Date.now()) { r.due = 0; r.warned = false; }
  r.notified = false;
  saveSettings(); pushTodo(); buildTrayMenu();
});
ipcMain.on('todo-carry-all', () => {
  ensureTodoShape();
  const today = todayStart();
  let n = 0;
  for (const r of settings.reminders) {
    if (r.done || r.day >= today) continue;
    r.day = today;
    if (r.due && r.due < Date.now()) { r.due = 0; r.warned = false; }
    r.notified = false;
    n++;
  }
  if (n) { saveSettings(); pushTodo(); buildTrayMenu(); }
});
ipcMain.on('todo-toggle', (_e, id) => {
  const r = settings.reminders.find((x) => x.id === id);
  if (!r) return;
  r.done = !r.done;
  r.doneAt = r.done ? Date.now() : 0;
  if (r.done) r.notified = true;    // 做完了就不再提醒
  else r.warned = false;
  saveSettings(); pushTodo(); buildTrayMenu();
  if (r.done) {
    const left = settings.reminders.filter((x) => !x.done).length;
    if (win) win.webContents.send('todo-done', left);
  }
});
ipcMain.on('todo-del', (_e, id) => {
  settings.reminders = settings.reminders.filter((x) => x.id !== id);
  saveSettings(); pushTodo(); buildTrayMenu();
});
ipcMain.on('todo-clear-done', () => {
  settings.reminders = settings.reminders.filter((x) => !x.done);
  saveSettings(); pushTodo(); buildTrayMenu();
});
ipcMain.on('todo-close', () => { if (todoWin) todoWin.close(); });
// 旧的「添加待办提醒…」小窗入口保留兼容，改为直接开面板
ipcMain.on('open-reminder-input', () => openTodoList());
ipcMain.on('reminder-cancel', () => { if (reminderWin) reminderWin.close(); });
ipcMain.on('reminder-delete', (_e, idx) => {
  settings.reminders.splice(idx, 1);
  saveSettings(); pushTodo(); buildTrayMenu();
});

// 到点检查：不再删掉条目，标记 notified 留在清单里（可手动勾完成）
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const r of settings.reminders) {
    if (r.done || r.notified || !r.due) continue;
    if ((r.day || 0) && r.day < todayStart()) continue;   // 往期的旧提醒不追着弹，等用户顺延
    if (r.due <= now) {
      r.notified = true;
      changed = true;
      if (win) win.webContents.send('show-reminder', { kind: 'due', text: r.text });
    } else if (!r.warned && r.due - now <= 5 * 60 * 1000) {
      r.warned = true;
      changed = true;
      if (win) win.webContents.send('show-reminder', { kind: 'soon', text: r.text });
    }
  }
  if (changed) { saveSettings(); pushTodo(); buildTrayMenu(); }
}, 20000);

// ---------- 开机自启 ----------
function isAutoStart() { return app.getLoginItemSettings().openAtLogin; }
ipcMain.on('toggle-autostart', () => {
  app.setLoginItemSettings({ openAtLogin: !isAutoStart() });
  buildTrayMenu();
});

// ---------- 番茄钟时长输入窗 ----------
const POMO_FIELD_LABEL = { focus: '专注时长', break: '短休息时长', long: '长休息时长' };
let pomoInputWin = null;
function openPomoInput(field) {
  if (pomoInputWin) { pomoInputWin.focus(); return; }
  pomoInputWin = new BrowserWindow({
    width: 280,
    height: 150,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    backgroundColor: '#fff8f2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  pomoInputWin.loadFile('pomo-input.html', { query: { field } });
  pomoInputWin.on('closed', () => { pomoInputWin = null; });
}
ipcMain.on('pomo-input-submit', (_e, field, min) => {
  if (pomoInputWin) pomoInputWin.close();
  const v = Math.round(Number(min));
  if (!POMO_FIELD_LABEL[field] || !(v >= 1 && v <= 180)) return;
  settings.pomodoro[field] = v;
  saveSettings();
  broadcastSettings();
  buildTrayMenu();
});
ipcMain.on('pomo-input-cancel', () => { if (pomoInputWin) pomoInputWin.close(); });

// ---------- 台词编辑窗 ----------
const LINES_MAX = 10;      // 每形态台词条数上限
const LINES_LEN = 60;      // 每条台词字符上限
let linesWin = null;

// 单击轮换形态设置窗（原生菜单点一下就关，多选很难用，所以单独开一扇小窗）
let cycleWin = null;
function openCycleEditor() {
  if (cycleWin) { cycleWin.focus(); return; }
  cycleWin = new BrowserWindow({
    width: 340,
    height: 560,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    backgroundColor: '#fff8f2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  cycleWin.loadFile('cycle-editor.html');
  cycleWin.on('closed', () => { cycleWin = null; });
}
ipcMain.on('cycle-submit', (_e, list) => {
  if (cycleWin) cycleWin.close();
  if (!Array.isArray(list)) return;
  const clean = FORMS.map((_, i) => i).filter((i) => list.includes(i));
  if (!clean.length) return;   // 至少保留一个
  settings.clickCycle = clean;
  saveSettings();
  broadcastSettings();
  buildTrayMenu();
});
ipcMain.on('cycle-cancel', () => { if (cycleWin) cycleWin.close(); });

function openLinesEditor() {
  if (linesWin) { linesWin.focus(); return; }
  linesWin = new BrowserWindow({
    width: 330,
    height: 600,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    backgroundColor: '#fff8f2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  linesWin.loadFile('lines-editor.html');
  linesWin.on('closed', () => { linesWin = null; });
}
ipcMain.on('lines-submit', (_e, lines, eventLines) => {
  if (linesWin) linesWin.close();
  const cleanEvent = {};
  if (eventLines && typeof eventLines === 'object') {
    for (const k of Object.keys(eventLines)) {
      const arr = Array.isArray(eventLines[k]) ? eventLines[k] : [];
      const c = arr.map((s) => String(s).trim().slice(0, LINES_LEN)).filter(Boolean).slice(0, LINES_MAX);
      cleanEvent[k] = c;   // 空数组也写入：= 用户明确清空，这条台词不显示
    }
  }
  settings.eventLines = cleanEvent;
  if (!lines || typeof lines !== 'object') { saveSettings(); broadcastSettings(); return; }
  const clean = {};
  for (let i = 0; i < FORMS.length; i++) {
    const arr = Array.isArray(lines[i]) ? lines[i] : [];
    clean[i] = arr.map((s) => String(s).trim().slice(0, LINES_LEN)).filter(Boolean).slice(0, LINES_MAX);
  }
  settings.lines = clean;
  saveSettings();
  broadcastSettings();
});
ipcMain.on('lines-cancel', () => { if (linesWin) linesWin.close(); });

// 待办面板里的「台词设置」：只改待办相关的几条，其余台词保持不动
const TODO_LINE_KEYS = ['todoDone', 'todoAllDone', 'reminder', 'reminderSoon', 'todoSay'];
ipcMain.on('todo-lines-save', (_e, obj) => {
  if (!obj || typeof obj !== 'object') return;
  const next = Object.assign({}, settings.eventLines || {});
  for (const k of TODO_LINE_KEYS) {
    if (!(k in obj)) continue;
    const arr = Array.isArray(obj[k]) ? obj[k] : [];
    next[k] = arr.map((s) => String(s).trim().slice(0, LINES_LEN)).filter(Boolean).slice(0, LINES_MAX);
  }
  settings.eventLines = next;
  saveSettings();
  broadcastSettings();
});

// ---------- 全局快捷键（Ctrl+Alt+J 召唤/隐藏） ----------
function applyHotkey() {
  globalShortcut.unregisterAll();
  if (settings.toggles.hotkey !== false) {
    const ok = globalShortcut.register('Control+Alt+J', () => {
      if (win) (win.isVisible() ? win.hide() : win.show());
    });
    if (!ok) console.warn('[hotkey] Ctrl+Alt+J 注册失败（可能被其他程序占用）');
  }
}

// ---------- 今日番茄统计 ----------
function pomoToday() {
  const d = new Date();
  const today = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  if (settings.stats.date !== today) {
    // 跨天只清"今日"计数，连续天数、累计星星、最后专注日期要保留
    settings.stats.date = today;
    settings.stats.tomatoes = 0;
    settings.stats.focusMin = 0;
    starsToday = 0;
    saveSettings();
  }
  return settings.stats.tomatoes;
}
ipcMain.on('pomodoro-done', (_e, minutes) => {
  pomoToday();
  addFocusSession(Number(minutes) || settings.pomodoro.focus);
});

// ---------- 检查更新 / 打开外部链接 ----------
function openLink(url) {
  try { shell.openExternal(url); } catch (_) {}
}

// 版本号转可比较数字：1.2.0 / v1.2.0 / 1.2.0-beta 都能处理
function verNum(v) {
  const p = String(v || '').replace(/^v/i, '').split(/[.+\-]/);
  return [0, 1, 2].reduce((acc, i) => acc + (parseInt(p[i], 10) || 0) * Math.pow(1000, 2 - i), 0);
}

// 拉 GitHub 最新 Release 的 tag（失败/无网时安静返回）
function fetchLatestTag(cb) {
  let done = false;
  const finish = (err, tag) => { if (!done) { done = true; cb(err, tag); } };
  try {
    const req = https.get({
      hostname: 'api.github.com',
      path: `/repos/${REPO}/releases/latest`,
      headers: { 'User-Agent': `JujuPet/${APP_VERSION}`, Accept: 'application/vnd.github+json' },
      timeout: 7000
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; if (body.length > 2e6) req.destroy(); });
      res.on('end', () => {
        if (res.statusCode !== 200) return finish(new Error(`HTTP ${res.statusCode}`));
        try { const j = JSON.parse(body); finish(null, j.tag_name || j.name || ''); }
        catch (e) { finish(e); }
      });
    });
    req.on('timeout', () => { req.destroy(); finish(new Error('timeout')); });
    req.on('error', (e) => finish(e));
  } catch (e) { finish(e); }
}

// manual=true：用户主动点「检查更新」，任何结果都给答复
// manual=false：启动后静默检查，只有发现新版本才冒个气泡
function checkUpdate(manual) {
  settings.lastUpdateCheck = Date.now();
  saveSettings();
  fetchLatestTag((err, tag) => {
    const latest = String(tag || '').replace(/^v/i, '').trim();
    if (err || !latest) {
      if (manual) {
        dialog.showMessageBox({
          type: 'warning', title: '检查更新',
          message: '暂时连不上服务器',
          detail: `没能获取版本信息（${err ? err.message : '未知错误'}）。\n可以手动打开下载页看看：${LINKS.home}`,
          buttons: ['打开下载页', '关闭'], defaultId: 0, cancelId: 1, noLink: true
        }).then(({ response }) => { if (response === 0) openLink(LINKS.home); });
      }
      return;
    }
    if (verNum(latest) > verNum(APP_VERSION)) {
      if (!manual && settings.skipVersion === latest) return;   // 用户已选「以后再说」
      if (manual) {
        dialog.showMessageBox({
          type: 'info', title: '发现新版本',
          message: `新版本 v${latest} 可以更新（当前 v${APP_VERSION}）`,
          detail: '下载安装包后直接双击覆盖安装即可，设置、台词、待办都会保留。',
          buttons: ['去下载', '以后再说'], defaultId: 0, cancelId: 1, noLink: true
        }).then(({ response }) => {
          if (response === 0) openLink(LINKS.latest);
          else { settings.skipVersion = latest; saveSettings(); }
        });
      } else if (win && !win.isDestroyed()) {
        win.webContents.send('notice', `新版本 v${latest} 出来了！右键托盘 → 关于 / 更新 去下载`);
      }
    } else if (manual) {
      dialog.showMessageBox({
        type: 'info', title: '检查更新',
        message: `已经是最新版本 v${APP_VERSION}`,
        detail: '感谢使用啾莉恩桌宠～有想法或 bug 欢迎在 GitHub Issues 或 Threads 找作者。',
        buttons: ['好'], noLink: true
      });
    }
  });
}

// ---------- 功能开关菜单项（默认开启型开关，存 false 表示关闭） ----------
function toggleMenuItem(label, key) {
  const on = settings.toggles[key] !== false;
  return {
    label,
    type: 'checkbox',
    checked: on,
    click: () => {
      settings.toggles[key] = !on;
      saveSettings();
      broadcastSettings();
      buildTrayMenu();
      if (key === 'quietFullscreen') {
        if (!on) startFullscreenWatch();
        else { stopFullscreenWatch(); if (hiddenByFs) { hiddenByFs = false; if (win) win.showInactive(); } }
      }
    }
  };
}

// ---------- 单击 / 双击可绑定的动作 ----------
// cycle / pat / none 由渲染层执行（要配合动画），其余发给主进程 runPetAction
const PET_ACTIONS = [
  { id: 'cycle', label: '切换形态（按轮换表）' },
  { id: 'pat', label: '摸头彩蛋（跳一下 + 台词）' },
  { id: 'menu', label: '打开右键菜单' },
  { id: 'lines', label: '编辑台词…' },
  { id: 'pomo', label: '番茄钟（开始 / 暂停）' },
  { id: 'star', label: '撒一颗小星星' },
  { id: 'today', label: '今日小结（气泡）' },
  { id: 'todo', label: '打开今日待办' },
  { id: 'todoSay', label: '念一句待办（气泡）' },
  { id: 'hide', label: '隐身 / 叫回来' },
  { id: 'desktop', label: '显示桌面（Win + D）' },
  { id: 'lock', label: '锁屏' },
  { id: 'follow', label: '跟着鼠标跑（开 / 关）' },
  { id: 'none', label: '无响应' }
];
const DBL_SKIP = ['cycle'];   // 双击列表里不放「切换形态」：第一击已经切过一次，再切会跳两格

function actionMenu(current, setter, skip = []) {
  return PET_ACTIONS
    .filter((a) => !skip.includes(a.id))
    .map((a) => ({
      label: a.label,
      type: 'radio',
      checked: current === a.id,
      click: () => setter(a.id)
    }));
}

// ---------- 自动睡觉 / 自行散步 的时长与方式 ----------
const SLEEP_PRESETS = [[0, '从不自动睡'], [3, '无操作 3 分钟'], [5, '无操作 5 分钟'], [10, '无操作 10 分钟'], [20, '无操作 20 分钟'], [30, '无操作 30 分钟'], [60, '无操作 1 小时']];
const WALK_PRESETS = [[0, '从不自己散步'], [1, '无操作 1 分钟'], [3, '无操作 3 分钟'], [5, '无操作 5 分钟'], [10, '无操作 10 分钟'], [20, '无操作 20 分钟']];

function idleMenu(kind) {
  const key = kind === 'sleep' ? 'sleepMin' : 'walkMin';
  const presets = kind === 'sleep' ? SLEEP_PRESETS : WALK_PRESETS;
  const cur = Number(settings.idle[key]) || 0;
  const set = (v) => { settings.idle[key] = v; saveSettings(); broadcastSettings(); buildTrayMenu(); };
  const items = presets.map(([m, label]) => ({
    label, type: 'radio', checked: cur === m, click: () => set(m)
  }));
  if (kind === 'sleep') {
    items.push({ type: 'separator' });
    items.push({
      label: '锁屏时也睡觉（解锁后说「醒来」）',
      type: 'checkbox',
      checked: settings.idle.sleepOnLock !== false,
      click: () => { settings.idle.sleepOnLock = !(settings.idle.sleepOnLock !== false); saveSettings(); broadcastSettings(); buildTrayMenu(); }
    });
  } else {
    items.push({ type: 'separator' });
    const setMode = (m) => { settings.idle.walkMode = m; saveSettings(); broadcastSettings(); buildTrayMenu(); };
    items.push({ label: '一直来回逛', type: 'radio', checked: (settings.idle.walkMode || 'continuous') === 'continuous', enabled: cur > 0, click: () => setMode('continuous') });
    items.push({ label: '走一段歇一段（更自然）', type: 'radio', checked: settings.idle.walkMode === 'occasion', enabled: cur > 0, click: () => setMode('occasion') });
  }
  return items;
}

// ---------- 悬停反应配置 ----------
// 悬停反应选项：-2 无反应 / -1 只动效+台词 / 0..5 切到指定形态
function hoverTargetMenu(zone) {
  const fallback = zone === 'head' ? 5 : 2;
  const hv = settings.hover || {};
  const v = Number.isInteger(hv[zone]) ? hv[zone] : fallback;
  const set = (val) => {
    settings.hover = Object.assign({ head: 5, hand: 2 }, settings.hover || {});
    settings.hover[zone] = val;
    saveSettings(); broadcastSettings(); buildTrayMenu();
  };
  return [
    { label: '无反应（不动也不说话）', type: 'radio', checked: v === -2, click: () => set(-2) },
    { label: '只跳一下 + 弹台词（不换姿势）', type: 'radio', checked: v === -1, click: () => set(-1) }
  ].concat(FORMS.map((f, i) => ({
    label: `切到「${f.label}」`,
    type: 'radio',
    checked: v === i,
    click: () => set(i)
  })));
}

// ---------- 菜单（右键 & 托盘共用） ----------
// 番茄钟某一时长的快捷预设 + 自定义入口
function pomoDurationMenu(field, presets) {
  return presets.map((m) => ({
    label: `${m} 分钟`,
    type: 'radio',
    checked: settings.pomodoro[field] === m,
    click: () => { settings.pomodoro[field] = m; saveSettings(); broadcastSettings(); buildTrayMenu(); }
  })).concat([{ label: '自定义…', click: () => openPomoInput(field) }]);
}

function buildMenu(popup = false) {
  const t = settings.toggles;
  const template = [
    {
      label: '显示 / 隐藏',
      click: () => { toggleVisible(); }
    },
    { type: 'separator' },
    {
      label: '形态',
      submenu: FORMS.map((f, i) => ({
        label: f.label + (i === 3 ? '（音乐联动）' : ''),
        type: 'radio',
        checked: i === currentForm,
        click: () => setForm(i)
      })).concat([
        { type: 'separator' },
        { label: '编辑台词…', click: () => openLinesEditor() }
      ])
    },
    {
      label: '悬停反应',
      submenu: [
        { label: '光标停在头上', submenu: hoverTargetMenu('head') },
        { label: '光标停在手上', submenu: hoverTargetMenu('hand') },
        { type: 'separator' },
        { label: '姿势会停留 1.4 秒后自动还原', enabled: false },
        { label: '同一部位需离开再进入才再次触发', enabled: false }
      ]
    },
    {
      label: '大小',
      submenu: SCALES.map((s, i) => ({
        label: s.label,
        type: 'radio',
        checked: i === settings.scaleIdx,
        click: () => setScale(i)
      }))
    },
    { type: 'separator' },
    {
      label: '番茄钟',
      submenu: [
        { label: `今日已完成 ${pomoToday()} 个番茄`, enabled: false },
        { label: pomodoroRunning ? '● 进行中…' : `开始专注 (${settings.pomodoro.focus} 分钟)`, enabled: !pomodoroRunning, click: () => win && win.webContents.send('pomodoro-cmd', 'start') },
        { label: '停止番茄钟', enabled: pomodoroRunning, click: () => win && win.webContents.send('pomodoro-cmd', 'stop') },
        { type: 'separator' },
        { label: '专注时长', submenu: pomoDurationMenu('focus', [15, 20, 25, 30, 45, 60, 90]) },
        { label: '短休息', submenu: pomoDurationMenu('break', [5, 10, 15, 20]) },
        { label: '长休息', submenu: pomoDurationMenu('long', [15, 20, 30, 45]) }
      ]
    },
    {
      label: '快捷指令 & 小结',
      submenu: [
        { label: '今日小结（气泡）', click: () => showTodayStat() },
        { label: '看看待办（气泡）', click: () => showTodoList() },
        { type: 'separator' },
        { label: '显示桌面（Win+D）', click: () => runDeskAction('showdesktop') },
        { label: '锁屏', click: () => runDeskAction('lock') },
        { label: '打开设置文件夹', click: () => { try { shell.openPath(app.getPath('userData')); } catch (_) {} } },
        { type: 'separator' },
        { label: '撒一颗小星星', click: () => { if (!dropStar() && win) win.webContents.send('notice', '现在不方便撒星星（全屏或专注中）'); } }
      ]
    },
    {
      label: (() => {
        const n = settings.reminders.filter((r) => !r.done).length;
        return n ? `提醒 · 待办 ${n} 件` : '提醒';
      })(),
      submenu: [
        { label: '今日待办清单…', click: () => openTodoList() },
        { type: 'separator' },
        { label: '久坐提醒（45 分钟）', type: 'checkbox', checked: t.sedentary, click: () => { settings.toggles.sedentary = !t.sedentary; saveSettings(); broadcastSettings(); buildTrayMenu(); } },
        { label: '喝水提醒（45 分钟）', type: 'checkbox', checked: t.water, click: () => { settings.toggles.water = !t.water; saveSettings(); broadcastSettings(); buildTrayMenu(); } }
      ]
    },
    {
      label: '功能开关',
      submenu: [
        { label: '听歌联动（音乐→戴耳机）', type: 'checkbox', checked: t.audio, click: () => { settings.toggles.audio = !t.audio; saveSettings(); broadcastSettings(); buildTrayMenu(); } },
        { label: '自动睡觉', submenu: idleMenu('sleep') },
        { label: '自行散步', submenu: idleMenu('walk') },
        { label: '跟着鼠标跑（实验）', type: 'checkbox', checked: t.followMouse === true, click: () => { settings.toggles.followMouse = !(t.followMouse === true); saveSettings(); broadcastSettings(); buildTrayMenu(); } },
        { label: '眼睛跟随鼠标（眨眼保留）', type: 'checkbox', checked: t.eyeFollow !== false, click: () => { settings.toggles.eyeFollow = !(t.eyeFollow !== false); saveSettings(); broadcastSettings(); buildTrayMenu(); } },
        toggleMenuItem('全屏时自动隐身', 'quietFullscreen'),
        toggleMenuItem('专注时保持安静', 'focusQuiet'),
        toggleMenuItem('音乐节拍律动', 'groove'),
        toggleMenuItem('掉落小星星', 'starDrop'),
        toggleMenuItem('躲猫猫（快速靠近会闪开）', 'hideAndSeek'),
        { label: '全局快捷键（Ctrl+Alt+J 召唤/隐藏）', type: 'checkbox', checked: t.hotkey !== false, click: () => { settings.toggles.hotkey = !(t.hotkey !== false); saveSettings(); applyHotkey(); broadcastSettings(); buildTrayMenu(); } },
        {
          label: '单击动作',
          submenu: actionMenu(settings.clickAction || 'cycle', (id) => {
            settings.clickAction = id; saveSettings(); broadcastSettings(); buildTrayMenu();
          }).concat([
            { type: 'separator' },
            { label: '编辑轮换队列…', click: () => openCycleEditor() }
          ])
        },
        {
          label: '双击动作',
          submenu: actionMenu(settings.dblclick || 'pat', (id) => {
            settings.dblclick = id; saveSettings(); broadcastSettings(); buildTrayMenu();
          }, DBL_SKIP)
        }
      ]
    },
    { type: 'separator' },
    {
      label: '关于 / 更新',
      submenu: [
        { label: `当前版本 v${APP_VERSION}`, enabled: false },
        { label: '检查更新…', click: () => checkUpdate(true) },
        { label: '打开下载页（浏览器）', click: () => openLink(LINKS.home) },
        { label: '所有历史版本', click: () => openLink(LINKS.releases) },
        { type: 'separator' },
        { label: '反馈问题 / 提建议', click: () => openLink(LINKS.issues) },
        { label: '联系作者（Threads @netis.go）', click: () => openLink(LINKS.threads) },
        { label: 'GitHub 开源仓库', click: () => openLink(LINKS.repo) }
      ]
    },
    { label: '开机自启', type: 'checkbox', checked: isAutoStart(), click: () => { app.setLoginItemSettings({ openAtLogin: !isAutoStart() }); buildTrayMenu(); } },
    { label: '退出', click: () => app.quit() }
  ];
  const menu = Menu.buildFromTemplate(template);
  if (popup && win) menu.popup({ window: win });
  return menu;
}

// 大小切换统一走 setScale()，无额外注册
function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(buildMenu(false));
}

ipcMain.on('show-menu', () => { buildMenu(true); });

// 双击判定时长：跟随系统"鼠标双击速度"设置（注册表 DoubleClickSpeed，默认 500ms）
let dblMs = 500;
try {
  const out = require('child_process').execSync(
    'powershell -NoProfile -Command "(Get-ItemProperty \'HKCU:\\\\Control Panel\\\\Mouse\').DoubleClickSpeed"',
    { encoding: 'utf8', windowsHide: true, timeout: 4000 }
  );
  const m = String(out).match(/(\d{3,4})/);
  if (m) dblMs = Math.max(200, Math.min(900, parseInt(m[1], 10)));
} catch (_) { /* 读不到就用默认 */ }
ipcMain.on('get-dbl-ms', (e) => { e.returnValue = dblMs; });

// ---------- 眼睛跟随：光标轮询 + 脸颊色采样 ----------
// 50ms 轮询全局光标位置，位移超过 2px 才推送给渲染层（眼睛看向鼠标）
// ---------- 跟着鼠标跑：60fps 帧循环 + 速度矢量平滑（社区桌宠通用做法：不用固定步长硬跳，
//            而是每帧算目标速度、按加速度趋近、靠近目标自动减速，位置保留小数累积） ----------
const FOLLOW_MAX = 0.40;     // 最大速度 px/ms（约 400px/s）
const FOLLOW_STOP = 60;      // 距光标 60px 内停车（不贴脸）
const FOLLOW_SLOW = 150;     // 进入 150px 内开始减速
let followPos = null;        // 浮点位置（不取整，避免量化抖动）
let followVel = { x: 0, y: 0 };
let followMoving = false;    // 渲染层跑步动画状态（带滞回）
let followDir = 1;           // 朝向：1 右 -1 左
let lastDragAt = 0;          // 上次拖拽/甩出时间，短暂暂停跟随

function setFollowState(moving, dir) {
  if (moving === followMoving && (dir === 0 || dir === followDir)) return;
  followMoving = moving;
  if (dir) followDir = dir;
  if (win && !win.isDestroyed()) win.webContents.send('follow-state', { moving, dir: followDir });
}

function followStep() {
  try {
    if (!win || win.isDestroyed()) return;
    const active = settings.toggles.followMouse && Date.now() - lastDragAt > 700;
    if (!active || glideTimer) {
      followPos = null;   // 滑行/暂停后重新以当前窗口位置为基准，避免瞬移
      followVel.x = 0; followVel.y = 0;
      setFollowState(false, 0);
      return;
    }
    stopWalk();   // 跟随期间不自行散步，避免两个移动源打架
    const b = win.getBounds();
    const p = screen.getCursorScreenPoint();
    // 休眠唤醒/锁屏/多屏热插拔瞬间，系统可能返回异常坐标，直接重置避免 NaN 传进 setPosition
    if (![b.x, b.y, b.width, b.height, p.x, p.y].every(Number.isFinite)) {
      followPos = null; followVel.x = 0; followVel.y = 0;
      return;
    }
    const cx = b.x + b.width / 2;
  const cy = b.y + b.height - 14;             // 脚底锚点
  const dx = p.x - cx;
  const dy = (p.y - 46) - cy;                 // 目标：光标上方一点
  const dist = Math.hypot(dx, dy);

  // 目标速度：距离越近越慢（平滑刹车，杜绝到点抖动）
  let tx = 0, ty = 0;
  if (dist > FOLLOW_STOP) {
    const k = Math.min(1, (dist - FOLLOW_STOP) / (FOLLOW_SLOW - FOLLOW_STOP));
    const speed = FOLLOW_MAX * (0.28 + 0.72 * k);
    tx = dx / dist * speed;
    ty = dy / dist * speed;
  }
  // 按加速度趋近目标速度（方向变化柔和，不会瞬间掉头）
  const a = 0.16;
  followVel.x += (tx - followVel.x) * a;
  followVel.y += (ty - followVel.y) * a;
  const sp = Math.hypot(followVel.x, followVel.y);
  if (sp < 0.012) { followVel.x = 0; followVel.y = 0; }

  if (sp > 0.012 && Number.isFinite(followVel.x) && Number.isFinite(followVel.y)) {
    if (!followPos || !Number.isFinite(followPos.x) || !Number.isFinite(followPos.y)) {
      followPos = { x: b.x, y: b.y };
    }
    followPos.x += followVel.x * 16;
    followPos.y += followVel.y * 16;
    if (Number.isFinite(followPos.x) && Number.isFinite(followPos.y)) {
      try {
        win.setPosition(Math.round(followPos.x), Math.round(followPos.y));
      } catch (_) { /* 个别帧 setPosition 失败（如窗口正被系统操作）不致命，跳过 */ }
    }
  }
  // 跑步动画带滞回：起步 60px/s 才跑，降到 30px/s 才停
  if (!followMoving && sp > 0.06) setFollowState(true, Math.sign(followVel.x) || followDir);
  else if (followMoving && sp < 0.03) setFollowState(false, 0);
  } catch (_) { /* 任何单帧异常都不允许炸掉主进程 */ }
}
setInterval(followStep, 16);

function startCursorWatch() {
  let last = { x: -9e9, y: -9e9 };
  setInterval(() => {
    try {
      const p = screen.getCursorScreenPoint();
      if (Math.abs(p.x - last.x) < 2 && Math.abs(p.y - last.y) < 2) return;
      last = { x: p.x, y: p.y };
      if (win && !win.isDestroyed()) win.webContents.send('cursor-pos', { x: p.x, y: p.y });
    } catch (_) {}
  }, 50);
}

// ============================================================
// 不打扰：全屏自动隐身（看视频/玩游戏时躲起来）
// ============================================================
let fsHelper = null;
let fsActive = false;        // 当前是否处于全屏
let hiddenByFs = false;      // 是"全屏导致隐藏"，退出全屏要恢复

function fullscreenScriptPath() {
  const packed = path.join(process.resourcesPath || '', 'fullscreen_watch.ps1');
  if (app.isPackaged && fs.existsSync(packed)) return packed;
  return path.join(__dirname, 'tools', 'fullscreen_watch.ps1');
}

function startFullscreenWatch() {
  if (fsHelper) return;
  if (settings.toggles.quietFullscreen === false) return;
  const script = fullscreenScriptPath();
  if (!fs.existsSync(script)) return;
  try {
    fsHelper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script], { windowsHide: true });
  } catch (_) { fsHelper = null; return; }
  let buf = '';
  fsHelper.stdout.on('data', (c) => {
    buf += c.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line === '1' || line === '0') setFullscreen(line === '1');
    }
  });
  fsHelper.on('error', () => { fsHelper = null; });
  fsHelper.on('exit', () => { fsHelper = null; fsActive = false; });
}

function stopFullscreenWatch() {
  if (!fsHelper) return;
  try { fsHelper.kill(); } catch (_) {}
  fsHelper = null;
}

function toggleVisible() {
  if (!win) return;
  if (win.isVisible()) {
    win.hide();
    hiddenByFs = false;   // 手动隐藏就不算"全屏隐藏"，退出全屏时不再自动弹出来
  } else {
    hiddenByFs = false;
    win.show();
  }
}

function setFullscreen(on) {
  if (on === fsActive) return;
  fsActive = on;
  console.log(on ? '[fullscreen] 进入全屏 → 桌宠隐身' : '[fullscreen] 退出全屏 → 恢复显示');
  if (!win || win.isDestroyed()) return;
  if (on) {
    if (win.isVisible()) {
      hiddenByFs = true;
      stopWalk();
      stopGlide();
      stopStarChase();
      closeStar();
      setFollowState(false, 0);
      win.hide();
    }
  } else if (hiddenByFs) {
    hiddenByFs = false;
    win.showInactive();   // 恢复时不抢焦点，别把用户从全屏退出的应用里抢走
  }
}

// ============================================================
// 彩蛋：小星星——从屏幕上方掉下来，宠物跑过去捡
// ============================================================
const STAR_W = 44;
let starWin = null;
let starDropTimer = null;
let starFallTimer = null;
let starChaseTimer = null;
let starPos = null;          // {x, y} 窗口坐标
let starVy = 0;
let starGrounded = false;
let starsToday = 0;

function starCount() {
  pomoToday();   // 跨天时顺带把今日星星数归零
  return starsToday;
}

function dropStar() {
  if (starWin || !win || win.isDestroyed() || !win.isVisible()) return false;
  if (fsActive || pomodoroRunning && settings.toggles.focusQuiet !== false) return false;
  const { workArea } = screen.getPrimaryDisplay();
  const x = Math.round(workArea.x + 60 + Math.random() * Math.max(10, workArea.width - 160));
  const y = workArea.y - STAR_W;
  starWin = new BrowserWindow({
    width: STAR_W, height: STAR_W, x, y,
    frame: false, transparent: true, resizable: false, movable: false,
    skipTaskbar: true, focusable: false, hasShadow: false,
    alwaysOnTop: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  starWin.setAlwaysOnTop(true, 'screen-saver');
  starWin.setIgnoreMouseEvents(true);
  starWin.loadFile('star.html');
  starWin.on('closed', () => { starWin = null; });
  starPos = { x, y };
  starVy = 0;
  starGrounded = false;

  clearInterval(starFallTimer);
  starFallTimer = setInterval(() => {
    if (!starWin || !starPos) { clearInterval(starFallTimer); starFallTimer = null; return; }
    const { workArea: wa } = screen.getPrimaryDisplay();
    const floor = wa.y + wa.height - STAR_W - 2;
    starVy = Math.min(9, starVy + 0.75);
    starPos.y += starVy;
    if (starPos.y >= floor) {
      starPos.y = floor;
      if (!starGrounded) {
        starGrounded = true;
        starVy = 0;
        clearInterval(starFallTimer);
        starFallTimer = null;
        startStarChase();
      }
    }
    try { starWin.setPosition(Math.round(starPos.x), Math.round(starPos.y)); } catch (_) {}
  }, 16);

  // 12 秒没捡到就自己消失
  setTimeout(() => { if (starWin && !starChaseTimer) closeStar(); }, 12000);
  return true;
}

function startStarChase() {
  if (starChaseTimer || !starWin || !win) return;
  stopGlide();
  stopWalk();
  followPos = null;
  const startedAt = Date.now();
  starChaseTimer = setInterval(() => {
    if (!starWin || !win || !starPos || win.isDestroyed()) { stopStarChase(); return; }
    if (!starGrounded) return;
    if (Date.now() - startedAt > 15000) { closeStar(); return; }   // 追不到就算了，别一直跑
    if (Date.now() - lastDragAt < 500) { closeStar(); return; }   // 用户正在拖宠物，先别抢
    const b = win.getBounds();
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height - 18;
    const tx = starPos.x + STAR_W / 2;
    const ty = starPos.y + STAR_W / 2;
    const dx = tx - cx;
    const dy = ty - cy;
    const dist = Math.hypot(dx, dy);
    if (dist < 62) { collectStar(); return; }
    const step = 6.2;   // 捡星星是欢快的小跑，比跟鼠标快一点
    const nx = b.x + dx / dist * step;
    const ny = b.y + dy / dist * step;
    try { win.setPosition(Math.round(nx), Math.round(ny)); } catch (_) {}
  }, 16);
}

function stopStarChase() {
  if (starChaseTimer) { clearInterval(starChaseTimer); starChaseTimer = null; }
}

function closeStar() {
  stopStarChase();
  clearInterval(starFallTimer);
  starFallTimer = null;
  if (starWin && !starWin.isDestroyed()) starWin.close();
  starWin = null;
  starPos = null;
}

function collectStar() {
  closeStar();
  starsToday++;
  starCount();   // 跨天时归零过再计数
  settings.stats.stars = (settings.stats.stars || 0) + 1;
  saveSettings();
  if (win && !win.isDestroyed()) win.webContents.send('notice', `捡到一颗小星星（今天第 ${starsToday} 颗）`);
  snapWindow();
}

// 随机撒星星：空闲时 6~18 分钟一次
function scheduleStarDrop() {
  clearTimeout(starDropTimer);
  const wait = (6 + Math.random() * 12) * 60 * 1000;
  starDropTimer = setTimeout(() => {
    if (settings.toggles.starDrop !== false) dropStar();
    scheduleStarDrop();
  }, wait);
}

// ============================================================
// 躲猫猫：光标突然冲过来 → 闪开
// ============================================================
let dodgeTimer = null;
let lastDodgeAt = 0;
let lastCursor = { x: 0, y: 0, t: 0 };

function startDodgeWatch() {
  if (dodgeTimer) return;
  dodgeTimer = setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    if (settings.toggles.hideAndSeek === false) return;
    if (Date.now() - lastDragAt < 500 || glideTimer || starChaseTimer || settings.toggles.followMouse) return;
    const now = Date.now();
    if (now - lastDodgeAt < 25000) return;
    const p = screen.getCursorScreenPoint();
    const prev = lastCursor;
    lastCursor = { x: p.x, y: p.y, t: now };
    if (!prev.t) return;
    const dt = Math.max(16, now - prev.t);
    const vx = (p.x - prev.x) / dt;   // px/ms
    const vy = (p.y - prev.y) / dt;
    if (dt > 600) return;            // 光标刚出现/跳跃，不算冲刺
    const speed = Math.hypot(vx, vy);
    if (speed < 0.9) return;         // 只有"快速冲过来"才躲，慢慢靠近不影响摸头
    const b = win.getBounds();
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const dist = Math.hypot(p.x - cx, p.y - cy);
    if (dist > 260 || dist < 40) return;
    // 只在朝宠物方向冲时躲
    if (vx * (cx - p.x) + vy * (cy - p.y) <= 0) return;
    lastDodgeAt = now;
    doDodge(cx >= p.x ? 1 : -1);
  }, 120);
}

function doDodge(dir) {
  if (!win) return;
  const { workArea } = screen.getPrimaryDisplay();
  const [ww] = win.getSize();
  const { minX, maxX } = petHBounds(workArea, ww);
  const [x0, y0] = win.getPosition();
  const to = Math.max(minX, Math.min(maxX, x0 + dir * 120));
  const dur = 260;
  const t0 = Date.now();
  stopWalk();
  clearInterval(glideTimer);
  glideTimer = setInterval(() => {
    if (!win) { stopGlide(); return; }
    const k = Math.min(1, (Date.now() - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);   // easeOutCubic：起步快、收尾软
    const x = x0 + (to - x0) * e;
    const y = y0 - Math.sin(k * Math.PI) * 14;   // 小跳一下
    try { win.setPosition(Math.round(x), Math.round(y)); } catch (_) {}
    if (k >= 1) { stopGlide(); snapWindow(); }
  }, 16);
  if (win.webContents) win.webContents.send('dodge');
}

// ============================================================
// 快捷指令 / 今日小结
// ============================================================
function runDeskAction(action) {
  const script = app.isPackaged && fs.existsSync(path.join(process.resourcesPath || '', 'desk_action.ps1'))
    ? path.join(process.resourcesPath, 'desk_action.ps1')
    : path.join(__dirname, 'tools', 'desk_action.ps1');
  try {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script, '-Action', action], { windowsHide: true, detached: true });
    p.on('error', () => {});
    p.unref();
  } catch (_) {}
}

function todayStatText() {
  const s = settings.stats;
  const tm = s.tomatoes || 0;
  const fm = s.focusMin || 0;
  const streak = s.streak || 0;
  const stars = s.stars || 0;
  const todo = pendingTodos().length;
  const parts = [];
  parts.push(tm ? `今天专注 ${tm} 轮（${fm} 分钟）` : '今天还没有开始专注');
  if (streak > 1) parts.push(`连续 ${streak} 天`);
  if (stars) parts.push(`捡到 ${stars} 颗星星`);
  if (todo) parts.push(`还有 ${todo} 件待办`);
  return parts.join(' · ');
}

function showTodayStat() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('notice', todayStatText());
}

// 待办清单：最多念 3 条，太多会撑爆气泡
function pendingTodos() {
  const today = todayStart();
  // 只念「今天及以前」的事，未来日期的不催
  return settings.reminders
    .filter((r) => !r.done && (r.day || today) <= today)
    .sort((a, b) => ((a.day || 0) - (b.day || 0)) || ((a.due || 0) - (b.due || 0)));
}

function showTodoList() {
  if (!win || win.isDestroyed()) return;
  const pending = pendingTodos();
  const list = pending.slice(0, 3).map((r) => r.text);
  // 台词交给角色自己（用户可在「待办 → 台词设置」里改），这里只给数据
  win.webContents.send('todo-say', {
    list: list.join('、'),
    more: pending.length > 3 ? ` 等 ${pending.length} 件` : '',
    count: pending.length
  });
}

// 番茄结算：连续天数 + 专注分钟
function addFocusSession(minutes) {
  const d = new Date();
  const today = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const y = new Date(Date.now() - 86400000);
  const yesterday = `${y.getFullYear()}-${y.getMonth() + 1}-${y.getDate()}`;
  settings.stats.tomatoes = (settings.stats.tomatoes || 0) + 1;
  settings.stats.focusMin = (settings.stats.focusMin || 0) + (minutes || 0);
  if (settings.stats.lastFocusDate !== today) {
    settings.stats.streak = settings.stats.lastFocusDate === yesterday ? (settings.stats.streak || 0) + 1 : 1;
    settings.stats.lastFocusDate = today;
  }
  saveSettings();
  buildTrayMenu();
}

// 各形态脸颊主色（眨眼盖板用）：图内候选点取第一个不透明像素
const FACE_COLORS = FORMS.map((f) => {
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, f.file));
    if (img.isEmpty()) return '#d8c3e9';
    const size = img.getSize();
    const buf = img.toBitmap();
    const px = (fx, fy) => {
      const i = (Math.round(size.height * fy) * size.width + Math.round(size.width * fx)) * 4;
      return { r: buf[i + 2], g: buf[i + 1], b: buf[i], a: buf[i + 3] };   // Windows BGRA
    };
    for (const [fx, fy] of [[0.5, 0.45], [0.38, 0.5], [0.62, 0.5], [0.5, 0.55]]) {
      const c = px(fx, fy);
      if (c.a > 200) {
        return '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');
      }
    }
  } catch (_) {}
  return '#d8c3e9';
});
ipcMain.on('get-face-colors', (e) => { e.returnValue = FACE_COLORS; });

// 双击动作：调出番茄钟 / 打开台词编辑器（摸头在渲染进程本地处理）
ipcMain.on('pomo-start-request', () => {
  if (win && !pomodoroRunning) win.webContents.send('pomodoro-cmd', 'start');
});
ipcMain.on('open-lines', () => openLinesEditor());

// 单击 / 双击绑定动作的统一入口（cycle / pat / none 在渲染层本地处理，不会走到这里）
function runPetAction(id) {
  switch (id) {
    case 'menu': buildMenu(true); break;
    case 'lines': openLinesEditor(); break;
    case 'pomo':
      if (win && !win.isDestroyed()) win.webContents.send('pomodoro-cmd', pomodoroRunning ? 'stop' : 'start');
      break;
    case 'star': dropStar(); break;
    case 'today': showTodayStat(); break;
    case 'todo': openTodoList(); break;
    case 'todoSay': showTodoList(); break;
    case 'hide': toggleVisible(); break;
    case 'desktop': runDeskAction('showdesktop'); break;
    case 'lock': runDeskAction('lock'); break;
    case 'follow':
      settings.toggles.followMouse = settings.toggles.followMouse !== true;
      saveSettings(); broadcastSettings(); buildTrayMenu();
      if (win) win.webContents.send('notice', settings.toggles.followMouse ? '好欸，跟着你跑！' : '那我就在这儿待着啦');
      break;
    default: break;
  }
}
ipcMain.on('run-action', (_e, id) => { try { runPetAction(id); } catch (_) {} });

// ---------- 托盘 ----------
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'juju-idle.png')).resize({ width: 24, height: 22 });
  tray = new Tray(icon);
  tray.setToolTip(`Juju 桌宠 v${APP_VERSION}`);
  buildTrayMenu();
  tray.on('click', () => toggleVisible());
}

// ---------- 原生音频监测助手（pycaw / WASAPI，监测所有输出设备） ----------
// 开发环境：venv python 跑脚本；打包后：resources 里的独立 exe
let PYTHON = 'C:/Users/lx/.workbuddy/binaries/python/envs/default/Scripts/python.exe';
let WATCHER = path.join(__dirname, 'tools', 'audio_watch.py');
(function resolveHelper() {
  const packed = path.join(process.resourcesPath || '', 'audio_watch.exe');
  if (process.resourcesPath && fs.existsSync(packed)) {
    PYTHON = packed;
    WATCHER = [];
  }
})();
let audioHelper = null;
let helperStopped = false;
let helperFails = 0;   // 连续退出次数（收到有效数据即清零），用于重启退避

function startAudioHelper() {
  if (helperStopped) return;
  try {
    const args = Array.isArray(WATCHER) ? WATCHER : [WATCHER];
    audioHelper = spawn(PYTHON, args, { windowsHide: true });
    console.log('[helper] 音频监测助手已启动');
    let buf = '';
    audioHelper.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        helperFails = 0;  // 助手正常输出过 → 重置退避
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'state' && win) {
            win.webContents.send('helper-audio', { music: msg.music, peak: msg.peak });
          } else if (msg.type === 'peak' && win) {
            detectBeat(Number(msg.v) || 0);
          } else if (msg.type === 'beat') {
            console.log(`[helper] music=${msg.music} peak10s=${msg.peak10s} devices=${msg.devices}`);
          }
        } catch (_) { /* 忽略非 JSON 行 */ }
      }
    });
    audioHelper.stderr.on('data', (c) => console.warn('[helper:err]', c.toString().trim()));
    audioHelper.on('exit', (code) => {
      console.log('[helper] 助手退出 code=' + code);
      audioHelper = null;
      if (!helperStopped) {
        helperFails++;
        const delay = Math.min(3000 * helperFails, 60000);  // 退避：3s → 6s → 9s … 上限 60s
        setTimeout(startAudioHelper, delay);
      }
    });
  } catch (e) {
    console.warn('[helper] 启动失败', e);
    setTimeout(startAudioHelper, 5000);
  }
}

function stopAudioHelper() {
  helperStopped = true;
  if (audioHelper) {
    try { audioHelper.kill(); } catch (_) {}
    audioHelper = null;
  }
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  startAudioHelper();
  applyHotkey();
  startFullscreenWatch();   // 全屏自动隐身
  startDodgeWatch();        // 躲猫猫
  scheduleStarDrop();       // 随机小星星

  // 锁屏 / 解锁：解锁回来打个招呼
  powerMonitor.on('lock-screen', () => {
    if (win && !win.isDestroyed()) win.webContents.send('env-lock');
  });
  powerMonitor.on('unlock-screen', () => {
    if (win && !win.isDestroyed()) win.webContents.send('env-unlock');
  });

  // 空闲检测：键盘鼠标无操作 → 睡觉/散步判断依据
  setInterval(() => {
    if (!win) return;
    win.webContents.send('env-idle', powerMonitor.getSystemIdleTime());
  }, 5000);

  // 电源切换提醒（拔掉/插回充电器）
  powerMonitor.on('powerSourceChanged', () => {
    if (win) win.webContents.send('env-power', powerMonitor.isOnBatteryPower());
  });

  // 启动后把设置推给渲染层（渲染层就绪前发送会丢，轮询补发）
  const push = setInterval(() => {
    if (win) { broadcastSettings(); clearInterval(push); }
  }, 500);
  setTimeout(() => clearInterval(push), 10000);

  // 每天最多一次静默检查更新（发现新版本用气泡提醒，不打扰）
  setTimeout(() => {
    if (Date.now() - (settings.lastUpdateCheck || 0) > 24 * 3600 * 1000) checkUpdate(false);
  }, 12000);
});

app.on('before-quit', () => { stopAudioHelper(); stopFullscreenWatch(); closeStar(); savePos(); globalShortcut.unregisterAll(); });
app.on('will-quit', stopAudioHelper);
app.on('window-all-closed', () => app.quit());
