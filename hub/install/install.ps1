# Macaroonie venue hub: installer for a Windows mini PC (Windows 10 or 11,
# 64-bit). In PowerShell opened as administrator, with the internet on:
#
#   irm __MACAROONIE_API__/pos-api/hub/install.ps1 | iex
#
# It installs its own Node.js (in C:\ProgramData\Macaroonie\Hub\node), downloads
# the hub from the cloud (checked against its sha256), and runs it as the
# Windows service "Macaroonie hub" (MacaroonieHub): it starts with the
# computer as LocalSystem (no one needs to sign in), and Windows starts it
# again if it stops. The service is a small program compiled here, with the
# C# compiler Windows comes with, from the source at the end of this file
# (hub/install/HubService.cs): nothing else is downloaded and there is
# nothing to sign. Where Windows won't run it, the hub runs as a scheduled
# task instead (as before); $env:MACAROONIE_HUB_RUN_AS = 'task' asks for that.
# It also keeps the computer from sleeping on mains power and its USB
# printers powered ($env:MACAROONIE_HUB_POWER = 'leave' doesn't).
#
# Then it shows the six-letter code: link it in Store tech -> Venue hub ->
# Link a hub, or scan the QR code on the hub's page (http://<this computer>:9180)
# with the installer app. A printer installed in Windows (USB, serial,
# Bluetooth) can then be picked in Store tech as "USB on the hub". The hub
# updates itself afterwards.
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
$ServiceName = 'MacaroonieHub'
$ServiceExe = Join-Path $HubHome 'hub-service.exe'

function Fail($message) { throw "Install stopped: $message" }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Fail 'open PowerShell as administrator (right-click, Run as administrator) and run this again' }

$hubJson = Join-Path $HubHome 'hub.json'
$canAsk = [Environment]::UserInteractive -and -not [Console]::IsInputRedirected

# Stop the hub: the service (or the scheduled task of hubs installed before
# the service), then anything of the hub's still running. The service stops
# everything it started (a job object); ending the task ends the launcher only,
# and the hub it started would keep running (its ports, its link).
function Stop-Hub {
  if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
  }
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'hub-service.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$HubHome*" -or $_.ExecutablePath -like "$HubHome*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
}

# Start it again however it is installed (after a refused change).
function Start-Hub {
  if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) { Start-Service -Name $ServiceName -ErrorAction SilentlyContinue }
  else { Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }
}

function Remove-HubService {
  if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    $null = & sc.exe delete $ServiceName
    for ($i = 0; $i -lt 10 -and (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
  }
}

function Remove-Hub {
  Stop-Hub
  Remove-HubService
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Remove-NetFirewallRule -DisplayName 'Macaroonie hub status page' -ErrorAction SilentlyContinue
  Remove-NetFirewallRule -DisplayName 'Macaroonie hub for devices' -ErrorAction SilentlyContinue
  # The service's program can take a moment to let go of its file.
  for ($i = 0; $i -lt 5 -and (Test-Path $HubHome); $i++) {
    Remove-Item -Recurse -Force $HubHome -ErrorAction SilentlyContinue
    if (Test-Path $HubHome) { Start-Sleep -Seconds 1 }
  }
  if (Test-Path $HubHome) { Write-Host "  Couldn't delete everything in ${HubHome}: delete it after a restart." -ForegroundColor Yellow }
}

# The hub as the Windows service: compile hub-service.exe from the source at
# the end of this file with Windows' own C# compiler (.NET Framework 4), then
# register it (or update it) and start it. Throws when any of it fails.
function Install-HubService($hubArgs) {
  $source = $global:MacaroonieHubServiceSource
  if (-not $source -or $source -notmatch 'class HubService') {
    $beside = if ($PSScriptRoot) { Join-Path $PSScriptRoot 'HubService.cs' } else { $null }
    if ($beside -and (Test-Path $beside)) { $source = Get-Content -Raw $beside }
    else { throw 'this copy of the installer has no service in it' }
  }
  $csc = @('Framework64', 'FrameworkArm64', 'Framework') |
    ForEach-Object { Join-Path $env:WINDIR "Microsoft.NET\$_\v4.0.30319\csc.exe" } |
    Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $csc) { throw "Windows' C# compiler (.NET Framework 4) isn't on this computer" }
  $cs = Join-Path $HubHome 'hub-service.cs'
  [IO.File]::WriteAllText($cs, $source, (New-Object Text.UTF8Encoding $false))
  Remove-Item -Force $ServiceExe -ErrorAction SilentlyContinue
  # A native program's messages must not stop the install (Windows PowerShell
  # turns them into errors when $ErrorActionPreference is Stop).
  $ErrorActionPreference = 'Continue'
  $out = & $csc /nologo /target:exe /optimize+ "/out:$ServiceExe" /r:System.ServiceProcess.dll $cs 2>&1
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $ServiceExe)) { throw ("the service didn't compile: " + (($out | Out-String).Trim())) }
  [IO.File]::WriteAllLines((Join-Path $HubHome 'service-args.txt'), [string[]]$hubArgs, (New-Object Text.UTF8Encoding $false))

  $binPath = '"' + $ServiceExe + '"'
  $existing = Get-CimInstance Win32_Service -Filter "Name = '$ServiceName'" -ErrorAction SilentlyContinue
  if ($existing) {
    if ($existing.PathName -ne $binPath -or $existing.StartMode -ne 'Auto') {
      $r = Invoke-CimMethod -InputObject $existing -MethodName Change -Arguments @{ PathName = $binPath; StartMode = 'Automatic' } -ErrorAction Stop
      if ($r.ReturnValue -ne 0) { throw "Windows didn't update the service (error $($r.ReturnValue))" }
    }
  } else {
    New-Service -Name $ServiceName -BinaryPathName $binPath -DisplayName 'Macaroonie hub' -StartupType Automatic `
      -Description 'Macaroonie venue hub: prints for the tills and kitchen, and keeps the venue trading without the internet' -ErrorAction Stop | Out-Null
  }
  # Windows starts it again if it fails: after 5 s, 10 s, then every 30 s; the count starts over after a day.
  $null = & sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/10000/restart/30000
  $null = & sc.exe failureflag $ServiceName 1
  Start-Service -Name $ServiceName -ErrorAction Stop
  (Get-Service -Name $ServiceName).WaitForStatus('Running', (New-TimeSpan -Seconds 20))
}

# The hub as a scheduled task (before the service, and where Windows won't run it).
function Install-HubTask($hubArgs) {
  $node = Join-Path $HubHome 'node\node.exe'
  $quoted = $hubArgs | ForEach-Object { if ($_ -match '[\s"]') { '"' + $_ + '"' } else { $_ } }
  $action = New-ScheduledTaskAction -Execute $node -WorkingDirectory $HubHome `
    -Argument ((@('"' + (Join-Path $HubHome 'launcher.mjs') + '"') + @($quoted)) -join ' ')
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description 'Macaroonie venue hub: prints for the tills and kitchen' -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName
}

# A hub must stay awake: no sleep or hibernation on mains power, and USB
# printers kept powered (USB selective suspend off).
function Set-HubPower {
  if ($env:MACAROONIE_HUB_POWER -eq 'leave') { return }
  $ErrorActionPreference = 'Continue'
  $null = & powercfg.exe /change standby-timeout-ac 0
  $null = & powercfg.exe /change hibernate-timeout-ac 0
  $null = & powercfg.exe /setacvalueindex SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0
  $null = & powercfg.exe /setactive SCHEME_CURRENT
  Write-Host 'Power: this computer no longer sleeps on mains power, and keeps its USB printers powered.'
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
      Start-Hub
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
    # Not Expand-Archive: in Windows PowerShell 5.1 it takes many minutes
    # over Node's thousands of files (its progress bar).
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $tmp)
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
          Start-Hub
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

  # 3. Run it: the Windows service (or, where Windows won't, the scheduled task).
  $log = Join-Path $HubHome 'hub.log'
  $hubArgs = @('--api', $Api, '--http-port', "$Port", '--lan-port', "$LanPort", '--log-file', $log)
  Stop-Hub
  Remove-Item -Force (Join-Path $HubHome 'state.json') -ErrorAction SilentlyContinue
  $runAs = if ($env:MACAROONIE_HUB_RUN_AS -eq 'task') { 'task' } else { 'service' }
  if ($runAs -eq 'service') {
    try {
      Install-HubService $hubArgs
      # Hubs installed before the service ran as a scheduled task.
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    } catch {
      Write-Host ("  The hub couldn't run as a Windows service (" + $_.Exception.Message + "): it runs as a scheduled task instead.") -ForegroundColor Yellow
      Remove-HubService
      $runAs = 'task'
    }
  }
  if ($runAs -eq 'task') {
    Remove-HubService
    Install-HubTask $hubArgs
  }
  Set-HubPower

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
  if ($runAs -eq 'service') { Write-Host "  It runs as the Windows service 'Macaroonie hub' (in Services), starting with the computer." }
  else { Write-Host "  It runs as the scheduled task 'Macaroonie hub', starting with the computer." }
  Write-Host "  Its log: $log"
  Write-Host ''
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
}

# The Windows service's program (hub/install/HubService.cs), compiled here.
# The API puts the file in when it serves this installer.
$global:MacaroonieHubServiceSource = @'
__MACAROONIE_HUB_SERVICE_CS__
'@

# $MacaroonieHubFailed and $MacaroonieHubRemoved tell macaroonie-hub-setup.cmd
# (pos.<domain>/hub) whether it worked, and not to open the hub's page.
$global:MacaroonieHubFailed = $false
$global:MacaroonieHubRemoved = $false
try { Install-MacaroonieHub } catch { $global:MacaroonieHubFailed = $true; Write-Host $_.Exception.Message -ForegroundColor Red }
