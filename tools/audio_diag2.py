# -*- coding: utf-8 -*-
"""完整调试：设备列表 + 默认设备 + 实时峰值（内嵌 winsound 播放测试音）"""
import time
import winsound
import comtypes
from pycaw.pycaw import AudioUtilities, IAudioMeterInformation, IMMDeviceEnumerator
from pycaw.constants import EDataFlow, DEVICE_STATE

TONE = r'C:\Users\lx\WorkBuddy\桌宠\juju-desktop-pet\tools\test_tone.wav'

devs = AudioUtilities.GetAllDevices(EDataFlow.eRender.value, DEVICE_STATE.ACTIVE.value)
en = comtypes.CoCreateInstance(
    comtypes.GUID('{BCDE0395-E52F-467C-8E3D-C4579291692E}'),
    IMMDeviceEnumerator, comtypes.CLSCTX_INPROC_SERVER)
defid = en.GetDefaultAudioEndpoint(EDataFlow.eRender.value, 0).GetId()
print('default_id =', defid)

entries = []
for d in devs:
    print('dev:', repr(d.FriendlyName), 'isdef=', d.id == defid)
    try:
        imm = en.GetDevice(d.id)
        m = imm.Activate(IAudioMeterInformation._iid_, comtypes.CLSCTX_ALL, None)
        m = m.QueryInterface(IAudioMeterInformation)
        entries.append((d.FriendlyName, d.id == defid, m))
        print('   meter ok, 当前峰值 =', m.GetPeakValue())
    except Exception as e:
        print('   meter fail:', type(e).__name__, e)

print('--- 12 秒监测，第 3 秒起播放测试音 8 秒 ---')
winsound.PlaySound(TONE, winsound.SND_ASYNC | winsound.SND_FILENAME)
for i in range(12):
    row = []
    for name, isd, m in entries:
        try:
            p = m.GetPeakValue()
        except Exception:
            p = -1
        row.append('%s%s:%.4f' % (name[:18], '*' if isd else '', p))
    print(i, ' | '.join(row))
    time.sleep(1)
