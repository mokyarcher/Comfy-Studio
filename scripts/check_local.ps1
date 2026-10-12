$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "== ComfyUI =="
try {
    $stats = Invoke-RestMethod -Uri "http://127.0.0.1:8188/system_stats" -TimeoutSec 5
    Write-Host "ComfyUI OK"
} catch {
    Write-Host "ComfyUI NOT reachable at http://127.0.0.1:8188"
}

Write-Host "== Workflow files =="
foreach ($f in @("llm_workflow/workflow_api.json", "llm_workflow/workflow_mapping.json")) {
    if (Test-Path $f) { Write-Host "Found $f" } else { Write-Host "Missing $f" }
}

if (Test-Path ".\.venv\Scripts\python.exe") {
    Write-Host "== Inspect workflow =="
    & .\.venv\Scripts\python.exe scripts\inspect_workflow.py
} else {
    Write-Host "Python venv not found. Run: python -m venv .venv && .\.venv\Scripts\pip install -r requirements.txt"
}

Write-Host "== Local API =="
try {
    $ready = Invoke-RestMethod -Uri "http://127.0.0.1:8000/health/ready" -TimeoutSec 5
    Write-Host ($ready | ConvertTo-Json -Compress)
} catch {
    Write-Host "API NOT reachable at http://127.0.0.1:8000"
}
