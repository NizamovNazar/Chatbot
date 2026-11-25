# OA Smart Assistant launcher - Start / Restart / Stop.
# PowerShell 5.1 on Windows 10/11. Only launcher-owned processes are stopped.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$projectRoot = $PSScriptRoot
$stateDir = Join-Path $projectRoot '.launcher'
$stateFile = Join-Path $stateDir 'state.json'
$serverLog = Join-Path $stateDir 'server.log'
$serverErrorLog = Join-Path $stateDir 'server.error.log'
$webLog = Join-Path $stateDir 'web.log'
$webErrorLog = Join-Path $stateDir 'web.error.log'
$launcherErrorLog = Join-Path $stateDir 'launcher-error.log'

if (-not (Test-Path -LiteralPath $stateDir)) {
  New-Item -Path $stateDir -ItemType Directory -Force | Out-Null
}

function Write-LauncherError {
  param([string]$Message)
  try {
    Add-Content -LiteralPath $launcherErrorLog -Value "$(Get-Date -Format o) $Message" -Encoding UTF8
  } catch {}
}

function New-EmptyState {
  return [PSCustomObject]@{ version = 2; backend = $null; frontend = $null }
}

function Load-State {
  if (-not (Test-Path -LiteralPath $stateFile)) { return New-EmptyState }
  try {
    $value = Get-Content -LiteralPath $stateFile -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    if ($null -ne $value) { return $value }
  } catch {
    Write-LauncherError "Cannot read state.json: $($_.Exception.Message)"
  }
  return New-EmptyState
}

function Save-State {
  param($Backend, $Frontend)
  $payload = [PSCustomObject]@{ version = 2; backend = $Backend; frontend = $Frontend }
  $temp = Join-Path $stateDir ('state.' + [Guid]::NewGuid().ToString('N') + '.tmp')
  try {
    $payload | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temp -Encoding UTF8 -ErrorAction Stop
    Move-Item -LiteralPath $temp -Destination $stateFile -Force -ErrorAction Stop
  } finally {
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
  }
}

function New-ProcessRecord {
  param([System.Diagnostics.Process]$Process)
  $actual = Get-Process -Id $Process.Id -ErrorAction Stop
  return [PSCustomObject]@{
    processId = [int]$actual.Id
    startUtc = $actual.StartTime.ToUniversalTime().ToString('o')
  }
}

function Confirm-ManagedProcess {
  param($Entry)
  if ($null -eq $Entry) { return $false }
  try {
    $processId = [int]$Entry.processId
    if ($processId -le 0 -or -not $Entry.startUtc) { return $false }
    $expected = [DateTime]::Parse(
      [string]$Entry.startUtc,
      [System.Globalization.CultureInfo]::InvariantCulture,
      [System.Globalization.DateTimeStyles]::RoundtripKind
    ).ToUniversalTime().Ticks
    $actual = (Get-Process -Id $processId -ErrorAction Stop).StartTime.ToUniversalTime().Ticks
    return $actual -eq $expected
  } catch { return $false }
}

function Confirm-LegacyProcess {
  param([int]$ProcessId, [string]$ExpectedLog)
  if ($ProcessId -le 0) { return $false }
  try {
    $proc = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
    if ($null -eq $proc -or $proc.Name -notmatch '^powershell(\.exe)?$') { return $false }
    $cmd = [string]$proc.CommandLine
    return ($cmd.IndexOf($ExpectedLog, [StringComparison]::OrdinalIgnoreCase) -ge 0) -and
           ($cmd -match 'npm\s+run\s+dev')
  } catch { return $false }
}

function Get-TrustedProcessId {
  param($State, [ValidateSet('backend','frontend')][string]$Role)
  if ($null -ne $State -and $State.PSObject.Properties.Name -contains $Role) {
    $entry = $State.$Role
    if (Confirm-ManagedProcess -Entry $entry) { return [int]$entry.processId }
  }
  # Backward compatibility with the original version 6 launcher.
  $legacyField = if ($Role -eq 'backend') { 'backendPid' } else { 'frontendPid' }
  $legacyLog = if ($Role -eq 'backend') { $serverLog } else { $webLog }
  if ($null -ne $State -and $State.PSObject.Properties.Name -contains $legacyField) {
    $legacyProcessId = [int]$State.$legacyField
    if (Confirm-LegacyProcess -ProcessId $legacyProcessId -ExpectedLog $legacyLog) {
      return $legacyProcessId
    }
  }
  return 0
}

function Stop-TrackedProcess {
  param([int]$ProcessId)
  if ($ProcessId -le 0) { return }
  # /T stops descendants (for example esbuild or npm's child node).
  # The root PID was checked against the saved start time or legacy command line.
  try {
    $output = & "$env:SystemRoot\System32\taskkill.exe" /PID $ProcessId /T /F 2>&1
    if ($LASTEXITCODE -ne 0) { Write-LauncherError "taskkill($ProcessId): $output" }
  } catch {
    Write-LauncherError "taskkill($ProcessId): $($_.Exception.Message)"
  }
}

function Get-PortOwners {
  param([int]$Port)
  try {
    @(
      Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
      Select-Object -ExpandProperty OwningProcess -Unique
    )
  } catch { @() }
}

function Get-ServiceStatus {
  $state = Load-State
  $backendProcessId = Get-TrustedProcessId -State $state -Role 'backend'
  $frontendProcessId = Get-TrustedProcessId -State $state -Role 'frontend'
  $backendOwners = @(Get-PortOwners -Port 5000)
  $frontendOwners = @(Get-PortOwners -Port 5173)

  if ($backendProcessId -gt 0 -and $frontendProcessId -gt 0 -and
      $backendOwners -contains $backendProcessId -and
      $frontendOwners -contains $frontendProcessId) {
    return 'Status: backend and frontend are running'
  }
  if ($backendOwners.Count -eq 0 -and $frontendOwners.Count -eq 0 -and
      $backendProcessId -eq 0 -and $frontendProcessId -eq 0) {
    return 'Status: services are stopped'
  }
  if (($backendOwners.Count -gt 0 -and $backendProcessId -eq 0) -or
      ($frontendOwners.Count -gt 0 -and $frontendProcessId -eq 0)) {
    return 'Status: ports in use by an untracked process (see logs)'
  }
  return 'Status: services are partially running (see logs)'
}

function Wait-PortsFree {
  param([int]$TimeoutSeconds = 5)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    $backendOwners = @(Get-PortOwners -Port 5000)
    $frontendOwners = @(Get-PortOwners -Port 5173)
    if ($backendOwners.Count -eq 0 -and $frontendOwners.Count -eq 0) { return $true }
    Start-Sleep -Milliseconds 200
  }
  $backendOwners = @(Get-PortOwners -Port 5000)
  $frontendOwners = @(Get-PortOwners -Port 5173)
  return ($backendOwners.Count -eq 0 -and $frontendOwners.Count -eq 0)
}

function Assert-PortsAvailable {
  foreach ($port in @(5000, 5173)) {
    $owners = @(Get-PortOwners -Port $port)
    if ($owners.Count -gt 0) {
      throw "Port $port is already in use. Other applications will not be stopped."
    }
  }
}

function Stop-Services {
  $state = Load-State
  $backendProcessId = Get-TrustedProcessId -State $state -Role 'backend'
  $frontendProcessId = Get-TrustedProcessId -State $state -Role 'frontend'
  Stop-TrackedProcess -ProcessId $frontendProcessId
  Stop-TrackedProcess -ProcessId $backendProcessId
  Save-State -Backend $null -Frontend $null
}

function Start-Services {
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'server\src\index.js'))) {
    throw 'Backend entry file is missing: server/src/index.js'
  }
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'web\node_modules\vite\bin\vite.js'))) {
    throw 'Vite is missing. Run npm install inside the web directory first.'
  }
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $nodeCommand) { throw 'Node.js is not found in PATH. Verify: node -v' }
  $nodePath = [string]$nodeCommand.Source
  $runtimeVersion = (Get-Content -LiteralPath (Join-Path $projectRoot '.node-version') -Raw).Trim()
  $portableNode = Join-Path $projectRoot ('.tools\node-v' + $runtimeVersion + '-win-x64\node.exe')
  if (Test-Path -LiteralPath $portableNode) { $nodePath = $portableNode }
  if (-not (Wait-PortsFree -TimeoutSeconds 5)) { Assert-PortsAvailable }
  Assert-PortsAvailable

  $serverRecord = $null
  $webRecord = $null
  try {
    $serverProcess = Start-Process -FilePath $nodePath `
      -ArgumentList @('src/index.js') `
      -WorkingDirectory (Join-Path $projectRoot 'server') `
      -WindowStyle Hidden `
      -RedirectStandardOutput $serverLog `
      -RedirectStandardError $serverErrorLog `
      -PassThru -ErrorAction Stop
    $serverRecord = New-ProcessRecord -Process $serverProcess
    Save-State -Backend $serverRecord -Frontend $null

    Start-Sleep -Milliseconds 600

    $webProcess = Start-Process -FilePath $nodePath `
      -ArgumentList @('node_modules/vite/bin/vite.js', '--strictPort', '--port', '5173') `
      -WorkingDirectory (Join-Path $projectRoot 'web') `
      -WindowStyle Hidden `
      -RedirectStandardOutput $webLog `
      -RedirectStandardError $webErrorLog `
      -PassThru -ErrorAction Stop
    $webRecord = New-ProcessRecord -Process $webProcess
    Save-State -Backend $serverRecord -Frontend $webRecord
  } catch {
    if (Confirm-ManagedProcess -Entry $webRecord) {
      Stop-TrackedProcess -ProcessId ([int]$webRecord.processId)
    }
    if (Confirm-ManagedProcess -Entry $serverRecord) {
      Stop-TrackedProcess -ProcessId ([int]$serverRecord.processId)
    }
    Save-State -Backend $null -Frontend $null
    throw
  }
}

function Wait-Services {
  param([int]$TimeoutSeconds = 18)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    $state = Load-State
    $backendProcessId = Get-TrustedProcessId -State $state -Role 'backend'
    $frontendProcessId = Get-TrustedProcessId -State $state -Role 'frontend'
    $backendOwners = @(Get-PortOwners -Port 5000)
    $frontendOwners = @(Get-PortOwners -Port 5173)
    if ($backendProcessId -gt 0 -and $frontendProcessId -gt 0 -and
        $backendOwners -contains $backendProcessId -and
        $frontendOwners -contains $frontendProcessId) {
      return $true
    }
    if ($backendProcessId -eq 0 -or $frontendProcessId -eq 0) { return $false }
    Start-Sleep -Milliseconds 350
    [System.Windows.Forms.Application]::DoEvents()
  }
  return $false
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'OA Smart Assistant Launcher'
$form.Size = New-Object System.Drawing.Size(650, 370)
$form.StartPosition = 'CenterScreen'
$form.BackColor = [System.Drawing.Color]::FromArgb(16, 24, 32)
$form.ForeColor = [System.Drawing.Color]::White
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false

$title = New-Object System.Windows.Forms.Label
$title.Text = 'OA Smart Assistant'
$title.Font = New-Object System.Drawing.Font('Segoe UI', 18, [System.Drawing.FontStyle]::Bold)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(24, 20)
$form.Controls.Add($title)

$desc = New-Object System.Windows.Forms.Label
$desc.Text = "Start: launch chatbot services.`nRestart: stop and launch them again.`nStop: shut down only services started by this launcher."
$desc.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$desc.AutoSize = $false
$desc.Size = New-Object System.Drawing.Size(596, 75)
$desc.Location = New-Object System.Drawing.Point(24, 70)
$form.Controls.Add($desc)

$status = New-Object System.Windows.Forms.Label
$status.Text = Get-ServiceStatus
$status.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$status.AutoSize = $false
$status.Size = New-Object System.Drawing.Size(590, 38)
$status.Location = New-Object System.Drawing.Point(24, 150)
$form.Controls.Add($status)

$startBtn = New-Object System.Windows.Forms.Button
$startBtn.Text = 'Start'
$startBtn.Font = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
$startBtn.Size = New-Object System.Drawing.Size(180, 48)
$startBtn.Location = New-Object System.Drawing.Point(24, 205)
$startBtn.BackColor = [System.Drawing.Color]::FromArgb(37, 183, 159)
$startBtn.ForeColor = [System.Drawing.Color]::Black
$startBtn.FlatStyle = 'Flat'
$form.Controls.Add($startBtn)

$restartBtn = New-Object System.Windows.Forms.Button
$restartBtn.Text = 'Restart'
$restartBtn.Font = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
$restartBtn.Size = New-Object System.Drawing.Size(180, 48)
$restartBtn.Location = New-Object System.Drawing.Point(222, 205)
$restartBtn.BackColor = [System.Drawing.Color]::FromArgb(255, 179, 71)
$restartBtn.ForeColor = [System.Drawing.Color]::Black
$restartBtn.FlatStyle = 'Flat'
$form.Controls.Add($restartBtn)

$stopBtn = New-Object System.Windows.Forms.Button
$stopBtn.Text = 'Stop'
$stopBtn.Font = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
$stopBtn.Size = New-Object System.Drawing.Size(180, 48)
$stopBtn.Location = New-Object System.Drawing.Point(420, 205)
$stopBtn.BackColor = [System.Drawing.Color]::FromArgb(224, 93, 93)
$stopBtn.ForeColor = [System.Drawing.Color]::White
$stopBtn.FlatStyle = 'Flat'
$form.Controls.Add($stopBtn)

$note = New-Object System.Windows.Forms.Label
$note.Text = 'Chat: http://localhost:5173/    Admin: http://localhost:5173/admin.html'
$note.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$note.AutoSize = $true
$note.Location = New-Object System.Drawing.Point(24, 285)
$form.Controls.Add($note)

function Set-Busy {
  param([bool]$Busy)
  $startBtn.Enabled = -not $Busy
  $restartBtn.Enabled = -not $Busy
  $stopBtn.Enabled = -not $Busy
  $form.Refresh()
}

$startBtn.Add_Click({
  Set-Busy -Busy $true
  try {
    $current = Get-ServiceStatus
    if ($current -eq 'Status: backend and frontend are running') {
      $status.Text = 'Status: already running; use Restart if needed'
    } else {
      $status.Text = 'Status: starting services...'
      $form.Refresh()
      Stop-Services
      Start-Services
      if (Wait-Services) {
        $status.Text = Get-ServiceStatus
      } else {
        Stop-Services
        $status.Text = 'Status: startup failed; check .launcher logs'
      }
    }
  } catch {
    Write-LauncherError "START: $($_.Exception.Message)"
    $status.Text = "Status: start error - $($_.Exception.Message)"
  } finally { Set-Busy -Busy $false }
})

$restartBtn.Add_Click({
  Set-Busy -Busy $true
  try {
    $status.Text = 'Status: restarting services...'
    $form.Refresh()
    Stop-Services
    Start-Sleep -Milliseconds 450
    Start-Services
    if (Wait-Services) {
      $status.Text = Get-ServiceStatus
    } else {
      Stop-Services
      $status.Text = 'Status: restart failed; check .launcher logs'
    }
  } catch {
    Write-LauncherError "RESTART: $($_.Exception.Message)"
    $status.Text = "Status: restart error - $($_.Exception.Message)"
  } finally { Set-Busy -Busy $false }
})

$stopBtn.Add_Click({
  Set-Busy -Busy $true
  try {
    $status.Text = 'Status: stopping services...'
    $form.Refresh()
    Stop-Services
    Start-Sleep -Milliseconds 350
    $status.Text = Get-ServiceStatus
  } catch {
    Write-LauncherError "STOP: $($_.Exception.Message)"
    $status.Text = "Status: stop error - $($_.Exception.Message)"
  } finally { Set-Busy -Busy $false }
})

[void]$form.ShowDialog()
