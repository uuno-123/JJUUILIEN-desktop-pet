const { app, BrowserWindow, ipcMain, Menu, Tray, screen, powerMonitor, nativeImage, globalShortcut } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let win = null;
let tray = null;
let reminderWin = null;

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
  ['쮝쮝이 안녕~（Juju 安宁~）'],
  ['站得直直的！쮝!'],
  ['抱抱… 쮝쮝'],
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

// ---------- 设置持久化 ----------
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const defaults = {
  x: null, y: null,
  scaleIdx: 1,
  form: 0,
  toggles: { audio: true, sleep: true, walk: true, sedentary: true, water: true, hotkey: true },
  reminders: [],         // [{text, due}]
  pomodoro: { focus: 25, break: 5, long: 15 },  // 番茄钟时长（分钟）
  dblclick: 'pat',       // 双击动作：pat 摸头彩蛋 | pomo 番茄钟 | lines 编辑台词 | none 不响应
  lines: {},             // 每形态自定义台词 { [formIdx]: [台词, ...] }
  eventLines: {},        // 系统事件自定义台词 { [事件key]: [台词, ...] }（空/缺失 = 用内置默认）
  stats: { date: '', tomatoes: 0 }   // 今日番茄统计
};
let settings = JSON.parse(JSON.stringify(defaults));
try {
  const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  settings = Object.assign(defaults, s);
  settings.toggles = Object.assign({}, defaults.toggles, s.toggles || {});
  settings.pomodoro = Object.assign({}, defaults.pomodoro, s.pomodoro || {});
  if (!Array.isArray(settings.reminders)) settings.reminders = [];
  settings.stats = Object.assign({}, defaults.stats, s.stats || {});
} catch (_) { /* 首次运行 */ }
// 台词：缺失的形态补默认示例（用户删空的形态保留为 []，不重新填充）
for (let i = 0; i < FORMS.length; i++) {
  if (!Array.isArray(settings.lines[i])) settings.lines[i] = DEFAULT_LINES[i].slice();
}

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
  const [x, y] = win.getPosition();
  win.setPosition(x + Math.round(dx), y + Math.round(dy));
});

// 甩出惯性：vx/vy 为 px/ms
ipcMain.on('fling', (_e, vx, vy) => {
  if (!win) return;
  stopGlide();
  stopWalk();
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

// ---------- 待办提醒 ----------
ipcMain.on('open-reminder-input', () => openReminderInput());

function openReminderInput() {
  if (reminderWin) { reminderWin.focus(); return; }
  reminderWin = new BrowserWindow({
    width: 300,
    height: 220,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    transparent: false,
    backgroundColor: '#fff8f2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  reminderWin.loadFile('reminder.html');
  reminderWin.on('closed', () => { reminderWin = null; });
}

ipcMain.on('reminder-submit', (_e, text, due) => {
  if (reminderWin) { reminderWin.close(); }
  if (!text || !due) return;
  settings.reminders.push({ text: String(text).slice(0, 50), due: Number(due) });
  saveSettings();
  buildTrayMenu();
});
ipcMain.on('reminder-cancel', () => { if (reminderWin) reminderWin.close(); });
ipcMain.on('reminder-delete', (_e, idx) => {
  settings.reminders.splice(idx, 1);
  saveSettings();
  buildTrayMenu();
});

// 到点检查
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (let i = settings.reminders.length - 1; i >= 0; i--) {
    if (settings.reminders[i].due <= now) {
      const r = settings.reminders.splice(i, 1);
      changed = true;
      if (win) win.webContents.send('show-reminder', r[0].text);
    }
  }
  if (changed) { saveSettings(); buildTrayMenu(); }
  // 到点前 5 分钟预告一次
  for (const r of settings.reminders) {
    if (!r.warned && r.due - now <= 5 * 60 * 1000 && r.due > now) {
      r.warned = true;
      if (win) win.webContents.send('show-reminder', '쮝! 还有 5 分钟：' + r.text);
    }
  }
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
    settings.stats = { date: today, tomatoes: 0 };
    saveSettings();
  }
  return settings.stats.tomatoes;
}
ipcMain.on('pomodoro-done', () => {
  pomoToday();
  settings.stats.tomatoes++;
  saveSettings();
  buildTrayMenu();
});

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
      click: () => { if (win) (win.isVisible() ? win.hide() : win.show()); }
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
        { label: `今日已完成 ${pomoToday()} 个番茄 쮝`, enabled: false },
        { label: pomodoroRunning ? '● 进行中…' : `开始专注 (${settings.pomodoro.focus} 分钟)`, enabled: !pomodoroRunning, click: () => win && win.webContents.send('pomodoro-cmd', 'start') },
        { label: '停止番茄钟', enabled: pomodoroRunning, click: () => win && win.webContents.send('pomodoro-cmd', 'stop') },
        { type: 'separator' },
        { label: '专注时长', submenu: pomoDurationMenu('focus', [15, 20, 25, 30, 45, 60, 90]) },
        { label: '短休息', submenu: pomoDurationMenu('break', [5, 10, 15, 20]) },
        { label: '长休息', submenu: pomoDurationMenu('long', [15, 20, 30, 45]) }
      ]
    },
    {
      label: '提醒',
      submenu: [
        { label: '久坐提醒（45 分钟）', type: 'checkbox', checked: t.sedentary, click: () => { settings.toggles.sedentary = !t.sedentary; saveSettings(); broadcastSettings(); buildTrayMenu(); } },
        { label: '喝水提醒（45 分钟）', type: 'checkbox', checked: t.water, click: () => { settings.toggles.water = !t.water; saveSettings(); broadcastSettings(); buildTrayMenu(); } },
        { label: '添加待办提醒…', click: () => openReminderInput() },
        {
          label: '待办列表',
          submenu: settings.reminders.length
            ? settings.reminders.map((r, i) => ({
                label: `❑ ${r.text}（${new Date(r.due).getMonth() + 1}/${new Date(r.due).getDate()} ${String(new Date(r.due).getHours()).padStart(2, '0')}:${String(new Date(r.due).getMinutes()).padStart(2, '0')}）`,
                click: () => { settings.reminders.splice(i, 1); saveSettings(); buildTrayMenu(); }
              }))
            : [{ label: '（空）', enabled: false }]
        }
      ]
    },
    {
      label: '功能开关',
      submenu: [
        { label: '听歌联动（音乐→戴耳机）', type: 'checkbox', checked: t.audio, click: () => { settings.toggles.audio = !t.audio; saveSettings(); broadcastSettings(); buildTrayMenu(); } },
        { label: '自动睡觉', type: 'checkbox', checked: t.sleep, click: () => { settings.toggles.sleep = !t.sleep; saveSettings(); broadcastSettings(); buildTrayMenu(); } },
        { label: '自行散步', type: 'checkbox', checked: t.walk, click: () => { settings.toggles.walk = !t.walk; saveSettings(); broadcastSettings(); buildTrayMenu(); } },
        { label: '全局快捷键（Ctrl+Alt+J 召唤/隐藏）', type: 'checkbox', checked: t.hotkey !== false, click: () => { settings.toggles.hotkey = !(t.hotkey !== false); saveSettings(); applyHotkey(); broadcastSettings(); buildTrayMenu(); } },
        {
          label: '双击动作',
          submenu: [
            { label: '摸头彩蛋', type: 'radio', checked: (settings.dblclick || 'pat') === 'pat', click: () => { settings.dblclick = 'pat'; saveSettings(); broadcastSettings(); buildTrayMenu(); } },
            { label: '番茄钟', type: 'radio', checked: settings.dblclick === 'pomo', click: () => { settings.dblclick = 'pomo'; saveSettings(); broadcastSettings(); buildTrayMenu(); } },
            { label: '编辑台词', type: 'radio', checked: settings.dblclick === 'lines', click: () => { settings.dblclick = 'lines'; saveSettings(); broadcastSettings(); buildTrayMenu(); } },
            { label: '不响应', type: 'radio', checked: settings.dblclick === 'none', click: () => { settings.dblclick = 'none'; saveSettings(); broadcastSettings(); buildTrayMenu(); } }
          ]
        }
      ]
    },
    { type: 'separator' },
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

// 双击动作：调出番茄钟 / 打开台词编辑器（摸头在渲染进程本地处理）
ipcMain.on('pomo-start-request', () => {
  if (win && !pomodoroRunning) win.webContents.send('pomodoro-cmd', 'start');
});
ipcMain.on('open-lines', () => openLinesEditor());

// ---------- 托盘 ----------
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'juju-idle.png')).resize({ width: 24, height: 22 });
  tray = new Tray(icon);
  tray.setToolTip('Juju 桌宠');
  buildTrayMenu();
  tray.on('click', () => {
    if (win) (win.isVisible() ? win.hide() : win.show());
  });
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
});

app.on('before-quit', () => { stopAudioHelper(); savePos(); globalShortcut.unregisterAll(); });
app.on('will-quit', stopAudioHelper);
app.on('window-all-closed', () => app.quit());
