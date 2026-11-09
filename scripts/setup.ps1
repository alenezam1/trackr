# SponsorFirst setup for Windows PowerShell.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

$nodeVersion = (node --version) -replace '^v', ''
$parts = $nodeVersion.Split('.') | ForEach-Object { [int]$_ }
if ($parts[0] -lt 22 -or ($parts[0] -eq 22 -and $parts[1] -lt 13)) {
  Write-Host "Node.js 22.13 or newer is required (found $nodeVersion). Install the current LTS from https://nodejs.org/" -ForegroundColor Red
  exit 1
}

Write-Host 'Installing dependencies...' -ForegroundColor Cyan
npm install --no-audit --no-fund
if (-not $?) { exit 1 }

Write-Host 'Building the UI...' -ForegroundColor Cyan
npm run build:ui
if (-not $?) { exit 1 }

Write-Host 'Preparing the database...' -ForegroundColor Cyan
npm run db:migrate

$csv = Get-ChildItem -Path . , .\data\imports -Filter '*Worker*Register*.csv' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($csv) {
  Write-Host "Importing sponsor register: $($csv.Name)" -ForegroundColor Cyan
  npm run sponsors:import -- "$($csv.FullName)"
} else {
  Write-Host 'No sponsor CSV found here; import it from the Sponsors page or use "Refresh from official GOV.UK CSV".' -ForegroundColor Yellow
}

Write-Host "`nDone. Start the app with:  npm run dev" -ForegroundColor Green
