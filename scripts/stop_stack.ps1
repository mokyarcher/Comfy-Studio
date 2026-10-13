# Stop Studio / FastAPI / frpc. Does NOT kill ComfyUI by default.

$ErrorActionPreference = "Continue"
$KillComfyUi = $false
if ($args -contains "-KillComfyUi") { $KillComfyUi = $true }

# Studio
Get-Process -Name "Comfy Studio" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "Stopping Studio pid=$($_.Id)"
    Stop-Process -Id $_.Id -Force
}

# frpc
Get-Process -Name "frpc" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "Stopping frpc pid=$($_.Id)"
    Stop-Process -Id $_.Id -Force
}

# uvicorn / start_api window processes bound to this repo are hard to target;
# kill python that runs uvicorn app.main:app
Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    $cmd = $_.CommandLine
    if ($cmd -and ($cmd -match "uvicorn\s+app\.main:app" -or $cmd -match "uvicorn\.exe.*app\.main:app")) {
        Write-Host "Stopping API python pid=$($_.ProcessId)"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

if ($KillComfyUi) {
    Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
        $cmd = $_.CommandLine
        if ($cmd -and $cmd -match "main\.py" -and $cmd -match "8188") {
            Write-Host "Stopping ComfyUI python pid=$($_.ProcessId)"
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
} else {
    Write-Host "ComfyUI left running (pass -KillComfyUi to stop it)."
}

Write-Host "Done."
