# Start automation-api (8081) and web (4200) together.
# Requires: pnpm install, .env at repo root (see .env.example)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Test-Path ".env")) {
  Write-Warning ".env not found. Copy .env.example to .env if the API fails to start."
}

Write-Host "API:  http://127.0.0.1:8081  (Swagger: /docs)"
Write-Host "Web:  http://127.0.0.1:4200  (proxies /api -> API)"
Write-Host ""
Write-Host "Starting both services (Ctrl+C to stop)..."
pnpm run dev
