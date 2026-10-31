const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  setClickable: (flag) => ipcRenderer.send('set-clickable', flag),
  move: (dx, dy) => ipcRenderer.send('move-window', dx, dy),
  fling: (vx, vy) => ipcRenderer.send('fling', vx, vy),
  walkStart: () => ipcRenderer.send('walk-start'),
  walkStop: () => ipcRenderer.send('walk-stop'),
  showMenu: () => ipcRenderer.send('show-menu'),
  reportWidth: (w) => ipcRenderer.send('pet-width', w),
  selectForm: (idx) => ipcRenderer.send('select-form', idx),
  syncForm: (idx) => ipcRenderer.send('sync-form', idx),
  sleepState: (v) => ipcRenderer.send('sleep-state', v),

  onSetForm: (cb) => ipcRenderer.on('set-form', (_e, idx) => cb(idx)),
  onSetScale: (cb) => ipcRenderer.on('set-scale', (_e, idx) => cb(idx)),
  onWalkDir: (cb) => ipcRenderer.on('walk-dir', (_e, dir) => cb(dir)),
  onEnvIdle: (cb) => ipcRenderer.on('env-idle', (_e, sec) => cb(sec)),
  onEnvPower: (cb) => ipcRenderer.on('env-power', (_e, onBattery) => cb(onBattery)),
  onHelperAudio: (cb) => ipcRenderer.on('helper-audio', (_e, data) => cb(data)),
  onBeat: (cb) => ipcRenderer.on('beat', (_e, v) => cb(v)),
  onEnvLock: (cb) => ipcRenderer.on('env-lock', () => cb()),
  onEnvUnlock: (cb) => ipcRenderer.on('env-unlock', () => cb()),
  onDodge: (cb) => ipcRenderer.on('dodge', () => cb()),
  onSettings: (cb) => ipcRenderer.on('settings', (_e, s) => cb(s)),
  onPomodoroCmd: (cb) => ipcRenderer.on('pomodoro-cmd', (_e, cmd) => cb(cmd)),
  pomodoroState: (st) => ipcRenderer.send('pomodoro-state', st),
  pomodoroDone: (minutes) => ipcRenderer.send('pomodoro-done', minutes),
  startPomodoro: () => ipcRenderer.send('pomo-start-request'),
  openLines: () => ipcRenderer.send('open-lines'),
  runAction: (id) => ipcRenderer.send('run-action', id),
  onShowReminder: (cb) => ipcRenderer.on('show-reminder', (_e, payload) => cb(payload)),
  onTodoSay: (cb) => ipcRenderer.on('todo-say', (_e, data) => cb(data)),
  onNotice: (cb) => ipcRenderer.on('notice', (_e, text) => cb(text)),
  getSettings: () => ipcRenderer.sendSync('get-settings'),
  getFaceColors: () => ipcRenderer.sendSync('get-face-colors'),
  onCursor: (cb) => ipcRenderer.on('cursor-pos', (_e, p) => cb(p)),
  onFollowState: (cb) => ipcRenderer.on('follow-state', (_e, st) => cb(st)),
  getDblMs: () => ipcRenderer.sendSync('get-dbl-ms'),

  // 待办清单面板
  todoAdd: (text, due) => ipcRenderer.send('todo-add', text, due),
  todoUpdate: (id, text, due) => ipcRenderer.send('todo-update', id, text, due),
  todoCarry: (id) => ipcRenderer.send('todo-carry', id),
  todoCarryAll: () => ipcRenderer.send('todo-carry-all'),
  todoToggle: (id) => ipcRenderer.send('todo-toggle', id),
  todoDel: (id) => ipcRenderer.send('todo-del', id),
  todoClearDone: () => ipcRenderer.send('todo-clear-done'),
  todoClose: () => ipcRenderer.send('todo-close'),
  todoResize: (w, h) => ipcRenderer.send('todo-resize', w, h),
  todoResizeEnd: () => ipcRenderer.send('todo-resize-end'),
  todoLinesSave: (obj) => ipcRenderer.send('todo-lines-save', obj),
  todoReady: () => ipcRenderer.send('todo-ready'),
  onTodoData: (cb) => ipcRenderer.on('todo-data', (_e, data) => cb(data)),
  onTodoDone: (cb) => ipcRenderer.on('todo-done', (_e, left) => cb(left)),

  // 待办输入窗
  submitReminder: (text, due) => ipcRenderer.send('reminder-submit', text, due),
  cancelReminder: () => ipcRenderer.send('reminder-cancel'),

  // 番茄钟时长输入窗
  submitPomoMin: (field, min) => ipcRenderer.send('pomo-input-submit', field, min),
  cancelPomoInput: () => ipcRenderer.send('pomo-input-cancel'),

  // 台词编辑窗
  submitLines: (lines, eventLines) => ipcRenderer.send('lines-submit', lines, eventLines),
  cancelLines: () => ipcRenderer.send('lines-cancel'),
  submitCycle: (list) => ipcRenderer.send('cycle-submit', list),
  cancelCycle: () => ipcRenderer.send('cycle-cancel')
});
