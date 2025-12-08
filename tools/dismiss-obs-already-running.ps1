Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName UIAutomationClient

# Try for up to 15 seconds to find and click "Launch Anyway" on the "OBS is already running" dialog
$deadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $deadline) {
  try {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'OBS is already running')
    $dlg  = $root.FindFirst([System.Windows.Automation.TreeScope]::Subtree, $cond)
    if ($dlg) {
      # Try to find and click "Launch Anyway" button
      $btnCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'Launch Anyway')
      $btn = $dlg.FindFirst([System.Windows.Automation.TreeScope]::Subtree, $btnCond)
      if ($btn) {
        $pattern = $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $pattern.Invoke()
        Write-Host 'Clicked "Launch Anyway" on OBS already running dialog'
        break
      }
    }
  } catch { }
  Start-Sleep -Milliseconds 300
}

Write-Host 'Dismiss already-running helper exiting.'

