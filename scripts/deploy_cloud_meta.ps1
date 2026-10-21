# Deploy cloud Meta data plane + split nginx for Web Studio.
# Requires: SSH key authorized for root@111.229.166.216
#
#   .\scripts\deploy_cloud_meta.ps1
#   .\scripts\deploy_cloud_meta.ps1 -InstanceId qwen-image -SshKey $env:USERPROFILE\.ssh\id_ed25519_comfy_studio
#
# .env policy: NEVER replace an existing remote .env wholesale.
# - First install (no remote .env): write defaults (+ API_KEY from -ApiKey / local .env)
# - Redeploy: only append missing keys; keep API_KEY / POLISH_* / MAIL_* / ADMIN_* / SMS_* as-is

param(
  [string]$HostName = "111.229.166.216",
  [string]$User = "root",
  [string]$InstanceId = "qwen-image",
  [string]$MetaPort = "8101",
  [string]$SshKey = "$env:USERPROFILE\.ssh\id_ed25519_comfy_studio",
  [string]$RemoteRoot = "/opt/comfy-studio-meta",
  [string]$ApiKey = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ssh = @("-i", $SshKey, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=accept-new")
$target = "${User}@${HostName}"

Write-Host "==> SSH check $target"
& ssh @ssh $target "uname -a"
if ($LASTEXITCODE -ne 0) {
  throw "SSH failed. Add $($SshKey).pub to root authorized_keys on $HostName"
}

# Remote already has .env? Then we do not need a local API_KEY for redeploy.
$remoteHasEnv = $false
& ssh @ssh $target "test -f $RemoteRoot/.env"
if ($LASTEXITCODE -eq 0) { $remoteHasEnv = $true }

if (-not $remoteHasEnv) {
  if (-not $ApiKey) {
    $envPath = Join-Path $RepoRoot ".env"
    if (Test-Path $envPath) {
      $line = Get-Content $envPath | Where-Object { $_ -match '^\s*API_KEY\s*=' } | Select-Object -First 1
      if ($line) { $ApiKey = ($line -split '=', 2)[1].Trim().Trim('"').Trim("'") }
    }
  }
  if (-not $ApiKey) {
    throw "First Meta install needs -ApiKey or API_KEY in local .env (remote $RemoteRoot/.env missing)"
  }
}

$staging = Join-Path $env:TEMP "comfy-studio-meta-deploy"
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Force -Path $staging | Out-Null

# App payload (no .venv / data / node_modules / live .env)
$paths = @("app", "requirements.txt", "llm_workflow", "scripts/migrate_data_to_instance.py")
foreach ($p in $paths) {
  $src = Join-Path $RepoRoot $p
  if (-not (Test-Path $src)) { throw "missing $src" }
}
Copy-Item -Recurse (Join-Path $RepoRoot "app") (Join-Path $staging "app")
Copy-Item (Join-Path $RepoRoot "requirements.txt") (Join-Path $staging "requirements.txt")
if (Test-Path (Join-Path $RepoRoot "llm_workflow")) {
  Copy-Item -Recurse (Join-Path $RepoRoot "llm_workflow") (Join-Path $staging "llm_workflow")
}
New-Item -ItemType Directory -Force -Path (Join-Path $staging "scripts") | Out-Null
Copy-Item (Join-Path $RepoRoot "scripts\migrate_data_to_instance.py") (Join-Path $staging "scripts\migrate_data_to_instance.py")
Copy-Item (Join-Path $RepoRoot "deploy\comfy-studio-app.split.nginx.conf") (Join-Path $staging "comfy-studio-app.split.nginx.conf")

# Defaults only — never scp'd as live .env
$apiKeyLine = if ($ApiKey) { "API_KEY=$ApiKey" } else { "API_KEY=" }
$envDefaults = @"
HOST=127.0.0.1
PORT=$MetaPort
INSTANCE_ID=$InstanceId
ENABLE_GENERATION=false
ENABLE_DOCS=false
$apiKeyLine
CORS_ORIGINS=https://comfy-studio.sharex.team,https://app.comfy-studio.sharex.team,https://comfy-gateway.sharex.team,http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174
HOST_SERVICES_ENABLED=false
MAIL_DRY_RUN=true
"@
Set-Content -Path (Join-Path $staging ".env.defaults") -Value $envDefaults -Encoding utf8

Write-Host "==> Upload to $RemoteRoot (no live .env in payload)"
& ssh @ssh $target "mkdir -p $RemoteRoot"
& scp @ssh -r "$staging\*" "${target}:${RemoteRoot}/"
if ($LASTEXITCODE -ne 0) { throw "scp failed" }

$remoteSetup = @"
set -e
cd $RemoteRoot

# Merge .env.defaults into .env without overwriting existing keys
python3 - <<'PY'
from pathlib import Path

root = Path("$RemoteRoot")
defaults_path = root / ".env.defaults"
env_path = root / ".env"

def parse(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v
    return out

defaults = parse(defaults_path)
existing = parse(env_path)

if not existing:
    # First install: write defaults (must include API_KEY)
    if not (defaults.get("API_KEY") or "").strip():
        raise SystemExit("first install: API_KEY missing in .env.defaults")
    lines = [f"{k}={v}" for k, v in defaults.items()]
    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("CREATED .env from defaults")
else:
    added = []
    for k, v in defaults.items():
        if k not in existing:
            # Do not invent empty API_KEY on redeploy
            if k == "API_KEY" and not (v or "").strip():
                continue
            existing[k] = v
            added.append(k)
    # Preserve original file order + comments where possible: append only new keys
    if added:
        with env_path.open("a", encoding="utf-8") as f:
            f.write("\n# --- appended by deploy_cloud_meta.ps1 ---\n")
            for k in added:
                f.write(f"{k}={existing[k]}\n")
        print("MERGED .env; appended:", ", ".join(added))
    else:
        print("KEPT existing .env (no keys appended)")

# Sanity: never leave change-me if that was somehow written on first install only — warn only
api = existing.get("API_KEY") if existing else defaults.get("API_KEY", "")
if existing:
    api = parse(env_path).get("API_KEY", "")
if not (api or "").strip():
    raise SystemExit("remote .env has empty API_KEY")
print("API_KEY present (value not printed)")
PY

python3 -m venv .venv
. .venv/bin/activate
pip install -U pip
pip install -r requirements.txt
mkdir -p data/instances/$InstanceId
cat >/etc/systemd/system/comfy-meta-$InstanceId.service <<'UNIT'
[Unit]
Description=Comfy Studio Meta ($InstanceId)
After=network.target

[Service]
Type=simple
WorkingDirectory=$RemoteRoot
Environment=PYTHONUNBUFFERED=1
ExecStart=$RemoteRoot/.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port $MetaPort --workers 1
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now comfy-meta-$InstanceId.service
systemctl restart comfy-meta-$InstanceId.service
sleep 2
systemctl --no-pager -l status comfy-meta-$InstanceId.service | head -20
curl -fsS http://127.0.0.1:$MetaPort/health/live
echo
# Install split nginx if site conf exists
SITE=/etc/nginx/conf.d/comfy-studio-app.conf
if [ -f "$SITE" ] || [ -d /etc/nginx/conf.d ]; then
  cp $RemoteRoot/comfy-studio-app.split.nginx.conf /etc/nginx/conf.d/comfy-studio-app.split.conf
  # Keep cert lines from live site if present
  if [ -f /etc/nginx/conf.d/app.comfy-studio.sharex.team.conf ]; then
    echo 'NOTE: merge SSL cert paths into comfy-studio-app.split.conf if needed'
  fi
  nginx -t && systemctl reload nginx || true
fi
echo DONE_META
"@

Write-Host "==> Remote setup (merge .env)"
$remoteSetup | & ssh @ssh $target "bash -s"
if ($LASTEXITCODE -ne 0) { throw "remote setup failed" }

Write-Host "OK: Meta on 127.0.0.1:$MetaPort INSTANCE_ID=$InstanceId"
Write-Host "Remote .env: existing keys kept; only missing keys appended from defaults"
Write-Host "Verify: https://app.comfy-studio.sharex.team/health/live"
Write-Host "Ensure GPU FRP still listens on 18000 for /v1/images and /v1/tasks"
