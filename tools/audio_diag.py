# -*- coding: utf-8 -*-
"""诊断：输出设备名 + 实时峰值（15 秒窗口，配合测试音验证）"""
import time
import comtypes
from pycaw.pycaw import AudioUtilities, IAudioMeterInformation, IMMDeviceEnumerator
from pycaw.constants import EDataFlow, DEVICE_STATE

devs = AudioUtilities.GetAllDevices(EDataFlow.eRender.value, DEVICE_STATE.ACTIVE.value)
en = comtypes.CoCreateInstance(
    comtypes.GUID('{BCDE0395-E52F-467C-8E3D-C4579291692E}'),
    IMMDeviceEnumerator, comtypes.CLSCTX_INPROC_SERVER)
default_id = en.GetDefaultAudioEndpoint(EDataFlow.eRender.value, 0).GetId()

entries = []
for d in devs:
    try:
        imm = en.GetDevice(d.id)
        meter = imm.Activate(IAudioMeterInformation._iid_, comtypes.CLSCTX_ALL, None)
    except Exception as e:
        print('meter失败:', d.FriendlyName, type(e).__name__, e)
        meter = None
    entries.append((d.FriendlyName, d.id == default_id, meter))

print('=== 15 秒峰值监测 ===')
for _ in range(15):
    line = []
    for name, is_def, meter in entries:
        if meter is None:
            continue
        try:
            peak = meter.GetPeakValue()
        except Exception:
            continue
        if peak > 0.001 or is_def:
            line.append('%s%s=%.3f' % (name[:26], '[默认]' if is_def else '', peak))
    print(' | '.join(line) if line else '(全部静音)')
    time.sleep(1)
