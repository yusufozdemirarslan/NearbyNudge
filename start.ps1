# NearbyNudge 2.0 - start everything on this computer.
#   Right-click > Run with PowerShell, or:  powershell -ExecutionPolicy Bypass -File .\start.ps1
# First run: sets up Python packages, downloads free location files and DC-area listings, builds the dashboard.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"
$py = Join-Path $backend ".venv\Scripts\python.exe"

Write-Host "NearbyNudge 2.0" -ForegroundColor Cyan

if (-not (Test-Path (Join-Path $root ".env"))) {
    Write-Host "Missing .env. Create it with a line: ANTHROPIC_API_KEY=sk-ant-..." -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $py)) {
    Write-Host "Setting up Python packages..."
    Push-Location $backend
    uv venv --python 3.14 .venv
    uv pip install --python .venv\Scripts\python.exe -e ".[dev]"
    Pop-Location
}

$data = Join-Path $root "data"
if (-not (Test-Path (Join-Path $data "listings.duckdb")) -or -not (Test-Path (Join-Path $data "gazetteer"))) {
    Write-Host "Downloading free location files and DC-area business listings (a few minutes, first run only)..."
    Push-Location $backend
    & $py -m nearbynudge setup-data --metro dc
    Pop-Location
}

if (-not (Test-Path (Join-Path $frontend "dist\index.html"))) {
    Write-Host "Building the dashboard..."
    Push-Location $frontend
    if (-not (Test-Path "node_modules")) { npm install }
    npm run build
    Pop-Location
}

Push-Location $backend
& $py -m nearbynudge status
Write-Host ""
Write-Host "Open http://localhost:8000 in your browser (the Address line above says whether it asks you to sign in)." -ForegroundColor Green
Write-Host "Press Ctrl+C to stop."
& $py -m nearbynudge serve --port 8000
Pop-Location
