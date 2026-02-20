Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$projectRoot = "C:\Users\Nazarko\chatbot"
$stateDir = Join-Path $projectRoot ".launcher"
$stateFile = Join-Path $stateDir "state.json"
$serverLog = Join-Path $stateDir "server.log"
$webLog = Join-Path $stateDir "web.log"
$launcherErrLog = Join-Path $stateDir "launcher-error.log"

if (-not (Test-Path $stateDir)) {
  New-Item -Path $stateDir -ItemType Directory | Out-Null
}

function Load-State {
  if (Test-Path $stateFile) {
    try {
      return Get-Content -Path $stateFile -Raw | ConvertFrom-Json
    } catch {}
  }
  return [PSCustomObject]@{ backendPid = 0; frontendPid = 0 }
}

function Save-State {
  param([int]$backendPid, [int]$frontendPid)
  $obj = [PSCustomObject]@{
    backendPid = $backendPid
    frontendPid = $frontendPid
  }
  $obj | ConvertTo-Json | Set-Content -Path $stateFile -Encoding UTF8
}

function Stop-ByPid {
  param([int]$procId)
  if ($procId -le 0) { return }
  try { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } catch {}
}

function Stop-Ports {
  param([int[]]$ports)
  foreach ($p in $ports) {
    try {
      $conns = Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue
      $ownerPids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
      foreach ($procId in $ownerPids) {
        if ($procId -gt 0) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }
      }
    } catch {}
  }
}

function Stop-Services {
  $state = Load-State
  Stop-ByPid -procId ([int]$state.backendPid)
  Stop-ByPid -procId ([int]$state.frontendPid)
  Stop-Ports -ports @(5000, 5173)
  Save-State -backendPid 0 -frontendPid 0
}

function Start-Services {
  Remove-Item -Path $serverLog -ErrorAction SilentlyContinue
  Remove-Item -Path $webLog -ErrorAction SilentlyContinue

  $psExe = Join-Path $PSHOME "powershell.exe"
  if (-not (Test-Path $psExe)) { $psExe = "powershell.exe" }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm is not found in PATH. Open terminal and verify: npm -v"
  }

  $backendScript = "npm run dev *> '$serverLog'"
  $backend = Start-Process -FilePath $psExe `
    -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $backendScript `
    -WorkingDirectory (Join-Path $projectRoot "server") `
    -WindowStyle Hidden `
    -PassThru

  Start-Sleep -Milliseconds 700

  $frontendScript = "npm run dev *> '$webLog'"
  $frontend = Start-Process -FilePath $psExe `
    -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $frontendScript `
    -WorkingDirectory (Join-Path $projectRoot "web") `
    -WindowStyle Hidden `
    -PassThru

  Save-State -backendPid $backend.Id -frontendPid $frontend.Id
}

function Write-LauncherError {
  param([string]$message)
  $line = "$(Get-Date -Format s) $message"
  Add-Content -Path $launcherErrLog -Value $line -Encoding UTF8
}

function Wait-Ports {
  param(
    [int[]]$Ports,
    [int]$TimeoutMs = 12000
  )

  $start = [Environment]::TickCount
  while (([Environment]::TickCount - $start) -lt $TimeoutMs) {
    $allOpen = $true
    foreach ($p in $Ports) {
      $isOpen = $false
      try { $isOpen = [bool](Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue) } catch {}
      if (-not $isOpen) {
        $allOpen = $false
        break
      }
    }
    if ($allOpen) { return $true }
    Start-Sleep -Milliseconds 350
  }
  return $false
}

function Get-HealthText {
  $ok5000 = $false
  $ok5173 = $false
  try { $ok5000 = [bool](Get-NetTCPConnection -LocalPort 5000 -ErrorAction SilentlyContinue) } catch {}
  try { $ok5173 = [bool](Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue) } catch {}

  if ($ok5000 -and $ok5173) { return "Status: backend and frontend are running" }
  if ($ok5000 -or $ok5173) { return "Status: partially running (check .launcher logs)" }
  return "Status: services are stopped"
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "OA Smart Assistant Launcher"
$form.Size = New-Object System.Drawing.Size(640, 360)
$form.StartPosition = "CenterScreen"
$form.BackColor = [System.Drawing.Color]::FromArgb(16, 24, 32)
$form.ForeColor = [System.Drawing.Color]::White

$title = New-Object System.Windows.Forms.Label
$title.Text = "OA Smart Assistant"
$title.Font = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Bold)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(24, 20)
$form.Controls.Add($title)

$desc = New-Object System.Windows.Forms.Label
$desc.Text = "Start local chatbot web and admin panel.`nStart runs backend (5000) and frontend (5173) in background.`nRestart stops active processes and starts them again."
$desc.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$desc.AutoSize = $false
$desc.Size = New-Object System.Drawing.Size(580, 90)
$desc.Location = New-Object System.Drawing.Point(24, 70)
$form.Controls.Add($desc)

$status = New-Object System.Windows.Forms.Label
$status.Text = Get-HealthText
$status.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$status.AutoSize = $true
$status.Location = New-Object System.Drawing.Point(24, 160)
$form.Controls.Add($status)

$startBtn = New-Object System.Windows.Forms.Button
$startBtn.Text = "Start"
$startBtn.Font = New-Object System.Drawing.Font("Segoe UI", 12, [System.Drawing.FontStyle]::Bold)
$startBtn.Size = New-Object System.Drawing.Size(160, 48)
$startBtn.Location = New-Object System.Drawing.Point(24, 195)
$startBtn.BackColor = [System.Drawing.Color]::FromArgb(37, 183, 159)
$startBtn.ForeColor = [System.Drawing.Color]::Black
$startBtn.FlatStyle = "Flat"
$startBtn.Add_Click({
  try {
    $status.Text = "Status: starting services..."
    Remove-Item -Path $launcherErrLog -ErrorAction SilentlyContinue
    Stop-Services
    Start-Services
    if (Wait-Ports -Ports @(5000, 5173)) {
      $status.Text = Get-HealthText
    } else {
      $status.Text = "Status: startup failed (check .launcher/server.log and .launcher/web.log)"
    }
  } catch {
    $msg = $_.Exception.Message
    Write-LauncherError "START: $msg"
    $status.Text = "Status: startup error - $msg"
  }
})
$form.Controls.Add($startBtn)

$restartBtn = New-Object System.Windows.Forms.Button
$restartBtn.Text = "Restart"
$restartBtn.Font = New-Object System.Drawing.Font("Segoe UI", 12, [System.Drawing.FontStyle]::Bold)
$restartBtn.Size = New-Object System.Drawing.Size(180, 48)
$restartBtn.Location = New-Object System.Drawing.Point(200, 195)
$restartBtn.BackColor = [System.Drawing.Color]::FromArgb(255, 179, 71)
$restartBtn.ForeColor = [System.Drawing.Color]::Black
$restartBtn.FlatStyle = "Flat"
$restartBtn.Add_Click({
  try {
    $status.Text = "Status: restarting services..."
    Remove-Item -Path $launcherErrLog -ErrorAction SilentlyContinue
    Stop-Services
    Start-Sleep -Milliseconds 450
    Start-Services
    if (Wait-Ports -Ports @(5000, 5173)) {
      $status.Text = Get-HealthText
    } else {
      $status.Text = "Status: restart failed (check .launcher/server.log and .launcher/web.log)"
    }
  } catch {
    $msg = $_.Exception.Message
    Write-LauncherError "RESTART: $msg"
    $status.Text = "Status: restart error - $msg"
  }
})
$form.Controls.Add($restartBtn)

$note = New-Object System.Windows.Forms.Label
$note.Text = "Chat: http://localhost:5173/    Admin: http://localhost:5173/admin.html"
$note.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$note.AutoSize = $true
$note.Location = New-Object System.Drawing.Point(24, 265)
$form.Controls.Add($note)

[void]$form.ShowDialog()
