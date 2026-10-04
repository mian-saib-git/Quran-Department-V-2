$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendRoot = Join-Path $ProjectRoot "backend"
$VenvRoot = Join-Path $BackendRoot "venv"
$VenvPython = Join-Path $VenvRoot "Scripts\python.exe"
$Requirements = Join-Path $BackendRoot "requirements.txt"

if (-not (Test-Path $Requirements)) {
    throw "Backend requirements file was not found: $Requirements"
}

if (-not (Test-Path $VenvPython)) {
    Write-Host "Creating backend virtual environment..." -ForegroundColor Cyan

    if (Get-Command py -ErrorAction SilentlyContinue) {
        & py -3 -m venv $VenvRoot
    }
    elseif (Get-Command python -ErrorAction SilentlyContinue) {
        & python -m venv $VenvRoot
    }
    else {
        throw "Python 3 was not found. Install Python 3, then run this script again."
    }
}

if (-not (Test-Path $VenvPython)) {
    throw "The virtual environment was not created correctly: $VenvPython"
}

Write-Host "Updating pip tools..." -ForegroundColor Cyan
& $VenvPython -m pip install --upgrade pip setuptools wheel

Write-Host "Installing backend dependencies..." -ForegroundColor Cyan
& $VenvPython -m pip install -r $Requirements

Write-Host "Checking imports used by the project..." -ForegroundColor Cyan
& $VenvPython -c "import django, rest_framework, rest_framework_simplejwt, dotenv, cryptography, channels, daphne; print('Required backend imports are available.')"

Write-Host "Running Django system checks..." -ForegroundColor Cyan
Push-Location $BackendRoot
try {
    & $VenvPython manage.py check
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "Backend environment setup completed." -ForegroundColor Green
Write-Host "Interpreter: backend\venv\Scripts\python.exe"
Write-Host "In VS Code, run 'Developer: Reload Window' if the Problems panel does not refresh."
