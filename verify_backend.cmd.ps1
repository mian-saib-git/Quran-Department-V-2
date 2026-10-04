$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendRoot = Join-Path $ProjectRoot "backend"
$Python = Join-Path $BackendRoot "venv\Scripts\python.exe"

if (-not (Test-Path $Python)) {
    throw "Backend interpreter was not found: $Python"
}

Write-Host "Compiling backend Python files..." -ForegroundColor Cyan
& $Python -m compileall -q -x "[\\/]venv[\\/]" $BackendRoot
if ($LASTEXITCODE -ne 0) { throw "Python compilation failed." }

Write-Host "Running Django system checks..." -ForegroundColor Cyan
Push-Location $BackendRoot
try {
    & $Python manage.py check
    if ($LASTEXITCODE -ne 0) { throw "Django system check failed." }
}
finally {
    Pop-Location
}

Write-Host "Backend verification completed successfully." -ForegroundColor Green
Write-Host "Reload VS Code so Pylance reads the updated project configuration."
