# Redeploy CarVerse to Cloudflare.  Run:  .\deploy.ps1
Set-Location (Split-Path $PSScriptRoot -Parent)   # repo root, one level up

npx wrangler whoami *> $null
if (-not $?) { npx wrangler login }

npx wrangler deploy
