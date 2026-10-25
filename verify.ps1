# NearbyNudge 2.0 - run every automated check.
#   powershell -ExecutionPolicy Bypass -File .\verify.ps1
# 1) backend tests  2) release check (outside connections)  3) dashboard typecheck + build + URL check
# 4) browser tests (Playwright + axe) against the real backend with fixture sites and a fake AI (no cost)
# 5) browser tests against the dashboard's sample data

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$py = Join-Path $root "backend\.venv\Scripts\python.exe"
$failed = @()

function Step($name, [scriptblock]$block) {
    Write-Host "`n== $name" -ForegroundColor Cyan
    & $block
    if ($LASTEXITCODE -ne 0) { $script:failed += $name; Write-Host "FAILED: $name" -ForegroundColor Red }
    else { Write-Host "OK: $name" -ForegroundColor Green }
}

Push-Location (Join-Path $root "backend")
Step "Backend tests" { & $py -m pytest -q -p no:cacheprovider }
Step "Release check" { & $py -m nearbynudge check-connections }
Pop-Location

Push-Location (Join-Path $root "frontend")
Step "Dashboard build" { npm run build }
Pop-Location

$port = 8100
$server = Start-Process -FilePath $py -ArgumentList "scripts\e2e_server.py", "--port", "$port" `
    -WorkingDirectory (Join-Path $root "backend") -PassThru -WindowStyle Hidden
try {
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        try { Invoke-WebRequest "http://localhost:$port/api/health" -UseBasicParsing -TimeoutSec 2 | Out-Null; $ready = $true; break }
        catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $ready) { throw "the test server didn't start" }
    Push-Location (Join-Path $root "frontend")
    $env:E2E_BASE_URL = "http://localhost:$port"
    Step "Browser tests" { npx playwright test }
    Remove-Item Env:E2E_BASE_URL
    Pop-Location
} finally {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
}

# 5) the same browser tests against the dashboard's built-in sample data (covers states the fake AI can't reach)
Remove-Item Env:E2E_BASE_URL -ErrorAction SilentlyContinue
Push-Location (Join-Path $root "frontend")
Step "Browser tests (sample data)" { npx playwright test }
Pop-Location

if ($failed.Count -gt 0) { Write-Host "`nFailed: $($failed -join ', ')" -ForegroundColor Red; exit 1 }
Write-Host "`nAll checks passed." -ForegroundColor Green
