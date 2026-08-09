# Redeploy CarVerse to Cloudflare.  Run:  .\deploy.ps1
Set-Location $PSScriptRoot

npx wrangler whoami *> $null
if (-not $?) { npx wrangler login }

npx wrangler deploy
