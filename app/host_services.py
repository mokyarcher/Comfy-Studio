"""Admin-controlled local host services (ComfyUI / FRP / API restart).

Runs on the GPU machine inside FastAPI. Remote Gateway Web calls these
endpoints after TOTP admin login. Stopping FRP or restarting API may drop
the public tunnel briefly.
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

import httpx

from app.config import PROJECT_ROOT, Settings

logger = logging.getLogger(__name__)

ServiceId = Literal["comfy", "api", "frp"]
ActionId = Literal["start", "stop", "force_stop", "restart"]

_tracked: dict[str, int] = {}


@dataclass
class ServiceSnapshot:
    id: ServiceId
    label: str
    ok: bool
    state: str
    message: str
    pid: int | None = None
    configured: bool = True
    detail: str = ""


def _comfy_port(comfy_url: str) -> int:
    try:
        u = urlparse(comfy_url)
        if u.port:
            return int(u.port)
        return 443 if u.scheme == "https" else 80
    except Exception:
        return 8188


def _find_listening_pids(port: int) -> list[int]:
    pids: set[int] = set()
    try:
        if sys.platform == "win32":
            out = subprocess.check_output(
                ["netstat", "-ano", "-p", "TCP"],
                text=True,
                encoding="utf-8",
                errors="ignore",
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            for line in out.splitlines():
                if "LISTENING" not in line.upper():
                    continue
                parts = line.split()
                if len(parts) < 4:
                    continue
                local = parts[1]
                m = re.search(r":(\d+)$", local)
                if not m or int(m.group(1)) != port:
                    continue
                pid = int(parts[-1])
                if pid > 0:
                    pids.add(pid)
        else:
            out = subprocess.check_output(
                ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"],
                text=True,
            )
            for line in out.splitlines():
                pid = int(line.strip())
                if pid > 0:
                    pids.add(pid)
    except (subprocess.CalledProcessError, FileNotFoundError, ValueError):
        pass
    return sorted(pids)


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        if sys.platform == "win32":
            out = subprocess.check_output(
                ["tasklist", "/FI", f"PID eq {pid}", "/NH"],
                text=True,
                encoding="utf-8",
                errors="ignore",
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            return str(pid) in out
        os.kill(pid, 0)
        return True
    except (subprocess.CalledProcessError, OSError):
        return False


def _kill_tree(pid: int) -> None:
    if pid <= 0:
        return
    try:
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/pid", str(pid), "/t", "/f"],
                check=False,
                capture_output=True,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
        else:
            os.kill(pid, 15)
    except OSError:
        pass


def _find_frpc_pids(frpc_path: Path | None, config_path: Path | None) -> list[int]:
    if sys.platform != "win32":
        return []
    try:
        ps = (
            "Get-CimInstance Win32_Process -Filter \"Name='frpc.exe'\" | "
            "Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"
        )
        out = subprocess.check_output(
            ["powershell", "-NoProfile", "-Command", ps],
            text=True,
            encoding="utf-8",
            errors="ignore",
            creationflags=subprocess.CREATE_NO_WINDOW,
        ).strip()
        if not out:
            return []
        import json

        data = json.loads(out)
        rows = data if isinstance(data, list) else [data]
        pids: list[int] = []
        frpc_s = str(frpc_path).lower() if frpc_path else ""
        cfg_s = str(config_path).lower() if config_path else ""
        for row in rows:
            pid = int(row.get("ProcessId") or 0)
            cmd = str(row.get("CommandLine") or "").lower()
            if pid <= 0:
                continue
            if frpc_s and frpc_s.replace("/", "\\") in cmd.replace("/", "\\"):
                pids.append(pid)
            elif cfg_s and cfg_s.replace("/", "\\") in cmd.replace("/", "\\"):
                pids.append(pid)
            elif not frpc_s and not cfg_s:
                pids.append(pid)
        return pids
    except (subprocess.CalledProcessError, ValueError, FileNotFoundError):
        return []


def _spawn_shell(command: str, cwd: Path) -> int | None:
    if sys.platform == "win32":
        proc = subprocess.Popen(
            ["cmd.exe", "/d", "/s", "/c", command],
            cwd=str(cwd),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP,
        )
    else:
        proc = subprocess.Popen(
            ["bash", "-lc", command],
            cwd=str(cwd),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    return proc.pid


def _probe_http(url: str, timeout: float = 3.0) -> tuple[bool, str]:
    try:
        with httpx.Client(timeout=timeout) as client:
            r = client.get(url)
        if r.status_code == 200:
            return True, f"HTTP {r.status_code}"
        return False, f"HTTP {r.status_code}"
    except httpx.HTTPError as exc:
        return False, str(exc)[:120]


def status_all(settings: Settings) -> list[ServiceSnapshot]:
    return [
        _status_comfy(settings),
        _status_api(settings),
        _status_frp(settings),
    ]


def _status_comfy(settings: Settings) -> ServiceSnapshot:
    configured = bool(settings.host_comfy_dir and settings.host_comfy_dir.is_dir())
    ok, msg = _probe_http(f"{settings.comfyui_url.rstrip('/')}/system_stats")
    port = _comfy_port(settings.comfyui_url)
    listeners = _find_listening_pids(port)
    pid = _tracked.get("comfy") if _tracked.get("comfy") and _pid_alive(_tracked["comfy"]) else None
    if pid is None and listeners:
        pid = listeners[0]
    detail = str(settings.host_comfy_dir) if configured else "未配置 HOST_COMFY_DIR"
    return ServiceSnapshot(
        id="comfy",
        label="ComfyUI",
        ok=ok,
        state="running" if ok else ("starting" if pid else "stopped"),
        message=msg if configured or ok else "未配置启动目录",
        pid=pid,
        configured=configured or ok,
        detail=f"{settings.comfyui_url} · {detail}",
    )


def _status_api(settings: Settings) -> ServiceSnapshot:
    port = settings.port
    listeners = _find_listening_pids(port)
    pid = listeners[0] if listeners else os.getpid()
    return ServiceSnapshot(
        id="api",
        label="FastAPI",
        ok=True,
        state="running",
        message="本进程在线（远程停掉后需本机再拉起）",
        pid=pid,
        configured=True,
        detail=f"http://{settings.host}:{settings.port}",
    )


def _status_frp(settings: Settings) -> ServiceSnapshot:
    path = settings.host_frpc_path
    cfg = settings.host_frpc_config_path
    configured = bool(path and path.is_file() and cfg and cfg.is_file())
    tracked = _tracked.get("frp")
    pids = []
    if tracked and _pid_alive(tracked):
        pids = [tracked]
    else:
        pids = _find_frpc_pids(path, cfg)
        if pids:
            _tracked["frp"] = pids[0]
    ok = len(pids) > 0
    detail = str(path) if path else "未配置 HOST_FRPC_PATH"
    return ServiceSnapshot(
        id="frp",
        label="FRP",
        ok=ok,
        state="running" if ok else "stopped",
        message="进程在跑" if ok else ("未配置路径" if not configured else "未运行"),
        pid=pids[0] if pids else None,
        configured=configured,
        detail=detail,
    )


def run_action(settings: Settings, service: ServiceId, action: ActionId) -> tuple[bool, str]:
    if not settings.host_services_enabled:
        return False, "HOST_SERVICES_ENABLED=false，已禁用远程启停"

    if service == "comfy":
        if action == "start":
            return _start_comfy(settings)
        if action in ("stop", "force_stop"):
            return _stop_comfy(settings, force=action == "force_stop")
        return False, "ComfyUI 不支持该操作"

    if service == "frp":
        if action == "start":
            return _start_frp(settings)
        if action in ("stop", "force_stop"):
            return _stop_frp(settings)
        return False, "FRP 不支持该操作"

    if service == "api":
        if action == "restart":
            return _restart_api(settings)
        if action == "start":
            return False, "FastAPI 已在线；离线时请用本机 Gateway 启动"
        if action in ("stop", "force_stop"):
            return False, "远程停止 API 会断开管理台，请用本机 Gateway 或「重启」"
        return False, "FastAPI 不支持该操作"

    return False, "未知服务"


def _start_comfy(settings: Settings) -> tuple[bool, str]:
    ok, msg = _probe_http(f"{settings.comfyui_url.rstrip('/')}/system_stats")
    if ok:
        return True, f"ComfyUI 已在线（{msg}）"
    directory = settings.host_comfy_dir
    launch = (settings.host_comfy_launch or "").strip()
    if not directory or not directory.is_dir():
        return False, "请在 .env 配置 HOST_COMFY_DIR（含 main.py 的目录）"
    if not launch:
        return False, "请配置 HOST_COMFY_LAUNCH"
    # Bare `python` → system interpreter without Comfy deps; prefer local .venv.
    venv_py = directory / ".venv" / "Scripts" / "python.exe"
    if venv_py.is_file() and re.match(r"^(python|python\.exe|py)(\s|$)", launch, re.I):
        launch = re.sub(r"^(python|python\.exe|py)\b", f'"{venv_py}"', launch, count=1, flags=re.I)
        logger.info("host_services rewritten bare python → %s", launch)
    port = _comfy_port(settings.comfyui_url)
    listeners = _find_listening_pids(port)
    if listeners:
        return False, f"端口 {port} 已被占用（PID {listeners}），请先强制停止"

    pid = _spawn_shell(launch, directory)
    if pid:
        _tracked["comfy"] = pid
    logger.info("host_services start comfy pid=%s cwd=%s", pid, directory)

    # Short wait so the HTTP request does not hang behind reverse proxies.
    for _ in range(6):
        time.sleep(2)
        ok, msg = _probe_http(f"{settings.comfyui_url.rstrip('/')}/system_stats")
        if ok:
            return True, f"ComfyUI 已启动（{msg}）"
    return True, "ComfyUI 进程已拉起，健康检查尚未通过（可稍后刷新）"


def _stop_comfy(settings: Settings, *, force: bool) -> tuple[bool, str]:
    port = _comfy_port(settings.comfyui_url)
    killed: list[int] = []
    tracked = _tracked.pop("comfy", None)
    if tracked:
        _kill_tree(tracked)
        killed.append(tracked)
    for pid in _find_listening_pids(port):
        if pid in killed:
            continue
        _kill_tree(pid)
        killed.append(pid)
    time.sleep(0.6)
    left = _find_listening_pids(port)
    if left and force:
        for pid in left:
            _kill_tree(pid)
        time.sleep(0.4)
        left = _find_listening_pids(port)
    if left:
        return False, f"仍占用端口 {port}：PID {left}"
    if not killed:
        return True, f"端口 {port} 已空闲"
    return True, f"已停止 ComfyUI（PID {killed}）"


def _start_frp(settings: Settings) -> tuple[bool, str]:
    path = settings.host_frpc_path
    cfg = settings.host_frpc_config_path
    if not path or not path.is_file():
        return False, "请配置 HOST_FRPC_PATH"
    if not cfg or not cfg.is_file():
        return False, "请配置 HOST_FRPC_CONFIG_PATH"
    existing = _find_frpc_pids(path, cfg)
    if existing:
        _tracked["frp"] = existing[0]
        return True, f"FRP 已在运行（PID {existing[0]}）"
    if sys.platform == "win32":
        proc = subprocess.Popen(
            [str(path), "-c", str(cfg)],
            cwd=str(path.parent),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP,
        )
    else:
        proc = subprocess.Popen(
            [str(path), "-c", str(cfg)],
            cwd=str(path.parent),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    if proc.pid:
        _tracked["frp"] = proc.pid
    logger.info("host_services start frp pid=%s", proc.pid)
    time.sleep(0.8)
    return True, f"FRP 已启动（PID {proc.pid}）"


def _stop_frp(settings: Settings) -> tuple[bool, str]:
    path = settings.host_frpc_path
    cfg = settings.host_frpc_config_path
    killed: list[int] = []
    tracked = _tracked.pop("frp", None)
    if tracked:
        _kill_tree(tracked)
        killed.append(tracked)
    for pid in _find_frpc_pids(path, cfg):
        if pid in killed:
            continue
        _kill_tree(pid)
        killed.append(pid)
    time.sleep(0.5)
    left = _find_frpc_pids(path, cfg)
    if left:
        return False, f"FRP 仍在运行：PID {left}"
    if not killed:
        return True, "没有发现 FRP 进程"
    return True, f"已停止 FRP（PID {killed}）。公网入口可能暂时不可达。"


def _restart_api(settings: Settings) -> tuple[bool, str]:
    python = sys.executable
    host = settings.host
    port = settings.port
    root = str(PROJECT_ROOT)
    if sys.platform == "win32":
        # Wait until old process releases the port, then start uvicorn again.
        ps = (
            f"$port={port}; "
            f"for ($i=0; $i -lt 40; $i++) {{ "
            f"  $busy = netstat -ano -p TCP | Select-String \":$port\\s+.*LISTENING\"; "
            f"  if (-not $busy) {{ break }}; Start-Sleep -Milliseconds 500 "
            f"}}; "
            f"Set-Location '{root}'; "
            f"& '{python}' -m uvicorn app.main:app --host {host} --port {port} --workers 1"
        )
        subprocess.Popen(
            ["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps],
            cwd=root,
            creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP,
        )
    else:
        script = (
            f"sleep 2; cd '{root}' && "
            f"'{python}' -m uvicorn app.main:app --host {host} --port {port} --workers 1"
        )
        subprocess.Popen(["bash", "-lc", script], start_new_session=True)

    logger.warning("host_services scheduling API restart on %s:%s", host, port)
    return True, "已安排重启 FastAPI，约数秒后公网入口恢复；请稍后刷新页面"
