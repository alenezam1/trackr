@echo off
rem Double-click to rebuild and update the installed SponsorFirst app. Your data and keys are kept.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update-app.ps1"
