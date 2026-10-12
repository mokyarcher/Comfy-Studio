$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

# Usage:
#   .\scripts\test_generate_remote.ps1 http://111.229.166.216:8080/qwen-image
#   .\scripts\test_generate_remote.ps1 http://111.229.166.216:8080/qwen-image "a cat"
#
# API_KEY is read from local .env — must match the desktop API's .env
# Or override:
#   $env:API_KEY = "your-desktop-api-key"
#   .\scripts\test_generate_remote.ps1 http://111.229.166.216:8080/qwen-image

function Get-DotEnvValue {
    param([string]$Key)
    $envFile = Join-Path $Root ".env"
    if (-not (Test-Path $envFile)) {
        throw ".env not found at $envFile"
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

function Invoke-CurlJson {
    param(
        [string]$Method = "GET",
        [string]$Url,
        [hashtable]$Headers = @{},
        [string]$Body = $null
    )
    $tmpOut = [System.IO.Path]::GetTempFileName()
    $tmpBody = $null
    try {
        $argsList = @("-sS", "--http1.1", "-w", "%{http_code}", "-o", $tmpOut, "-X", $Method)
        foreach ($k in $Headers.Keys) {
            $argsList += @("-H", "${k}: $($Headers[$k])")
        }
        if ($Body -ne $null) {
            $tmpBody = [System.IO.Path]::GetTempFileName()
            # UTF-8 no BOM
            $utf8 = New-Object System.Text.UTF8Encoding $false
            [System.IO.File]::WriteAllText($tmpBody, $Body, $utf8)
            $argsList += @("-H", "Content-Type: application/json; charset=utf-8", "--data-binary", "@$tmpBody")
        }
        $argsList += $Url
        $code = & curl.exe @argsList
        if ($LASTEXITCODE -ne 0) {
            throw "curl failed ($LASTEXITCODE): $Url"
        }
        $raw = Get-Content -Raw -Path $tmpOut
        $json = $null
        if ($raw) {
            try { $json = $raw | ConvertFrom-Json } catch { $json = $null }
        }
        return @{ Code = [int]$code; Raw = $raw; Json = $json }
    } finally {
        Remove-Item $tmpOut -ErrorAction SilentlyContinue
        if ($tmpBody) { Remove-Item $tmpBody -ErrorAction SilentlyContinue }
    }
}

if ($args.Count -lt 1) {
    Write-Host "Usage:"
    Write-Host '  .\scripts\test_generate_remote.ps1 http://111.229.166.216:8080/qwen-image'
    exit 1
}

$BaseUrl = $args[0].TrimEnd("/")
$Prompt = if ($args.Count -gt 1) { ($args[1..($args.Count - 1)] -join " ") } else { "a red fox in snow, cinematic lighting" }

if ($env:API_KEY) {
    $ApiKey = $env:API_KEY
    Write-Host "Using API_KEY from environment variable"
} else {
    $ApiKey = Get-DotEnvValue "API_KEY"
    Write-Host "Using API_KEY from .env"
}

if (-not $ApiKey -or $ApiKey -eq "change-me-to-a-long-random-string") {
    Write-Host "WARNING: API_KEY is still the default placeholder. Desktop API may reject it with 401."
}

$OutFile = Join-Path ([Environment]::GetFolderPath("Desktop")) "comfyui-api-remote.png"
$headers = @{ "X-API-Key" = $ApiKey }

Write-Host "1) Checking remote ready: $BaseUrl/health/ready"
$ready = Invoke-CurlJson -Url "$BaseUrl/health/ready"
if ($ready.Code -ne 200) {
    Write-Host "ERROR: health/ready HTTP $($ready.Code)"
    Write-Host $ready.Raw
    exit 1
}
Write-Host ("   " + $ready.Raw.Trim())

$body = (@{
    prompt = $Prompt
    width  = 1024
    height = 1024
    steps  = 25
} | ConvertTo-Json)

Write-Host "2) Submitting..."
$resp = Invoke-CurlJson -Method "POST" -Url "$BaseUrl/v1/images/generate" -Headers $headers -Body $body
if ($resp.Code -eq 401) {
    Write-Host "ERROR: HTTP 401 Invalid API key"
    Write-Host "The key in THIS machine's .env (or `$env:API_KEY) must EXACTLY match"
    Write-Host "the API_KEY in the DESKTOP .env used by start_api.ps1."
    Write-Host "Response: $($resp.Raw)"
    exit 1
}
if ($resp.Code -ne 202 -or -not $resp.Json -or -not $resp.Json.task_id) {
    Write-Host "ERROR: submit failed HTTP $($resp.Code)"
    Write-Host $resp.Raw
    exit 1
}
$taskId = $resp.Json.task_id
Write-Host "   task_id = $taskId"

Write-Host "3) Polling..."
$deadline = (Get-Date).AddMinutes(15)
$final = $null
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    $status = Invoke-CurlJson -Url "$BaseUrl/v1/tasks/$taskId" -Headers $headers
    if ($status.Code -eq 401) {
        Write-Host "ERROR: HTTP 401 while polling (API key rejected)"
        exit 1
    }
    $st = if ($status.Json) { $status.Json.status } else { "http_$($status.Code)" }
    Write-Host ("   status = " + $st)
    if ($st -eq "succeeded" -or $st -eq "failed") {
        $final = $status.Json
        break
    }
}

if (-not $final -or $final.status -ne "succeeded") {
    Write-Host "FAILED"
    if ($final) {
        Write-Host ("error_code = " + $final.error_code)
        Write-Host ("error_message = " + $final.error_message)
    }
    exit 1
}

Write-Host "4) Downloading..."
$code = & curl.exe -sS --http1.1 -w "%{http_code}" -o $OutFile -H "X-API-Key: $ApiKey" "$BaseUrl/v1/tasks/$taskId/images/0"
if ($LASTEXITCODE -ne 0 -or [int]$code -ne 200) {
    Write-Host "ERROR: download failed HTTP $code"
    exit 1
}
Write-Host "DONE: $OutFile"
