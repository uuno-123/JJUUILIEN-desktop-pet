# 桌宠快捷指令：由主进程一次性调用
#   showdesktop  显示桌面（Win+D）
#   lock         锁屏
param([string]$Action = 'showdesktop')

if ($Action -eq 'lock') {
  try { rundll32.exe user32.dll,LockWorkStation } catch { }
  exit 0
}

Add-Type -Name Keys -Namespace W -MemberDefinition @"
[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);
"@
$VK_LWIN = 0x5B
$VK_D = 0x44
$up = 0x02
try {
  [W.Keys]::keybd_event($VK_LWIN, 0, 0, [UIntPtr]::Zero)
  [W.Keys]::keybd_event($VK_D, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 40
  [W.Keys]::keybd_event($VK_D, 0, $up, [UIntPtr]::Zero)
  [W.Keys]::keybd_event($VK_LWIN, 0, $up, [UIntPtr]::Zero)
} catch { }
