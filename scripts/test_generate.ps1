$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Get-DotEnvValue {
    param([string]$Key)
    $envFile = Join-Path $Root ".env"
    if (-not (Test-Path $envFile)) {
        throw ".env not found. Copy .env.example to .env first."
    }
    foreach ($line in Get-Content $envFile) {
        $trim = $line.Trim()
        if (-not $trim -or $trim.StartsWith("#")) { continue }
        $parts = $trim -split "=", 2
        if ($parts.Count -eq 2 -and $parts[0].Trim() -eq $Key) {
            return $parts[1].Trim().Trim('"').Trim("'")
        }
    }
    throw "Key $Key not found in .env"
}

$ApiKey = Get-DotEnvValue "API_KEY"
$BaseUrl = "http://127.0.0.1:8000"
$OutFile = Join-Path ([Environment]::GetFolderPath("Desktop")) "comfyui-api-test.png"
$Prompt = if ($args.Count -gt 0) { ($args -join " ") } else { "a red fox in snow, cinematic lighting" }

Write-Host "1) Checking API ready..."
try {
    $ready = Invoke-RestMethod -Uri "$BaseUrl/health/ready" -TimeoutSec 10
    Write-Host ("   ready: " + ($ready | ConvertTo-Json -Compress))
} catch {
    Write-Host "ERROR: API not ready. Start it first:"
    Write-Host "  .\scripts\start_api.ps1"
    Write-Host "Also make sure ComfyUI is running."
    exit 1
}

$headers = @{
    "X-API-Key" = $ApiKey
    "Content-Type" = "application/json"
}
$bodyObj = @{
    prompt = $Prompt
    width  = 1024
    height = 1024
    steps  = 25
}
$body = $bodyObj | ConvertTo-Json

Write-Host "2) Submitting generate request..."
Write-Host ("   prompt: " + $Prompt)
try {
    $resp = Invoke-RestMethod -Method Post -Uri "$BaseUrl/v1/images/generate" -Headers $headers -Body $body
} catch {
    Write-Host "ERROR: submit failed."
    Write-Host $_.Exception.Message
    if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
    Write-Host "Check API_KEY in .env matches the running service."
    exit 1
}

$taskId = $resp.task_id
Write-Host "   task_id = $taskId"

Write-Host "3) Polling status (every 2s, max 15 min)..."
$deadline = (Get-Date).AddMinutes(15)
$final = $null
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    $status = Invoke-RestMethod -Uri "$BaseUrl/v1/tasks/$taskId" -Headers $headers
    Write-Host ("   status = " + $status.status)
    if ($status.status -eq "succeeded" -or $status.status -eq "failed") {
        $final = $status
        break
    }
}

if (-not $final) {
    Write-Host "ERROR: timed out waiting for task."
    exit 1
}

if ($final.status -ne "succeeded") {
    Write-Host "ERROR: task failed."
    Write-Host ("   error_code = " + $final.error_code)
    Write-Host ("   error_message = " + $final.error_message)
    exit 1
}

Write-Host "4) Downloading image..."
Invoke-WebRequest -Uri "$BaseUrl/v1/tasks/$taskId/images/0" -Headers $headers -OutFile $OutFile
Write-Host "DONE. Image saved to:"
Write-Host "  $OutFile"
