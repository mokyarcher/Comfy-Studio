$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Find-Python {
    $candidates = @(
        @{ Cmd = "py"; Args = @("-3.12") },
        @{ Cmd = "py"; Args = @("-3.11") },
        @{ Cmd = "py"; Args = @("-3") },
        @{ Cmd = "python"; Args = @() },
        @{ Cmd = "python3"; Args = @() }
    )
    foreach ($c in $candidates) {
        $cmd = Get-Command $c.Cmd -ErrorAction SilentlyContinue
        if (-not $cmd) { continue }
        # Skip broken Windows Store stub
        if ($cmd.Source -match "WindowsApps") { continue }
        try {
            $versionArgs = $c.Args + @("--version")
            & $c.Cmd @versionArgs | Out-Null
            if ($LASTEXITCODE -eq 0 -or $?) {
                return @{ Cmd = $c.Cmd; Args = $c.Args }
            }
        } catch {
            continue
        }
    }
    return $null
}

function Test-VenvPython {
    param([string]$VenvPython)
    if (-not (Test-Path $VenvPython)) { return $false }
    try {
        & $VenvPython --version | Out-Null
        return ($LASTEXITCODE -eq 0 -or $?)
    } catch {
        return $false
    }
}

$VenvPython = Join-Path $Root ".venv\Scripts\python.exe"
$VenvOk = Test-VenvPython $VenvPython

if (-not $VenvOk) {
    if (Test-Path ".\.venv") {
        Write-Host "Existing .venv is broken or was copied from another PC. Recreating..."
        Remove-Item -Recurse -Force ".\.venv"
    }

    $py = Find-Python
    if (-not $py) {
        Write-Host @"
ERROR: No usable Python found on this PC.

Install Python 3.11+ from https://www.python.org/downloads/
During setup, CHECK: "Add python.exe to PATH"

Then close this window, open a NEW PowerShell, and run again:
  cd $Root
  .\scripts\start_api.ps1

Do NOT copy .venv from another computer.
"@
        exit 1
    }

    Write-Host "Creating venv with: $($py.Cmd) $($py.Args -join ' ')"
    & $py.Cmd (@($py.Args) + @("-m", "venv", ".venv"))
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    & .\.venv\Scripts\python.exe -m pip install --upgrade pip
    & .\.venv\Scripts\pip.exe install -r requirements.txt
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not (Test-Path ".\.env")) {
    Copy-Item ".\.env.example" ".\.env"
    Write-Host "Created .env from .env.example — edit API_KEY before public use."
}

New-Item -ItemType Directory -Force -Path "data\images" | Out-Null

$env:PYTHONPATH = $Root
Write-Host "Starting API on http://127.0.0.1:8000 ..."
& .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
