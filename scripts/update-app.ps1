# Updates the installed SponsorFirst desktop app from this folder. Your keys, jobs, tracker and settings live in
# %APPDATA%\SponsorFirst and are NOT touched. A full log is written to update-log.txt in the TRACKR folder.
#
# Fast path: if an installer newer than the source code already exists (release\SponsorFirst-*-x64.exe), it is
# installed straight away (about 10 seconds). Otherwise the installer is built first (1-3 minutes).
# The app keeps running while building and is only closed right before installing.
Set-Location (Join-Path $PSScriptRoot '..')
$log = Join-Path (Get-Location) 'update-log.txt'
Start-Transcript -Path $log -Force | Out-Null
$Host.UI.RawUI.WindowTitle = 'Updating SponsorFirst - please keep this window open'

function Fail($msg) {
  Write-Host ''
  Write-Host $msg -ForegroundColor Red
  Write-Host "Details are in $log" -ForegroundColor Yellow
  Stop-Transcript | Out-Null
  Read-Host 'Press Enter to close'
  exit 1
}

function Newest-Source {
  $items = @('server', 'src', 'electron') | Where-Object { Test-Path $_ } | ForEach-Object { Get-ChildItem $_ -Recurse -File }
  $items += Get-Item 'package.json', 'index.html' -ErrorAction SilentlyContinue
  ($items | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime
}

Write-Host ''
Write-Host ' SponsorFirst updater' -ForegroundColor Cyan
Write-Host ' Please keep this window open until it says "Updated successfully".' -ForegroundColor Yellow
Write-Host ''

$installer = Get-ChildItem .\release -Filter 'SponsorFirst-*-x64.exe' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$newestSource = Newest-Source
if ($installer -and $installer.LastWriteTime -gt $newestSource) {
  Write-Host "[1/3] An up-to-date installer is already built ($($installer.LastWriteTime)) - skipping the build." -ForegroundColor Green
} else {
  Write-Host '[1/3] Building the new version. This takes 1-3 minutes and can sit on one line' -ForegroundColor Cyan
  Write-Host '      with no new output for a while - that is normal, do not close the window.' -ForegroundColor Cyan
  Write-Host '      (SponsorFirst stays open and usable while this runs.)' -ForegroundColor Cyan
  $started = Get-Date
  cmd /c "npm run dist:installer 2>&1"
  if ($LASTEXITCODE -ne 0) { Fail 'Build failed - your installed app was not changed.' }
  $installer = Get-ChildItem .\release -Filter 'SponsorFirst-*-x64.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $installer -or $installer.LastWriteTime -lt $started) { Fail 'The new installer was not produced - your installed app was not changed.' }
  Write-Host "      Built in $([int]((Get-Date) - $started).TotalSeconds) seconds." -ForegroundColor Green
}

Write-Host '[2/3] Closing SponsorFirst and installing the new version (about 10 seconds)...' -ForegroundColor Cyan
Get-Process SponsorFirst -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3
$p = Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait -PassThru
if ($p.ExitCode -ne 0) { Fail "Installer exited with code $($p.ExitCode). Run $($installer.FullName) by double-clicking it to install manually." }

$exe = Join-Path $env:LOCALAPPDATA 'Programs\SponsorFirst\SponsorFirst.exe'
$asar = Join-Path $env:LOCALAPPDATA 'Programs\SponsorFirst\resources\app.asar'
$builtAsar = Join-Path (Get-Location) 'release\win-unpacked\resources\app.asar'
# Compare the installed app with what was built (file dates come from the build, so they can't be used).
$same = (Test-Path $asar) -and (Test-Path $builtAsar) -and ((Get-FileHash $asar).Hash -eq (Get-FileHash $builtAsar).Hash)
if (-not $same -and (Test-Path $asar) -and -not (Test-Path $builtAsar)) { $same = (Get-Item $asar).LastWriteTime -ge $installer.LastWriteTime.AddMinutes(-15) }
if (-not $same) {
  Fail "Install finished but the app files were not replaced ($asar). Double-click $($installer.FullName) to install manually."
}

Write-Host '[3/3] Starting SponsorFirst...' -ForegroundColor Cyan
Start-Process $exe
Write-Host ''
Write-Host " Updated successfully - SponsorFirst is starting (version built $($installer.LastWriteTime))." -ForegroundColor Green
Stop-Transcript | Out-Null
Start-Sleep -Seconds 6
