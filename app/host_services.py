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

ServiceId = Literal["comfy", "api", "frp", "lhm"]
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
        _status_lhm(settings),
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

    if service == "lhm":
        if action == "start":
            return _start_lhm(settings)
        if action in ("stop", "force_stop"):
            return _stop_lhm(settings)
        return False, "LibreHardwareMonitor 不支持该操作"

    if service == "api":
        if action == "restart":
            return _restart_api(settings)
        if action == "start":
            return False, "FastAPI 已在线；离线时请用本机 Gateway 启动"
        if action in ("stop", "force_stop"):
            return False, "远程停止 API 会断开管理台，请用本机 Gateway 或「重启」"
        return False, "FastAPI 不支持该操作"

    return False, "未知服务"


def _is_portable_root(directory: Path) -> bool:
    if not (directory / "ComfyUI" / "main.py").is_file():
        return False
    return (directory / "python_embeded" / "python.exe").is_file() or (
        directory / "python_embedded" / "python.exe"
    ).is_file()


def _portable_python_rel(directory: Path) -> str:
    if (directory / "python_embeded" / "python.exe").is_file():
        return r"python_embeded\python.exe"
    return r"python_embedded\python.exe"


def _resolve_comfy_install(raw: Path | None) -> tuple[Path, str, str] | None:
    """Return (cwd, kind, default_launch) for source or Windows portable layouts."""
    if raw is None or not raw.is_dir():
        return None
    nested = raw / "ComfyUI_windows_portable"
    candidates = [nested, raw]
    for directory in candidates:
        if _is_portable_root(directory):
            py = _portable_python_rel(directory)
            launch = (
                f"{py} -s ComfyUI\\main.py --windows-standalone-build "
                "--enable-manager --listen 127.0.0.1 --port 8188"
            )
            return directory, "portable", launch
    if (raw / "main.py").is_file():
        return (
            raw,
            "source",
            r".venv\Scripts\python.exe main.py --listen 127.0.0.1 --port 8188",
        )
    nested_src = raw / "ComfyUI"
    if (nested_src / "main.py").is_file():
        return (
            nested_src,
            "source",
            r".venv\Scripts\python.exe main.py --listen 127.0.0.1 --port 8188",
        )
    return None


def _resolve_comfy_launch(cwd: Path, kind: str, default_launch: str, configured: str) -> str:
    launch = (configured or "").strip()
    if not launch:
        return default_launch
    source_like = bool(re.search(r"(?:^|[\\/])\.venv[\\/]Scripts[\\/]python(?:\.exe)?\b", launch, re.I)) or (
        re.search(r"\bmain\.py\b", launch, re.I)
        and not re.search(r"[\\/]ComfyUI[\\/]main\.py\b", launch, re.I)
    )
    portable_like = bool(
        re.search(r"python_embede?d[\\/]python(?:\.exe)?", launch, re.I)
        or re.search(r"run_nvidia_gpu(?:_fast[^\\/]*)?\.bat\b", launch, re.I)
        or re.search(r"[\\/]ComfyUI[\\/]main\.py\b", launch, re.I)
    )
    if kind == "portable" and source_like and not portable_like:
        return default_launch
    # Official portable bats end with `pause`; prefer embeded python for clean process exit.
    if kind == "portable" and re.search(r"run_nvidia_gpu(?:_fast[^\\/]*)?\.bat\b", launch, re.I):
        return default_launch
    if kind == "source" and (
        re.search(r"python_embede?d", launch, re.I) or re.search(r"run_nvidia_gpu", launch, re.I)
    ):
        return default_launch
    if kind == "portable" and re.match(r"^(python|python\.exe|py)(\s|$)", launch, re.I):
        abs_py = cwd / _portable_python_rel(cwd).replace("\\", os.sep)
        return re.sub(r"^(python|python\.exe|py)\b", f'"{abs_py}"', launch, count=1, flags=re.I)
    if kind == "source" and re.match(r"^(python|python\.exe|py)(\s|$)", launch, re.I):
        venv_py = cwd / ".venv" / "Scripts" / "python.exe"
        if venv_py.is_file():
            return re.sub(r"^(python|python\.exe|py)\b", f'"{venv_py}"', launch, count=1, flags=re.I)
    return launch


def _start_comfy(settings: Settings) -> tuple[bool, str]:
    ok, msg = _probe_http(f"{settings.comfyui_url.rstrip('/')}/system_stats")
    if ok:
        return True, f"ComfyUI 已在线（{msg}）"
    resolved = _resolve_comfy_install(settings.host_comfy_dir)
    if not resolved:
        return False, (
            "请在 .env 配置 HOST_COMFY_DIR：桌面版选含 main.py 的目录；"
            "便携版可选 ComfyUI_windows_portable（或外层安装夹）"
        )
    directory, kind, default_launch = resolved
    launch = _resolve_comfy_launch(
        directory, kind, default_launch, settings.host_comfy_launch or ""
    )
    if not launch:
        return False, "请配置 HOST_COMFY_LAUNCH"
    if launch != (settings.host_comfy_launch or "").strip():
        logger.info("host_services comfy launch rewritten (%s) → %s", kind, launch)
    port = _comfy_port(settings.comfyui_url)
    listeners = _find_listening_pids(port)
    if listeners:
        return False, f"端口 {port} 已被占用（PID {listeners}），请先强制停止"

    pid = _spawn_shell(launch, directory)
    if pid:
        _tracked["comfy"] = pid
    logger.info("host_services start comfy pid=%s kind=%s cwd=%s", pid, kind, directory)

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


def _lhm_port(settings: Settings) -> int:
    try:
        u = urlparse(settings.lhm_url or "http://127.0.0.1:8085")
        if u.port:
            return int(u.port)
    except Exception:
        pass
    return 8085


def _find_lhm_pids(exe_path: Path | None) -> list[int]:
    if sys.platform != "win32":
        return []
    try:
        ps = (
            "Get-CimInstance Win32_Process -Filter "
            "\"Name='LibreHardwareMonitor.exe'\" | "
            "Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress"
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
        want = str(exe_path).lower().replace("/", "\\") if exe_path else ""
        for row in rows:
            pid = int(row.get("ProcessId") or 0)
            if pid <= 0:
                continue
            exe = str(row.get("ExecutablePath") or row.get("CommandLine") or "").lower()
            exe = exe.replace("/", "\\")
            if want and want not in exe:
                # Still accept any LibreHardwareMonitor.exe if path filter is set but
                # ExecutablePath is empty (permissions)
                if row.get("ExecutablePath"):
                    continue
            pids.append(pid)
        return pids
    except (subprocess.CalledProcessError, ValueError, FileNotFoundError):
        return []


def _lhm_data_urls(settings: Settings) -> list[str]:
    """Candidate Data.json URLs (casing / bind address varies by LHM build)."""
    bases: list[str] = []
    configured = (settings.lhm_url or "http://127.0.0.1:8085").rstrip("/")
    bases.append(configured)
    lan = _primary_lan_ipv4()
    if lan:
        bases.append(f"http://{lan}:8085")
    if "127.0.0.1" not in configured:
        bases.append("http://127.0.0.1:8085")
    seen: set[str] = set()
    urls: list[str] = []
    for base in bases:
        if base in seen:
            continue
        seen.add(base)
        # Prefer lowercase — some LHM builds 404 on Data.json.
        urls.append(f"{base}/data.json")
        urls.append(f"{base}/Data.json")
    return urls


def _probe_lhm_web(settings: Settings, *, timeout: float = 2.0) -> tuple[bool, str]:
    last = "unreachable"
    for url in _lhm_data_urls(settings):
        ok, msg = _probe_http(url, timeout=timeout)
        if ok:
            return True, msg
        last = msg
    return False, last


def _primary_lan_ipv4() -> str | None:
    """Pick a stable non-loopback IPv4 for LHM HttpListener.

    LibreHardwareMonitor rewrites listenerIp to '+' unless the value appears in
    Dns.GetHostEntry(hostname).AddressList — so 127.0.0.1 never sticks, and '+'
    needs an http.sys URL ACL / elevation.
    """
    if sys.platform != "win32":
        return None
    try:
        ps = (
            "Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue "
            "| Where-Object { "
            "  $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' "
            "  -and $_.PrefixOrigin -ne 'WellKnown' "
            "} "
            "| Sort-Object -Property InterfaceMetric "
            "| Select-Object -First 1 -ExpandProperty IPAddress"
        )
        r = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps],
            capture_output=True,
            timeout=8,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        out = (r.stdout or b"").decode("utf-8", errors="ignore").strip()
        ip = out.splitlines()
        if ip and re.fullmatch(r"\d{1,3}(?:\.\d{1,3}){3}", ip[0].strip()):
            return ip[0].strip()
    except (OSError, subprocess.SubprocessError) as exc:
        logger.warning("host_services lan ipv4 probe failed: %s", exc)
    return None


def _http_urlacl_covers_lhm(port: int = 8085) -> bool:
    """True if http.sys already allows non-admin listen on +/∗ :port."""
    if sys.platform != "win32":
        return False
    try:
        r = subprocess.run(
            ["netsh", "http", "show", "urlacl"],
            capture_output=True,
            timeout=8,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        text = (r.stdout or b"").decode("utf-8", errors="ignore").lower()
        if not text.strip():
            text = (r.stdout or b"").decode("gbk", errors="ignore").lower()
    except (OSError, subprocess.SubprocessError):
        return False
    markers = (
        f"http://+:{port}/",
        f"http://*:{port}/",
        f"http://+:{port}",
        f"http://*:{port}",
    )
    return any(m in text for m in markers)


def _ensure_lhm_config_for_remote(exe: Path) -> None:
    """Keep Remote Web Server auto-start + a bindable listenerIp.

    LHM rejects 127.0.0.1 (not in Dns host AddressList) and rewrites it to '+'.
    Prefer '+' when urlacl exists (listens all ifaces incl. loopback); otherwise
    use LAN IPv4 so StartHttpListener does not silently no-op after rewrite.
    """
    cfg = exe.parent / "LibreHardwareMonitor.config"
    if not cfg.is_file():
        return
    try:
        raw = cfg.read_text(encoding="utf-8", errors="ignore")
    except OSError as exc:
        logger.warning("host_services read LHM config failed: %s", exc)
        return
    new = raw
    n_ip = 0
    if _http_urlacl_covers_lhm(8085):
        listen = "+"
    else:
        listen = _primary_lan_ipv4() or "+"
    new, n_ip = re.subn(
        r'(<add key="listenerIp" value=")[^"]*("\s*/>)',
        rf"\g<1>{listen}\2",
        new,
        count=1,
    )
    new, n_run = re.subn(
        r'(<add key="runWebServerMenuItem" value=")false("\s*/>)',
        r"\g<1>true\2",
        new,
        count=1,
        flags=re.IGNORECASE,
    )
    if new == raw:
        return
    try:
        cfg.write_text(new, encoding="utf-8")
        logger.info(
            "host_services patched LHM config listenerIp=%s (%s) runWeb=%s",
            listen,
            n_ip,
            n_run,
        )
    except OSError as exc:
        logger.warning("host_services write LHM config failed: %s", exc)


def _status_lhm(settings: Settings) -> ServiceSnapshot:
    path = settings.host_lhm_path
    configured = bool(path and path.is_file())
    port = _lhm_port(settings)
    data_url = _lhm_data_urls(settings)[0]
    ok, msg = _probe_lhm_web(settings)
    tracked = _tracked.get("lhm")
    pids: list[int] = []
    if tracked and tracked > 4 and _pid_alive(tracked):
        pids = [tracked]
    else:
        pids = _find_lhm_pids(path)
        # http.sys owns :8085 as PID 4 — never treat System as LHM.
        if not pids:
            pids = [p for p in _find_listening_pids(port) if p > 4][:1]
        if pids:
            _tracked["lhm"] = pids[0]
    detail = str(path) if path else "未配置 HOST_LHM_PATH"
    if ok:
        message = msg
    elif not configured:
        message = "未配置 exe"
    elif pids:
        message = (
            "进程在但 Web 未响应（需 urlacl + Options→Remote Web Server；"
            "listenerIp 用 + 或网卡 IP，勿填 127.0.0.1）"
        )
    else:
        message = "Remote Web Server 未响应"
    return ServiceSnapshot(
        id="lhm",
        label="硬件监控",
        ok=ok,
        state="running" if ok else ("starting" if pids else "stopped"),
        message=message,
        pid=pids[0] if pids else None,
        configured=configured or ok,
        detail=f"{data_url} · {detail}",
    )


def _start_lhm(settings: Settings) -> tuple[bool, str]:
    path = settings.host_lhm_path
    if not path or not path.is_file():
        return False, "请配置 HOST_LHM_PATH（LibreHardwareMonitor.exe）"
    snap = _status_lhm(settings)
    if snap.ok:
        return True, f"硬件监控已在运行（PID {snap.pid}）"
    existing = _find_lhm_pids(path)
    if existing and not snap.ok:
        # Common after listenerIp/urlacl drift: tray process up, HttpListener dead.
        # With urlacl present we can recycle safely; otherwise ask the user once.
        if _http_urlacl_covers_lhm(_lhm_port(settings)):
            logger.info("host_services recycling LHM PIDs %s (web down, urlacl ok)", existing)
            for pid in existing:
                _kill_tree(pid)
            time.sleep(1.0)
        else:
            return (
                False,
                f"已有 LibreHardwareMonitor（PID {existing}）但 Web 未响应。"
                "请本机托盘右键退出全部实例后重试。"
                "一次性（管理员 CMD）：netsh http add urlacl url=http://+:8085/ user=Everyone；"
                "再开 LHM → Options → Remote Web Server。",
            )

    _ensure_lhm_config_for_remote(path)

    # WinForms + HttpListener need a normal interactive Start-Process.
    # DETACHED_PROCESS often leaves the tray app up but Remote Web Server unbound.
    # RunAsInvoker avoids WinError 740 when the exe asks for elevation.
    try:
        if sys.platform == "win32":
            ps = (
                "$env:__COMPAT_LAYER='RunAsInvoker'; "
                f"Start-Process -FilePath '{path}' -WorkingDirectory '{path.parent}'"
            )
            subprocess.Popen(
                [
                    "powershell",
                    "-NoProfile",
                    "-WindowStyle",
                    "Hidden",
                    "-Command",
                    ps,
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
        else:
            subprocess.Popen(
                [str(path)],
                cwd=str(path.parent),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
    except OSError as exc:
        winerr = getattr(exc, "winerror", None)
        logger.warning("host_services start lhm failed: %s", exc)
        if winerr == 740 or "740" in str(exc):
            return (
                False,
                "LibreHardwareMonitor 需要管理员权限才能启动，远程无法点 UAC。"
                "请本机以管理员打开一次，Network interface=局域网 IP，"
                "菜单 Run Remote Web Server 后退出保存；或执行 "
                "netsh http add urlacl url=http://+:8085/ user=Everyone。",
            )
        return False, f"启动失败：{exc}"

    logger.info("host_services start lhm via Start-Process")
    # Cold start: process appears first, HttpListener / sensor init a bit later.
    deadline = time.monotonic() + 20.0
    last_pids: list[int] = []
    while time.monotonic() < deadline:
        time.sleep(0.7)
        last_pids = _find_lhm_pids(path)
        if last_pids:
            _tracked["lhm"] = last_pids[0]
        if _probe_lhm_web(settings, timeout=2.5)[0]:
            pid = last_pids[0] if last_pids else None
            return True, f"硬件监控已启动（PID {pid}）"

    if last_pids:
        return (
            False,
            f"已拉起进程（PID {last_pids}）但 Web 未响应。"
            "请本机管理员打开 LibreHardwareMonitor → Network interface=局域网 IP → OK，"
            "再点 Options → Remote Web Server（Run）后退出保存；或先执行 "
            "netsh http add urlacl url=http://+:8085/ user=Everyone。",
        )
    return (
        False,
        "未检测到 LibreHardwareMonitor 进程（可能被 UAC 取消）。"
        "请本机手动打开一次并开启 Remote Web Server。",
    )


def _stop_lhm(settings: Settings) -> tuple[bool, str]:
    path = settings.host_lhm_path
    killed: list[int] = []
    tracked = _tracked.pop("lhm", None)
    if tracked and tracked > 4:
        _kill_tree(tracked)
        killed.append(tracked)
    for pid in _find_lhm_pids(path):
        if pid in killed:
            continue
        _kill_tree(pid)
        killed.append(pid)
    # Do NOT kill http.sys PID 4 even if it shows as listening on 8085.
    time.sleep(0.8)
    if _status_lhm(settings).ok:
        return (
            False,
            "硬件监控 Web 仍在响应。若进程以管理员运行，普通权限的 API 无法结束它，"
            "请本机托盘右键退出。",
        )
    if not killed:
        return True, "没有发现 LibreHardwareMonitor 进程"
    return True, f"已停止硬件监控（PID {killed}）"


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
