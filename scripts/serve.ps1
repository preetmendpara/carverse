# Serve the site locally.  Run:  .\serve.ps1   (Ctrl+C to stop)
# Uses a fresh port each run so the browser can't serve a stale CSS/JS bundle.
param([int]$Port = 0)

Set-Location (Split-Path $PSScriptRoot -Parent)   # repo root, one level up

if ($Port -eq 0) { $Port = Get-Random -Minimum 8100 -Maximum 8999 }

$url = "http://localhost:$Port/app/"
Write-Host ""
Write-Host "  CarVerse -> $url" -ForegroundColor Green
Write-Host "  Ctrl+C to stop" -ForegroundColor DarkGray
Write-Host ""

Start-Process $url
python -m http.server $Port --directory public
