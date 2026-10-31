# hub/test/windows/install-test.ps1
#
# Runs the real Windows installer on a Windows machine (GitHub's
# windows-latest, as administrator) against the stand-in cloud
# (standin.mjs, started first on $Api), and checks the hub runs as the
# Windows service:
#
#   1. install: the MacaroonieHub service runs (automatic), no scheduled task,
#      the hub shows a link code (state.json and its page on :9180)
#   2. the hub stops: the launcher starts it again; the launcher stops: the
#      service starts it again, and the old hub went with it
#   3. the service's program is killed: Windows starts the service again
#      (failure actions) and nothing of the old run is left
#   4. stopping the service leaves no hub process
#   5. installing again over it: one service, one hub
#   6. as a scheduled task ($env:MACAROONIE_HUB_RUN_AS = 'task'), then back to
#      the service (the task is removed)
#   7. a linked hub moved to another venue (choice switch): the cloud is told,
#      hub.json goes, a new code shows
#   8. uninstall: service, task, firewall rules, folder and processes gone
#
#   powershell -File hub/test/windows/install-test.ps1 -Api http://127.0.0.1:8790

param([string]$Api = 'http://127.0.0.1:8790')

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$HubHome = Join-Path $env:ProgramData 'Macaroonie\Hub'
$ServiceName = 'MacaroonieHub'
$TaskName = 'Macaroonie hub'
$script:failed = 0

function Step($text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
function Check($ok, $text) {
  if ($ok) { Write-Host "  ok   $text" -ForegroundColor Green; return }
  Write-Host "  FAIL $text" -ForegroundColor Red
  $script:failed++
  Show-Logs
}
function Wait-Until([scriptblock]$cond, [int]$seconds) {
  $until = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $until) {
    $r = $null
    try { $r = & $cond } catch { $r = $null }
    if ($r) { return $r }
    Start-Sleep -Milliseconds 500
  }
  return $null
}
# Count and index these through @(...): a function's one result reaches the
# caller as that result, not an array, and in Windows PowerShell 5.1 a CIM
# instance has no Count (it reads as nothing).
function Hub-Processes {
  @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.ExecutablePath -like "$HubHome*" })
}
function Launchers { @(Hub-Processes | Where-Object { $_.CommandLine -like '*launcher.mjs*' }) }
function Hubs { @(Hub-Processes | Where-Object { $_.CommandLine -like '*hub.js*' }) }
function State {
  try { Get-Content -Raw (Join-Path $HubHome 'state.json') | ConvertFrom-Json } catch { $null }
}
function Calls { Invoke-RestMethod -UseBasicParsing "$Api/__calls" }
function Install-Hub {
  $global:MacaroonieHubFailed = $false
  Invoke-Expression (Invoke-RestMethod -UseBasicParsing "$Api/pos-api/hub/install.ps1")
  return -not $global:MacaroonieHubFailed
}
function Show-Logs {
  foreach ($f in @('service.log', 'hub.log')) {
    $p = Join-Path $HubHome $f
    if (Test-Path $p) { Write-Host "---- $f (last 25 lines)"; Get-Content $p -Tail 25 | ForEach-Object { Write-Host "  $_" } }
  }
}

Write-Host ("PowerShell " + $PSVersionTable.PSVersion + ' (' + $PSVersionTable.PSEdition + ')')

# ---------------------------------------------------------------------------
Step '1. Install: the hub runs as the Windows service'
Check (Install-Hub) 'the installer finished'
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
Check ($svc -and $svc.Status -eq 'Running') 'the MacaroonieHub service is running'
$cim = Get-CimInstance Win32_Service -Filter "Name = '$ServiceName'"
Check ($cim.StartMode -eq 'Auto') "it starts with the computer (StartMode $($cim.StartMode))"
Check ($cim.StartName -eq 'LocalSystem') "it runs as LocalSystem ($($cim.StartName))"
Check ($cim.PathName -eq ('"' + (Join-Path $HubHome 'hub-service.exe') + '"')) "its program is hub-service.exe ($($cim.PathName))"
$failure = (& sc.exe qfailure $ServiceName) -join "`n"
Check ($failure -match 'RESTART') 'Windows starts it again when it fails (sc qfailure)'
Check (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) 'no scheduled task'
$state = Wait-Until { $s = State; if ($s -and $s.phase -eq 'linking' -and $s.link.code) { $s } } 60
Check $state 'the hub shows a link code'
if ($state) {
  $page = $null
  try { $page = (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9180/').Content } catch { $page = $null }
  Check ($page -and $page.Contains($state.link.code)) "its page on :9180 shows the code $($state.link.code)"
}
Check (@(Launchers).Count -eq 1 -and @(Hubs).Count -eq 1) "one launcher and one hub ($(@(Launchers).Count), $(@(Hubs).Count))"
Check ((Calls).pairings -ge 1) 'it asked the cloud for a code'
$svcArgs = Get-Content (Join-Path $HubHome 'service-args.txt')
Check (($svcArgs -join ' ') -match '--api http://127\.0\.0\.1:\d+ --http-port 9180 --lan-port 9181 --log-file ') "service-args.txt: $($svcArgs -join ' ')"

# ---------------------------------------------------------------------------
Step '2. The hub stops, then the launcher stops'
$hub = @(Hubs)[0]
Stop-Process -Id $hub.ProcessId -Force
$again = Wait-Until { $h = @(Hubs); if ($h.Count -eq 1 -and $h[0].ProcessId -ne $hub.ProcessId) { $h[0] } } 30
Check $again 'the launcher started the hub again'
$launcher = @(Launchers)[0]
$hub = @(Hubs)[0]
Stop-Process -Id $launcher.ProcessId -Force
$newLauncher = Wait-Until { $l = @(Launchers); if ($l.Count -eq 1 -and $l[0].ProcessId -ne $launcher.ProcessId) { $l[0] } } 30
Check $newLauncher 'the service started the launcher again'
Check (-not (Get-Process -Id $hub.ProcessId -ErrorAction SilentlyContinue)) 'the old hub went with the old launcher'
Check (Wait-Until { @(Hubs).Count -eq 1 } 30) 'one hub again'
Check ((Get-Content -Raw (Join-Path $HubHome 'service.log')) -match 'launcher stopped') 'service.log says so'

# ---------------------------------------------------------------------------
Step "3. The service's program is killed"
$before = @(Hub-Processes | ForEach-Object { $_.ProcessId })
$program = Get-CimInstance Win32_Process -Filter "Name = 'hub-service.exe'"
Check ($program) 'hub-service.exe is running'
Stop-Process -Id $program.ProcessId -Force
Check (Wait-Until { @(Hub-Processes | Where-Object { $before -contains $_.ProcessId }).Count -eq 0 } 15) 'everything it ran stopped with it (job object)'
$back = Wait-Until { $p = Get-CimInstance Win32_Process -Filter "Name = 'hub-service.exe'"; if ($p -and $p.ProcessId -ne $program.ProcessId -and @(Hubs).Count -eq 1) { $p } } 60
Check $back 'Windows started the service again and the hub runs'

# ---------------------------------------------------------------------------
Step '4. Stopping the service'
Stop-Service -Name $ServiceName -Force
Check ((Get-Service -Name $ServiceName).Status -eq 'Stopped') 'stopped'
Check (Wait-Until { @(Hub-Processes).Count -eq 0 } 10) 'no hub process left'
Start-Service -Name $ServiceName
Check (Wait-Until { @(Hubs).Count -eq 1 } 30) 'started again'

# ---------------------------------------------------------------------------
Step '5. Installing again over it'
Check (Install-Hub) 'the installer finished'
Check ((Get-Service -Name $ServiceName).Status -eq 'Running') 'the service is running'
Check (Wait-Until { @(Launchers).Count -eq 1 -and @(Hubs).Count -eq 1 } 30) 'one launcher and one hub'
Check (@(Get-CimInstance Win32_Process -Filter "Name = 'hub-service.exe'").Count -eq 1) 'one service program'

# ---------------------------------------------------------------------------
Step '6. As a scheduled task, then back to the service'
$env:MACAROONIE_HUB_RUN_AS = 'task'
Check (Install-Hub) 'the installer finished'
Remove-Item Env:\MACAROONIE_HUB_RUN_AS
Check (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) 'no service'
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Check ($task) 'the scheduled task is there'
Check (Wait-Until { @(Hubs).Count -eq 1 } 60) 'the task runs the hub'
Check (Install-Hub) 'the installer finished (service again)'
Check ((Get-Service -Name $ServiceName -ErrorAction SilentlyContinue).Status -eq 'Running') 'the service is running'
Check (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) 'the task was removed'
Check (Wait-Until { @(Launchers).Count -eq 1 -and @(Hubs).Count -eq 1 } 30) 'one launcher and one hub (the task''s were stopped)'

# ---------------------------------------------------------------------------
Step '7. A linked hub moved to another venue'
Stop-Service -Name $ServiceName -Force
$hubJson = Join-Path $HubHome 'hub.json'
$link = [ordered]@{ api = $Api; device_id = 'dev-windows'; secret = ('s' * 32); name = 'Windows test hub'; venue_name = 'Ware'; tenant_name = 'WingVibes' }
[IO.File]::WriteAllText($hubJson, ($link | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
Start-Service -Name $ServiceName
Check (Wait-Until { @(Hubs).Count -eq 1 } 30) 'the linked hub runs'
Start-Sleep -Seconds 3
$disconnects = (Calls).disconnect
$env:MACAROONIE_HUB_CHOICE = 'switch'
Check (Install-Hub) 'the installer finished (switch)'
Remove-Item Env:\MACAROONIE_HUB_CHOICE
Check ((Calls).disconnect -eq $disconnects + 1) 'the cloud was told the hub left'
$state = Wait-Until { $s = State; if ($s -and $s.phase -eq 'linking' -and $s.link.code) { $s } } 60
Check $state 'a new code shows'
$saved = $null
try { $saved = Get-Content -Raw $hubJson | ConvertFrom-Json } catch { $saved = $null }
Check (-not $saved -or -not $saved.device_id) 'hub.json holds no link'
Check ((Get-Service -Name $ServiceName).Status -eq 'Running') 'the service is running'

# ---------------------------------------------------------------------------
Step '8. Uninstall'
$env:MACAROONIE_HUB_UNINSTALL = '1'
Check (Install-Hub) 'the uninstaller finished'
Check (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) 'no service'
Check (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) 'no scheduled task'
Check (-not (Get-NetFirewallRule -DisplayName 'Macaroonie hub status page' -ErrorAction SilentlyContinue)) 'no firewall rule for the page'
Check (-not (Get-NetFirewallRule -DisplayName 'Macaroonie hub for devices' -ErrorAction SilentlyContinue)) 'no firewall rule for devices'
Check (-not (Test-Path $HubHome)) "$HubHome is gone"
Check (@(Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'hub-service.exe'" | Where-Object { $_.CommandLine -like '*Macaroonie*' }).Count -eq 0) 'no hub process left'

Write-Host ''
if ($script:failed) {
  Write-Host "$($script:failed) check(s) failed" -ForegroundColor Red
  exit 1
}
Write-Host 'All checks passed' -ForegroundColor Green
exit 0
