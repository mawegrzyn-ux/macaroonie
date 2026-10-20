# Macaroonie venue hub: installer for a Windows mini PC (Windows 10 or 11,
# 64-bit). In PowerShell opened as administrator, with the internet on:
#
#   irm __MACAROONIE_API__/pos-api/hub/install.ps1 | iex
#
# It installs its own Node.js (in C:\ProgramData\Macaroonie\Hub\node), downloads
# the hub from the cloud (checked against its sha256), and runs it as a
# scheduled task that starts with the computer (as SYSTEM, no one needs to
# sign in) and starts again if it stops. Then it shows the six-letter code:
# link it in Till setup -> Printers -> Link a hub, or scan the QR code on
# the hub's page (http://<this computer>:9180) with the installer app. A
# printer installed in Windows (USB, serial, Bluetooth) can then be picked in
# Till setup as "USB on the hub". Running it again updates the hub and keeps
# its link. The hub updates itself afterwards.
#
# To remove it:
#   $env:MACAROONIE_HUB_UNINSTALL = '1'; irm __MACAROONIE_API__/pos-api/hub/install.ps1 | iex
#
# (Everything is in a function: an error or the end returns to the prompt
# instead of closing the window.)

function Install-MacaroonieHub {
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Api = if ($env:MACAROONIE_API) { $env:MACAROONIE_API } else { '__MACAROONIE_API__' }
$HubHome = if ($env:MACAROONIE_HUB_HOME) { $env:MACAROONIE_HUB_HOME } else { Join-Path $env:ProgramData 'Macaroonie\Hub' }
$NodeDist = if ($env:MACAROONIE_NODE_DIST) { $env:MACAROONIE_NODE_DIST } else { 'https://nodejs.org/dist/latest-v22.x' }
$Port = 9180
$TaskName = 'Macaroonie hub'

function Fail($message) { throw "Install stopped: $message" }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Fail 'open PowerShell as administrator (right-click, Run as administrator) and run this again' }

if ($env:MACAROONIE_HUB_UNINSTALL -eq '1') {
  Remove-Item Env:\MACAROONIE_HUB_UNINSTALL
  Write-Host 'Removing the Macaroonie hub...'
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$HubHome*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Remove-NetFirewallRule -DisplayName 'Macaroonie hub status page' -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $HubHome -ErrorAction SilentlyContinue
  Write-Host 'Removed. Remove the hub in Till setup -> Printers too.'
  return
}

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
if (-not [Environment]::Is64BitOperatingSystem) { Fail 'the hub needs 64-bit Windows' }
if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) { Fail 'tar.exe is missing: update Windows (it comes with Windows 10 1803 and later)' }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('macaroonie-hub-' + [Guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $tmp, $HubHome | Out-Null

try {
  # 1. Node.js, the hub's own copy.
  $node = Join-Path $HubHome 'node\node.exe'
  $have = 0
  if (Test-Path $node) { try { $have = [int](& $node -p "process.versions.node.split('.')[0]") } catch { $have = 0 } }
  if ($have -lt 22) {
    Write-Host "Downloading Node.js 22 for win-$arch..."
    $sums = (Invoke-WebRequest -UseBasicParsing "$NodeDist/SHASUMS256.txt").Content
    $line = ($sums -split "`n") | Where-Object { $_ -match "node-v[0-9.]+-win-$arch\.zip$" } | Select-Object -First 1
    if (-not $line) { Fail "no Node.js 22 for win-$arch" }
    $expected, $file = ($line.Trim() -split '\s+')
    $zip = Join-Path $tmp $file
    Invoke-WebRequest -UseBasicParsing "$NodeDist/$file" -OutFile $zip
    if ((Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower() -ne $expected.ToLower()) { Fail "the Node.js download doesn't match its checksum" }
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $unpacked = Join-Path $tmp ([IO.Path]::GetFileNameWithoutExtension($file))
    $nodeDir = Join-Path $HubHome 'node'
    if (Test-Path $nodeDir) { Remove-Item -Recurse -Force $nodeDir }
    Move-Item $unpacked $nodeDir
  }
  Write-Host ('Node.js ' + (& $node -v))

  # 2. The hub, from the cloud.
  Write-Host "Downloading the hub from $Api..."
  $release = Invoke-RestMethod -UseBasicParsing "$Api/pos-api/hub/release"
  $tgz = Join-Path $tmp 'hub.tgz'
  Invoke-WebRequest -UseBasicParsing "$Api/pos-api/hub/release.tgz" -OutFile $tgz
  if ((Get-FileHash -Algorithm SHA256 $tgz).Hash.ToLower() -ne $release.sha256) { Fail "the hub download doesn't match its checksum: run this again" }
  $dir = 'releases\' + ($release.version -replace '[^A-Za-z0-9._-]', '_')
  $dest = Join-Path $HubHome $dir
  if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  & tar.exe -xzf $tgz -C $dest
  if ($LASTEXITCODE -ne 0) { Fail "couldn't unpack the hub" }
  $check = & $node (Join-Path $dest 'hub\bin\hub.js') --self-test
  if ($LASTEXITCODE -ne 0 -or -not ($check -match '^ok')) { Fail "the hub didn't pass its check" }
  Copy-Item -Force (Join-Path $dest 'hub\bin\launcher.js') (Join-Path $HubHome 'launcher.mjs')

  $currentFile = Join-Path $HubHome 'current.json'
  $cur = $null
  if (Test-Path $currentFile) { try { $cur = Get-Content -Raw $currentFile | ConvertFrom-Json } catch { $cur = $null } }
  $relDir = $dir -replace '\\', '/'
  $previous = $null
  if ($cur -and $cur.version -and $cur.dir -and $cur.dir -ne $relDir) { $previous = @{ version = $cur.version; dir = $cur.dir } }
  elseif ($cur -and $cur.previous) { $previous = $cur.previous }
  $bad = @()
  if ($cur -and $cur.bad_versions) { $bad = @($cur.bad_versions | Where-Object { $_ -ne $release.version }) }
  $next = [ordered]@{ version = $release.version; dir = $relDir; previous = $previous; bad_versions = $bad; updated_at = (Get-Date).ToUniversalTime().ToString('o') }
  [IO.File]::WriteAllText($currentFile, ($next | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding $false))
  Write-Host "Hub $($release.version) installed in $HubHome"

  # 3. The scheduled task: at start-up, as SYSTEM, started again if it stops.
  $log = Join-Path $HubHome 'hub.log'
  $action = New-ScheduledTaskAction -Execute $node -WorkingDirectory $HubHome `
    -Argument ('"' + (Join-Path $HubHome 'launcher.mjs') + '" --api ' + $Api + ' --http-port ' + $Port + ' --log-file "' + $log + '"')
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$HubHome*launcher*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Remove-Item -Force (Join-Path $HubHome 'state.json') -ErrorAction SilentlyContinue
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description 'Macaroonie venue hub: prints for the tills and kitchen' -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName

  # The status page on the venue's network.
  if (-not (Get-NetFirewallRule -DisplayName 'Macaroonie hub status page' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'Macaroonie hub status page' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private, Domain | Out-Null
  }

  # 4. The code to link it (or that it is linked already).
  Write-Host 'Starting the hub...'
  $stateFile = Join-Path $HubHome 'state.json'
  $state = $null
  for ($i = 0; $i -lt 40; $i++) {
    if (Test-Path $stateFile) {
      try { $state = Get-Content -Raw $stateFile | ConvertFrom-Json } catch { $state = $null }
      if ($state -and (($state.phase -eq 'linking' -and $state.link.code) -or $state.phase -eq 'running')) { break }
    }
    Start-Sleep -Seconds 1
  }
  Write-Host ''
  if ($state -and $state.phase -eq 'linking') {
    Write-Host '  Link this hub: in Macaroonie open Till setup -> Printers -> Link a hub and type'
    Write-Host ''
    Write-Host ('        ' + $state.link.code) -ForegroundColor Green
    Write-Host ''
    if ($state.link.link_url) { Write-Host ('  or open ' + $state.link.link_url + ' on a phone.') }
  } elseif ($state -and $state.phase -eq 'running') {
    Write-Host '  The hub is running and linked. Nothing else to do.'
  } else {
    Write-Host "  The hub didn't start in time. See what it says in $log"
  }
  Write-Host ''
  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    ForEach-Object { Write-Host "  Its page on the venue's network: http://$($_.IPAddress):$Port" }
  Write-Host "  Its log: $log"
  Write-Host ''
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
}

# $MacaroonieHubFailed tells macaroonie-hub-setup.cmd (pos.<domain>/hub) whether it worked.
$global:MacaroonieHubFailed = $false
try { Install-MacaroonieHub } catch { $global:MacaroonieHubFailed = $true; Write-Host $_.Exception.Message -ForegroundColor Red }
