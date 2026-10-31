# 全屏窗口检测（常驻）：前台窗口是否铺满主屏时输出 1/0
# 只在状态变化时输出一行，主进程读取后决定桌宠隐身/恢复
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class FSProbe {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetShellWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$shell = [FSProbe]::GetShellWindow()
$last = -1
$parentId = 0
try { $parentId = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId } catch { }
$tick = 0

while ($true) {
  $fs = 0
  try {
    $h = [FSProbe]::GetForegroundWindow()
    if ($h -ne [IntPtr]::Zero -and $h -ne $shell) {
      $sb = New-Object System.Text.StringBuilder 256
      [void][FSProbe]::GetClassName($h, $sb, 256)
      $cls = $sb.ToString()
      # 排除桌面与任务栏/开始菜单，它们也是"铺满"的
      if ($cls -ne 'Progman' -and $cls -ne 'WorkerW' -and $cls -ne 'Shell_TrayWnd' -and $cls -ne 'Shell_SecondaryTrayWnd' -and $cls -ne 'Windows.UI.Core.CoreWindow') {
        $r = New-Object FSProbe+RECT
        if ([FSProbe]::GetWindowRect($h, [ref]$r)) {
          $sw = [FSProbe]::GetSystemMetrics(0)
          $sh = [FSProbe]::GetSystemMetrics(1)
          $w = $r.Right - $r.Left
          $hh = $r.Bottom - $r.Top
          if ($w -ge ($sw - 2) -and $hh -ge ($sh - 2) -and $r.Left -le 1 -and $r.Top -le 1) {
            $fs = 1
          }
        }
      }
    }
  } catch { $fs = 0 }

  if ($fs -ne $last) {
    Write-Output $fs
    [Console]::Out.Flush()
    $last = $fs
  }

  # 主程序异常退出时不要留孤儿进程
  $tick++
  if ($parentId -and ($tick % 8 -eq 0)) {
    if (-not (Get-Process -Id $parentId -ErrorAction SilentlyContinue)) { break }
  }
  Start-Sleep -Milliseconds 1200
}
