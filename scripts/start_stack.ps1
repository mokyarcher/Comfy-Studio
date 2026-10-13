# One-click local stack: ComfyUI → FastAPI → frpc → Studio
# Copy scripts/stack.local.example.json → scripts/stack.local.json and edit paths.
# Friend wzx: point frpcConfig to frpc.wzx.toml (remotePort 18001).

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$configPath = Join-Path $PSScriptRoot "stack.local.json"
$examplePath = Join-Path $PSScriptRoot "stack.local.example.json"
if (-not (Test-Path $configPath)) {
    if (Test-Path $examplePath) {
        Copy-Item $examplePath $configPath
        Write-Host "Created scripts/stack.local.json from example — edit paths, then run again."
        exit 1
    }
    Write-Host "Missing scripts/stack.local.json"
    exit 1
}

$cfg = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json

function Test-HttpOk([string]$Url, [int]$TimeoutSec = 3) {
    try {
        $null = Invoke-RestMethod -Uri $Url -TimeoutSec $TimeoutSec
        return $true
    } catch {
        return $false
    }
}

function Wait-HttpOk([string]$Url, [string]$Label, [int]$Seconds = 120) {
    Write-Host "Waiting for $Label ($Url) ..."
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-HttpOk $Url) {
            Write-Host "OK: $Label"
            return
        }
        Start-Sleep -Seconds 2
    }
    throw "Timeout waiting for $Label"
}

# --- ComfyUI ---
if (-not $cfg.skipComfyUi) {
    if (Test-HttpOk "http://127.0.0.1:8188/system_stats") {
        Write-Host "ComfyUI already up."
    } else {
        $comfyDir = [string]$cfg.comfyUiDir
        $launch = [string]$cfg.comfyUiLaunch
        if (-not $comfyDir -or -not (Test-Path $comfyDir)) {
            throw "comfyUiDir not found: $comfyDir (edit scripts/stack.local.json)"
        }
        Write-Host "Starting ComfyUI in new window: $comfyDir"
        Start-Process -FilePath "powershell.exe" -WorkingDirectory $comfyDir -ArgumentList @(
            "-NoExit", "-Command", $launch
        )
        Wait-HttpOk "http://127.0.0.1:8188/system_stats" "ComfyUI" 180
    }
} else {
    Write-Host "skipComfyUi=true"
}

# --- FastAPI ---
if (-not $cfg.skipApi) {
    if (Test-HttpOk "http://127.0.0.1:8000/health/live") {
        Write-Host "API already up."
    } else {
        Write-Host "Starting API in new window ..."
        $apiCmd = @"
`$ErrorActionPreference='Stop'
Set-Location '$Root'
& '$Root\scripts\start_api.ps1'
"@
        Start-Process -FilePath "powershell.exe" -WorkingDirectory $Root -ArgumentList @(
            "-NoExit", "-Command", $apiCmd
        )
        Wait-HttpOk "http://127.0.0.1:8000/health/ready" "API ready" 120
    }
} else {
    Write-Host "skipApi=true"
}

# --- frpc ---
if (-not $cfg.skipFrpc) {
    $frpcExe = [string]$cfg.frpcExe
    $frpcConfig = [string]$cfg.frpcConfig
    if (-not $frpcExe -or -not (Test-Path $frpcExe)) {
        throw "frpcExe not found: $frpcExe"
    }
    if (-not $frpcConfig -or -not (Test-Path $frpcConfig)) {
        throw "frpcConfig not found: $frpcConfig"
    }
    $existing = Get-CimInstance Win32_Process -Filter "Name='frpc.exe'" -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "frpc already running (pid=$($existing.ProcessId)). Skip start."
    } else {
        Write-Host "Starting frpc: $frpcExe -c $frpcConfig"
        Start-Process -FilePath $frpcExe -ArgumentList @("-c", $frpcConfig) -WorkingDirectory (Split-Path $frpcExe)
        Start-Sleep -Seconds 2
    }
} else {
    Write-Host "skipFrpc=true"
}

# --- Studio ---
if (-not $cfg.skipStudio) {
    $studioExe = [string]$cfg.studioExe
    if (-not [System.IO.Path]::IsPathRooted($studioExe)) {
        $studioExe = Join-Path $Root $studioExe
    }
    $studioRunning = Get-Process -Name "Comfy Studio" -ErrorAction SilentlyContinue
    if ($studioRunning) {
        Write-Host "Studio already running."
    } elseif (-not $studioExe -or -not (Test-Path $studioExe)) {
        Write-Host "WARN: studioExe not found: $studioExe (skip Studio)"
    } else {
        Write-Host "Starting Studio: $studioExe"
        Start-Process -FilePath $studioExe
    }
} else {
    Write-Host "skipStudio=true"
}

Write-Host ""
Write-Host "Stack ready."
Write-Host "  Local:  http://127.0.0.1:8000/health/ready"
Write-Host "  Stop:   .\scripts\stop_stack.ps1"
Write-Host "  Check:  .\scripts\check_local.ps1"
