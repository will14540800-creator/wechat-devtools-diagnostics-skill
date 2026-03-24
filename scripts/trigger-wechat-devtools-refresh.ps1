param(
  [string]$Shortcut = '^r',
  [string]$WindowTitleContains = ''
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeMethods {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@

$processes = Get-Process | Where-Object {
  $_.MainWindowHandle -ne 0 -and $_.ProcessName -eq 'wechatdevtools'
}

if ($WindowTitleContains) {
  $processes = $processes | Where-Object {
    $_.MainWindowTitle -like "*$WindowTitleContains*"
  }
}

$process = $processes | Sort-Object StartTime -Descending | Select-Object -First 1

if (-not $process) {
  throw 'WeChat DevTools window not found.'
}

[void][NativeMethods]::ShowWindowAsync($process.MainWindowHandle, 9)
Start-Sleep -Milliseconds 200
[void][NativeMethods]::SetForegroundWindow($process.MainWindowHandle)

$shell = New-Object -ComObject WScript.Shell
[void]$shell.AppActivate($process.Id)
Start-Sleep -Milliseconds 350
$shell.SendKeys($Shortcut)
Start-Sleep -Milliseconds 250

[PSCustomObject]@{
  status = 'sent'
  shortcut = $Shortcut
  processId = $process.Id
  title = $process.MainWindowTitle
} | ConvertTo-Json -Compress
