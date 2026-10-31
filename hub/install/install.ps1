# Macaroonie venue hub: installer for a Windows mini PC (Windows 10 or 11,
# 64-bit). In PowerShell opened as administrator, with the internet on:
#
#   irm __MACAROONIE_API__/pos-api/hub/install.ps1 | iex
#
# It installs its own Node.js (in C:\ProgramData\Macaroonie\Hub\node), downloads
# the hub from the cloud (checked against its sha256), and runs it as a
# scheduled task that starts with the computer (as SYSTEM, no one needs to
# sign in) and starts again if it stops. Then it shows the six-letter code:
# link it in Store tech -> Venue hub -> Link a hub, or scan the QR code on
# the hub's page (http://<this computer>:9180) with the installer app. A
# printer installed in Windows (USB, serial, Bluetooth) can then be picked in
# Store tech as "USB on the hub". The hub updates itself afterwards.
#
# Run again on a computer that is already a hub, it says which restaurant and
# venue the hub is linked to and asks: keep it (and update it), link it to
# another restaurant or venue (it sends what the old one hasn't had yet, leaves
# it and forgets its files, then shows a new code), or remove the hub.
# Without asking: $env:MACAROONIE_HUB_CHOICE = 'keep' | 'switch' | 'remove'.
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
# Hub first: the port the tills, kiosks and kitchen screens on the venue network use.
$LanPort = 9181
$TaskName = 'Macaroonie hub'

function Fail($message) { throw "Install stopped: $message" }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Fail 'open PowerShell as administrator (right-click, Run as administrator) and run this again' }

$hubJson = Join-Path $HubHome 'hub.json'
$canAsk = [Environment]::UserInteractive -and -not [Console]::IsInputRedirected

# Stop the hub: the task, then every node.exe running from the hub's folder.
# Ending the task ends the launcher only; the hub it started keeps running
# (its ports, its link) unless it is stopped too.
function Stop-Hub {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$HubHome*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
}

function Remove-Hub {
  Stop-Hub
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Remove-NetFirewallRule -DisplayName 'Macaroonie hub status page' -ErrorAction SilentlyContinue
  Remove-NetFirewallRule -DisplayName 'Macaroonie hub for devices' -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $HubHome -ErrorAction SilentlyContinue
}

# "WingVibes, Ware (Venue hub)" from what link-info says.
function Describe-Link($info) {
  $where = @($info.tenant_name, $info.venue_name) | Where-Object { $_ }
  $text = if ($where.Count) { $where -join ', ' } else { 'its venue' }
  if ($info.name) { $text += ' (' + $info.name + ')' }
  return $text
}

# Take this computer off its venue with the hub's own unlink (src/link.js):
# what waits goes to the cloud first, then the venue's files are deleted.
# $true when done; $false when sales still wait and nobody agreed to lose them.
function Leave-Venue($node, $hubJs, $what) {
  $force = $env:MACAROONIE_HUB_FORCE -eq '1'
  for (;;) {
    $hubArgs = @($hubJs, 'unlink', '--config', $hubJson)
    if ($force) { $hubArgs += '--force' }
    $out = & $node @hubArgs | Select-Object -Last 1
    $r = $null
    try { $r = $out | ConvertFrom-Json } catch { $r = $null }
    if (-not $r) { Write-Host "  The hub couldn't leave $what." -ForegroundColor Red; return $false }
    if ($r.ok) {
      if ($r.disconnected) { Write-Host "  Left $what. Store tech there shows this hub as not linked." }
      elseif ($r.removed) { Write-Host "  $what had removed this hub already." }
      else { Write-Host "  Left $what here, but the cloud didn't answer: remove the hub in its Store tech -> Venue hub." }
      return $true
    }
    Write-Host ''
    Write-Host ("  $($r.unsent) sale(s) or change(s) from $what are still on this computer and haven't reached the cloud" + $(if ($r.error) { " ($($r.error))" } else { '' }) + '.') -ForegroundColor Yellow
    Write-Host '  Connect this computer to the internet and run the setup again: they go up first.'
    if (-not $canAsk) { return $false }
    $answer = Read-Host '  To go ahead anyway and lose them, type LOSE (anything else stops here)'
    if ($answer -cne 'LOSE') { return $false }
    $force = $true
  }
}

# The hub's own copy of node and hub.js now installed (to remove a hub cleanly).
function Installed-Hub {
  $node = Join-Path $HubHome 'node\node.exe'
  $cur = $null
  try { $cur = Get-Content -Raw (Join-Path $HubHome 'current.json') | ConvertFrom-Json } catch { $cur = $null }
  if (-not (Test-Path $node) -or -not $cur -or -not $cur.dir) { return $null }
  $hubJs = Join-Path $HubHome ($cur.dir + '/hub/bin/hub.js')
  # Hubs from before unlink existed would start running instead.
  if (-not (Test-Path $hubJs) -or -not (Select-String -Path $hubJs -SimpleMatch "'unlink'" -Quiet)) { return $null }
  return @{ node = $node; hubJs = $hubJs }
}

if ($env:MACAROONIE_HUB_UNINSTALL -eq '1') {
  Remove-Item Env:\MACAROONIE_HUB_UNINSTALL
  Write-Host 'Removing the Macaroonie hub...'
  Stop-Hub
  $installed = Installed-Hub
  if ($installed -and (Test-Path $hubJson)) {
    $what = 'its venue'
    try {
      $i = (& $installed.node $installed.hubJs link-info --config $hubJson | Select-Object -Last 1) | ConvertFrom-Json
      if ($i.linked) { $what = Describe-Link $i }
    } catch { $what = 'its venue' }
    if (-not (Leave-Venue $installed.node $installed.hubJs $what)) {
      Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
      Fail 'nothing was removed, the hub is running again'
    }
  }
  Remove-Hub
  $global:MacaroonieHubRemoved = $true
  Write-Host 'Removed.'
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
  $newHub = Join-Path $dest 'hub\bin\hub.js'
  $check = & $node $newHub --self-test
  if ($LASTEXITCODE -ne 0 -or -not ($check -match '^ok')) { Fail "the hub didn't pass its check" }

  # Already a hub here: keep it, link it to another restaurant or venue, or remove it.
  if (Test-Path $hubJson) {
    $info = $null
    try { $info = (& $node $newHub link-info --config $hubJson --api $Api | Select-Object -Last 1) | ConvertFrom-Json } catch { $info = $null }
    if ($info -and $info.linked -and $info.same_api -and $info.status -eq 'removed') {
      Write-Host ('This computer was the hub for ' + (Describe-Link $info) + ', which removed it: it shows a new code to link it again.')
    } elseif ($info -and $info.linked -and $info.same_api) {
      $what = Describe-Link $info
      $choice = "$env:MACAROONIE_HUB_CHOICE".ToLower()
      if (-not $choice) {
        Write-Host ''
        Write-Host "  This computer is already the venue hub for $what." -ForegroundColor Cyan
        if ($info.status -eq 'offline') { Write-Host "  (The cloud didn't say what it is now: that's from when it was linked.)" }
        Write-Host ''
        Write-Host "    1  Keep it for $what and update it"
        Write-Host '    2  Link it to another restaurant or venue instead'
        Write-Host '    3  Remove the hub from this computer'
        Write-Host ''
        if ($canAsk) {
          for (;;) {
            $answer = (Read-Host '  Type 1, 2 or 3 and press Enter (Enter alone keeps it)').Trim()
            if ($answer -in @('', '1')) { $choice = 'keep'; break }
            if ($answer -eq '2') { $choice = 'switch'; break }
            if ($answer -eq '3') { $choice = 'remove'; break }
          }
        } else {
          $choice = 'keep'
          Write-Host "  Kept (no one to ask). To change it: `$env:MACAROONIE_HUB_CHOICE = 'switch' or 'remove', then run this again."
        }
      }
      if ($choice -notin @('keep', 'switch', 'remove')) { Fail "MACAROONIE_HUB_CHOICE must be keep, switch or remove" }
      if ($choice -ne 'keep') {
        Stop-Hub
        if (-not (Leave-Venue $node $newHub $what)) {
          Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
          Fail "nothing changed: the hub is running again for $what"
        }
        if ($choice -eq 'remove') {
          Remove-Hub
          $global:MacaroonieHubRemoved = $true
          Write-Host 'Removed the hub from this computer.'
          return
        }
        Write-Host '  Linking it again: it shows a new code below.'
      }
    }
  }
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
    -Argument ('"' + (Join-Path $HubHome 'launcher.mjs') + '" --api ' + $Api + ' --http-port ' + $Port + ' --lan-port ' + $LanPort + ' --log-file "' + $log + '"')
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  Stop-Hub
  Remove-Item -Force (Join-Path $HubHome 'state.json') -ErrorAction SilentlyContinue
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description 'Macaroonie venue hub: prints for the tills and kitchen' -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName

  # The status page on the venue's network.
  if (-not (Get-NetFirewallRule -DisplayName 'Macaroonie hub status page' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'Macaroonie hub status page' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private, Domain | Out-Null
  }
  # And the port the venue's devices use (hub first).
  if (-not (Get-NetFirewallRule -DisplayName 'Macaroonie hub for devices' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'Macaroonie hub for devices' -Direction Inbound -Protocol TCP -LocalPort $LanPort -Action Allow -Profile Private, Domain | Out-Null
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
    Write-Host '  Link this hub: in Macaroonie open Store tech -> Venue hub -> Link a hub and type'
    Write-Host ''
    Write-Host ('        ' + $state.link.code) -ForegroundColor Green
    Write-Host ''
    if ($state.link.link_url) { Write-Host ('  or open ' + $state.link.link_url + ' on a phone.') }
  } elseif ($state -and $state.phase -eq 'running') {
    $where = @($state.tenant_name, $state.venue_name) | Where-Object { $_ }
    Write-Host ('  The hub is running and linked' + $(if ($where.Count) { ' to ' + ($where -join ', ') } else { '' }) + '. Nothing else to do.')
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

# $MacaroonieHubFailed and $MacaroonieHubRemoved tell macaroonie-hub-setup.cmd
# (pos.<domain>/hub) whether it worked, and not to open the hub's page.
$global:MacaroonieHubFailed = $false
$global:MacaroonieHubRemoved = $false
try { Install-MacaroonieHub } catch { $global:MacaroonieHubFailed = $true; Write-Host $_.Exception.Message -ForegroundColor Red }
