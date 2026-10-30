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

  onSetForm: (cb) => ipcRenderer.on('set-form', (_e, idx) => cb(idx)),
  onSetScale: (cb) => ipcRenderer.on('set-scale', (_e, idx) => cb(idx)),
  onWalkDir: (cb) => ipcRenderer.on('walk-dir', (_e, dir) => cb(dir)),
  onEnvIdle: (cb) => ipcRenderer.on('env-idle', (_e, sec) => cb(sec)),
  onEnvPower: (cb) => ipcRenderer.on('env-power', (_e, onBattery) => cb(onBattery)),
  onHelperAudio: (cb) => ipcRenderer.on('helper-audio', (_e, data) => cb(data)),
  onSettings: (cb) => ipcRenderer.on('settings', (_e, s) => cb(s)),
  onPomodoroCmd: (cb) => ipcRenderer.on('pomodoro-cmd', (_e, cmd) => cb(cmd)),
  pomodoroState: (st) => ipcRenderer.send('pomodoro-state', st),
  pomodoroDone: () => ipcRenderer.send('pomodoro-done'),
  onShowReminder: (cb) => ipcRenderer.on('show-reminder', (_e, text) => cb(text)),
  getSettings: () => ipcRenderer.sendSync('get-settings'),

  // 待办输入窗
  submitReminder: (text, due) => ipcRenderer.send('reminder-submit', text, due),
  cancelReminder: () => ipcRenderer.send('reminder-cancel'),

  // 番茄钟时长输入窗
  submitPomoMin: (field, min) => ipcRenderer.send('pomo-input-submit', field, min),
  cancelPomoInput: () => ipcRenderer.send('pomo-input-cancel'),

  // 台词编辑窗
  submitLines: (lines, eventLines) => ipcRenderer.send('lines-submit', lines, eventLines),
  cancelLines: () => ipcRenderer.send('lines-cancel')
});
