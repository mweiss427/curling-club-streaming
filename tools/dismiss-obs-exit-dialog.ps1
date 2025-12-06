Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName UIAutomationClient

# Try for up to 10 seconds to find and click "Yes" on the "Exit OBS?" dialog
$deadline = (Get-Date).AddSeconds(10)
while ((Get-Date) -lt $deadline) {
  try {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'Exit OBS?')
    $dlg  = $root.FindFirst([System.Windows.Automation.TreeScope]::Subtree, $cond)
    if ($dlg) {
      # Try to find and click "Yes" button
      $btnCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'Yes')
      $btn = $dlg.FindFirst([System.Windows.Automation.TreeScope]::Subtree, $btnCond)
      if ($btn) {
        $pattern = $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $pattern.Invoke()
        break
      }
    }
  } catch { }
  Start-Sleep -Milliseconds 300
}


