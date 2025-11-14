Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName UIAutomationClient

# Try for up to 30 seconds to find and click \"Run in Normal Mode\" on the OBS crash dialog
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
  try {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'OBS Studio Crash Detected')
    $dlg  = $root.FindFirst([System.Windows.Automation.TreeScope]::Subtree, $cond)
    if ($dlg) {
      # Try both button text variants (some OBS versions use different wording)
      $btnTexts = @('Run in Normal Mode', 'Launch Normally')
      $clicked = $false
      foreach ($btnText in $btnTexts) {
        $btnCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $btnText)
        $btn = $dlg.FindFirst([System.Windows.Automation.TreeScope]::Subtree, $btnCond)
        if ($btn) {
          $pattern = $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
          $pattern.Invoke()
          $clicked = $true
          break
        }
      }
      if ($clicked) { break }
    }
  } catch { }
  Start-Sleep -Milliseconds 500
}

Write-Host 'Dismiss safe-mode helper exiting.'




