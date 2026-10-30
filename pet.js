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
  '쮝쮝이 안녕~（Juju 安宁~）',
  '站得直直的！쮝!',
  '抱抱… 쮝쮝',
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
  pat: '摸头杀… 쮝쮝（开心）',
  musicStop: '音乐停了… 쮝',
  sleep: 'Zzz…（Juju 睡着了）',
  wake: '쮝!（揉眼睛醒来）',
  sedentary: '已经坐了 45 分钟啦！站起来动一动 쮝쮝',
  water: '该喝水啦！쮝（推来一杯水）',
  batteryOff: '没插电源… 쮝（记得充电）',
  batteryOn: '充上电啦！쮝쮝',
  netOffline: '断网了… 쮝（世界安静了）',
  netOnline: '网回来啦！쮝쮝',
  pomoStart: '开始专注！{min} 分钟 쮝（我会安静陪着你的）',
  pomoBreak: '专注结束！休息 {min} 分钟～쮝',
  pomoLong: '完成 4 轮！大休息 {min} 分钟，最棒了！쮝쮝',
  pomoResume: '休息结束！新一轮专注开始 쮝',
  pomoStop: '番茄钟停止了 쮝（下次再来）',
  pomoWarn1: '还剩 1 分钟～쮝',
  pomoWarn10: '还剩 10 秒！쮝쮝',
  hourly: '쮝！{h} 点整啦~'
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
// 取事件台词：自定义池随机 → 内置默认；支持 {greet}/{now}/{date} 及 {min}/{h} 等附加变量
function eventLine(key, vars) {
  const arr = evtLines[key] || [];
  let text = arr.length ? pickRandom(arr) : EVENT_DEFAULTS[key] || '';
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
}

// 统一的形态视觉切换入口
function setFormVisual(idx) {
  currentIdx = idx;
  petImg.src = FORM_FILES[idx];
  applyFormWidth(idx);
}
setFormVisual(0);

// 台词池（默认示例，已被"编辑台词"功能取代，保留随机抽取逻辑）
// 生气彩蛋：快速连点时触发
const ANGRY_LINES = [
  '给我撒娇气存在！哼！',
  '（新米猫外星人形态上线…）'
];

// 左键点击：在 待机→站立→抱抱→生日→微笑 间循环切换（听歌形态归音频联动管）
const CLICK_CYCLE = [0, 1, 2, 4, 5];

let bubbleTimer = null;
function showBubble(text) {
  bubbleText.textContent = text;
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

  if (!dragging) return;
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

function handleClick() {
  // 番茄钟进行中：点击显示剩余时间（含已完成轮数），不切换形态
  if (pomo.running) {
    const tag = pomo.phase === 'focus' ? '专注中' : (pomo.phase === 'long' ? '长休息中' : '休息中');
    showBubble(`${tag}，还剩 ${pomoRemainingText()} 쮝（已完成 ${pomo.cycles} 轮）`);
    return;
  }
  // 点击循环切换形态：跳一下（用户反馈很可爱，保留）
  const pos = CLICK_CYCLE.indexOf(currentIdx);
  const next = CLICK_CYCLE[(pos + 1) % CLICK_CYCLE.length];
  document.body.classList.remove('hop');
  void document.body.offsetWidth;
  document.body.classList.add('hop');
  if (window.petAPI) window.petAPI.selectForm(next);
}

// 双击 = 摸头彩蛋
petWrap.addEventListener('dblclick', () => {
  showBubble(eventLine('pat'));
});

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
    // 该形态配置了台词则随机抽一条（删空则不说话），支持 {greet}/{now}/{date} 变量
    const arr = formLines[idx] || [];
    if (arr.length) showBubble(renderLine(pickRandom(arr)));
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
const IDLE_SLEEP_SEC = 600;        // 无操作 10 分钟入睡
const WALK_START_SEC = 180;        // 无操作 3 分钟开始散步

const state = {
  autoMode: 'idle',   // idle | music | sleep | manual
  manualUntil: 0,
  manualIdx: -1,      // 手动选择的形态，音乐结束后恢复
  idleSec: 0,
  music: false,
  lastSwitch: 0,
  walking: false
};

// 功能开关（主进程设置同步）
let T = { audio: true, sleep: true, walk: true, sedentary: true, water: true };

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

function updateAutoState() {
  const now = Date.now();

  // 听歌形态最高优先级：实时跟随系统音频（不受手动锁定/冷却/睡觉影响）
  if (state.music && state.autoMode !== 'music') {
    stopWalkNow();
    // 进入听歌形态：优先用用户配置的台词池（空则用内置兜底句）
    const musicLines = formLines[MUSIC_IDX] || [];
    autoSetForm(MUSIC_IDX,
      musicLines.length ? renderLine(pickRandom(musicLines)) : '听到音乐了！总是戴着耳机听歌~',
      'music');
    return;
  }
  if (!state.music && state.autoMode === 'music') {
    // 音乐结束：若还在手动锁定期内，恢复用户手选的形态，否则回待机
    if (now < state.manualUntil && state.manualIdx >= 0) {
      setFormVisual(state.manualIdx);
      document.body.classList.remove('sleeping', 'music');
      state.autoMode = 'manual';
    } else {
      // 音乐结束回到待机：事件台词（可自定义）
      autoSetForm(0, eventLine('musicStop'), 'idle');
    }
    return;
  }

  // 手动锁定期间不自动切换
  if (now < state.manualUntil) return;
  if (state.autoMode === 'manual') state.autoMode = 'idle';

  // 睡觉（可开关）
  if (T.sleep && state.idleSec >= IDLE_SLEEP_SEC) {
    if (state.autoMode !== 'sleep') {
      stopWalkNow();
      autoSetForm(0, eventLine('sleep'), 'sleep');
    }
    return;
  }
  if (!T.sleep && state.autoMode === 'sleep') {
    state.autoMode = 'idle';
    document.body.classList.remove('sleeping');
  }

  // 从睡觉醒来
  if (state.autoMode === 'sleep') {
    state.autoMode = 'idle';
    document.body.classList.remove('sleeping');
    showBubble(eventLine('wake'));
    state.lastSwitch = now;
    return;
  }

  // 自行散步：待机状态、无操作 3~10 分钟、开关打开
  const walkOk = T.walk
    && state.autoMode === 'idle'
    && !state.music
    && state.idleSec >= WALK_START_SEC
    && state.idleSec < IDLE_SLEEP_SEC;
  if (walkOk && !state.walking) {
    state.walking = true;
    document.body.classList.add('walking');
    if (window.petAPI) window.petAPI.walkStart();
  } else if (!walkOk && state.walking) {
    stopWalkNow();
  }
}
setInterval(updateAutoState, 200);

// ---------- 空闲 / 设置 / 提醒（主进程事件） ----------
let activeMs = 0;            // 连续活跃时长（久坐提醒）
let lastWaterAt = Date.now() + 22 * 60 * 1000;  // 喝水提醒起点错开久坐 22 分钟

function applyToggles() {
  // 音频联动关闭时强制退出听歌状态
  if (!T.audio && state.music) state.music = false;
}

if (window.petAPI) {
  window.petAPI.onEnvIdle((sec) => {
    state.idleSec = sec;
    // 久坐统计：5 秒内有输入视为活跃；离开超过 5 分钟视为休息过了
    if (sec <= 5) activeMs += 5000;
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

  // 设置同步（缩放 / 开关）
  window.petAPI.onSettings((s) => {
    scaleMul = [80, 110, 160][s.scaleIdx] / 110;
    T = Object.assign({}, T, s.toggles || {});
    if (s.pomodoro) pomoDur = Object.assign({}, pomoDur, s.pomodoro);
    applyLinesSetting(s.lines);
    applyEventLinesSetting(s.eventLines);
    applyToggles();
    applyFormWidth(currentIdx);
  });
  // 启动时先拉一次设置（不等广播）
  const s0 = window.petAPI.getSettings();
  if (s0) {
    scaleMul = [80, 110, 160][s0.scaleIdx] / 110;
    T = Object.assign({}, T, s0.toggles || {});
    if (s0.pomodoro) pomoDur = Object.assign({}, pomoDur, s0.pomodoro);
    applyLinesSetting(s0.lines);
    applyEventLinesSetting(s0.eventLines);
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
        window.petAPI.pomodoroDone();   // 上报主进程：今日番茄 +1（托盘菜单显示）
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

  // ---------- 待办到点 ----------
  window.petAPI.onShowReminder((text) => {
    showBubble('⏰ ' + text);
    document.body.classList.remove('hop');
    void document.body.offsetWidth;
    document.body.classList.add('hop');
  });
}

// ---------- 整点报时（睡觉时不打扰） ----------
let lastHour = new Date().getHours();
setInterval(() => {
  const h = new Date().getHours();
  if (h !== lastHour) {
    lastHour = h;
    if (!document.body.classList.contains('sleeping')) {
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
