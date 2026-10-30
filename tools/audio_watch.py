# -*- coding: utf-8 -*-
"""
桌宠音频监测助手（原生 WASAPI，比 Chromium 回环流可靠）
- 同时监测所有活动输出设备的峰值（任何设备出声都能检测到）
- 每 5 秒刷新设备列表（自动跟随设备插拔/默认设备切换）
- 滞回判定：peak > ON 持续 0.5s → 有声音；peak < OFF 持续 0.5s → 静音
- 状态变化时输出一行 JSON（flush），每 10 秒输出一次心跳
"""
import sys
import json
import time
import comtypes
from pycaw.pycaw import AudioUtilities, IAudioMeterInformation, IMMDeviceEnumerator
from pycaw.constants import EDataFlow, DEVICE_STATE

TICK = 0.1          # 采样间隔 100ms
ON_MS = 500         # 有声判定持续
OFF_MS = 500        # 静音判定持续
PEAK_ON = 0.015     # 有声阈值（峰值）
PEAK_OFF = 0.008    # 静音阈值（滞回下限）
REFRESH_SEC = 5.0   # 设备列表刷新周期
HEARTBEAT_SEC = 10

def build_meters(en):
    meters = []
    try:
        coll = en.EnumAudioEndpoints(EDataFlow.eRender.value, DEVICE_STATE.ACTIVE.value)
        for i in range(coll.GetCount()):
            dev = coll.Item(i)
            try:
                m = dev.Activate(IAudioMeterInformation._iid_, comtypes.CLSCTX_ALL, None)
                meters.append(m.QueryInterface(IAudioMeterInformation))
            except Exception:
                pass
    except Exception:
        pass
    return meters

def main():
    comtypes.CoInitialize()
    en = comtypes.CoCreateInstance(
        comtypes.GUID('{BCDE0395-E52F-467C-8E3D-C4579291692E}'),
        IMMDeviceEnumerator, comtypes.CLSCTX_INPROC_SERVER)

    meters = build_meters(en)
    last_refresh = time.time()

    loud_ms = 0.0
    quiet_ms = 0.0
    music = False
    last_beat = time.time()
    max_peak = 0.0

    while True:
        now = time.time()
        if now - last_refresh >= REFRESH_SEC:
            meters = build_meters(en)
            last_refresh = now

        peak = 0.0
        for m in meters:
            try:
                p = m.GetPeakValue()
                if p > peak:
                    peak = p
            except Exception:
                pass
        if peak > max_peak:
            max_peak = peak

        if peak > PEAK_ON:
            loud_ms += TICK * 1000
            quiet_ms = 0
        elif peak < PEAK_OFF:
            quiet_ms += TICK * 1000
            loud_ms = 0

        if not music and loud_ms >= ON_MS:
            music = True
            print(json.dumps({'type': 'state', 'music': True, 'peak': round(peak, 4)}), flush=True)
        elif music and quiet_ms >= OFF_MS:
            music = False
            print(json.dumps({'type': 'state', 'music': False, 'peak': round(peak, 4)}), flush=True)

        if now - last_beat >= HEARTBEAT_SEC:
            print(json.dumps({'type': 'beat', 'music': music,
                              'peak10s': round(max_peak, 4),
                              'devices': len(meters)}), flush=True)
            last_beat = now
            max_peak = 0.0

        time.sleep(TICK)

if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(json.dumps({'type': 'fatal', 'error': str(e)}), flush=True)
        sys.exit(1)
