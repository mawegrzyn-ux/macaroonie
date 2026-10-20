@echo off
rem Macaroonie venue hub: setup for a Windows mini PC (Windows 10 or 11).
rem Download it from __MACAROONIE_API__/hub on the mini PC and double-click it.
rem Windows asks to allow changes (Yes); it then downloads the hub's
rem installer (install.ps1) from __MACAROONIE_API__, runs it, and opens the hub's
rem page with its link code. Running it again updates the hub and keeps its link.
rem To remove the hub: in a Command Prompt, run  macaroonie-hub-setup.cmd uninstall
setlocal
title Macaroonie hub setup

rem Not running as administrator: start again as administrator (Windows asks).
fltmc >nul 2>&1
if errorlevel 1 (
  echo Asking Windows for permission to install the Macaroonie hub...
  set "MACAROONIE_SETUP_FILE=%~f0"
  set "MACAROONIE_SETUP_ARG=%~1"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { if ($env:MACAROONIE_SETUP_ARG) { Start-Process -FilePath $env:MACAROONIE_SETUP_FILE -ArgumentList $env:MACAROONIE_SETUP_ARG -Verb RunAs } else { Start-Process -FilePath $env:MACAROONIE_SETUP_FILE -Verb RunAs } } catch { Write-Host 'Windows did not allow it. Open this file again and answer Yes.'; exit 1 }"
  if errorlevel 1 pause
  exit /b
)

if /i "%~1"=="uninstall" set "MACAROONIE_HUB_UNINSTALL=1"

powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $ProgressPreference = 'SilentlyContinue'; $f = Join-Path $env:TEMP 'macaroonie-hub-install.ps1'; try { Invoke-WebRequest -UseBasicParsing -Uri '__MACAROONIE_API__/pos-api/hub/install.ps1' -OutFile $f } catch { Write-Host ('Could not download the installer: ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }; & $f; Remove-Item $f -ErrorAction SilentlyContinue; if ($global:MacaroonieHubFailed) { exit 1 }"
if errorlevel 1 (
  echo.
  echo The hub was not set up. Check the internet connection and open this file again.
  pause
  exit /b 1
)

if not defined MACAROONIE_HUB_UNINSTALL (
  echo Opening the hub's page: link the hub with the code shown there.
  start "" "http://localhost:9180/"
)
echo.
pause
