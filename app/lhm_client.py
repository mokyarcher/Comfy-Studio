"""LibreHardwareMonitor Remote Web Server client.

Fetches http://127.0.0.1:8085/Data.json (or data.json) and summarizes
CPU / GPU sensors for Studio. Port 8085 stays loopback-only.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)

_NUM = re.compile(r"[-+]?\d+(?:\.\d+)?")


def _parse_number(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text or text in ("-", "—"):
        return None
    m = _NUM.search(text.replace(",", ""))
    if not m:
        return None
    try:
        return float(m.group(0))
    except ValueError:
        return None


def _parse_memory_mb(value: Any) -> float | None:
    """Parse LHM memory Value strings that may use MB / GB / TB."""
    n = _parse_number(value)
    if n is None:
        return None
    text = str(value).strip().lower().replace(",", "")
    if "tb" in text or "tib" in text:
        return n * 1024 * 1024
    if "gb" in text or "gib" in text:
        return n * 1024
    # MB / MiB / bare number (LHM Data sensors are usually MB)
    return n


def _text(node: dict[str, Any]) -> str:
    return str(node.get("Text") or node.get("text") or "").strip()


def _children(node: dict[str, Any]) -> list[dict[str, Any]]:
    raw = node.get("Children")
    if not isinstance(raw, list):
        return []
    return [c for c in raw if isinstance(c, dict)]


def _is_gpu_hw(name: str) -> bool:
    n = name.lower()
    keys = ("nvidia", "geforce", "rtx", "gtx", "quadro", "radeon", "intel arc")
    return any(k in n for k in keys) or (n.startswith("gpu") and "cpu" not in n)


def _is_cpu_hw(name: str) -> bool:
    n = name.lower()
    if _is_gpu_hw(name):
        return False
    return any(
        k in n
        for k in ("cpu", "ryzen", "intel core", "xeon", "epyc", "threadripper", "processor")
    )


def _is_ram_hw(name: str) -> bool:
    """System RAM nodes (Total / Generic Memory). Skip Virtual Memory and DIMM sticks."""
    n = name.lower().strip()
    if _is_gpu_hw(name) or _is_cpu_hw(name):
        return False
    if "virtual" in n:
        return False
    # DIMM part numbers e.g. "Samsung - M425R2GA3…"
    if any(k in n for k in ("dimm", "sodimm", "#0", "#1", "#2", "#3")):
        return False
    if n in ("memory", "generic memory", "total memory", "ram"):
        return True
    return n.endswith(" memory") or n.startswith("memory ")


def _ram_from_os() -> dict[str, float | None]:
    """Fallback physical RAM when LHM has no Memory node (Windows / Linux)."""
    try:
        import ctypes

        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        stat = MEMORYSTATUSEX()
        stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
            total = stat.ullTotalPhys / (1024 * 1024)
            avail = stat.ullAvailPhys / (1024 * 1024)
            used = max(0.0, total - avail)
            return {
                "ram_used_mb": round(used, 1),
                "ram_total_mb": round(total, 1),
                "ram_load_pct": float(stat.dwMemoryLoad),
            }
    except Exception:
        pass
    try:
        meminfo: dict[str, int] = {}
        with open("/proc/meminfo", encoding="utf-8") as fh:
            for line in fh:
                parts = line.split(":")
                if len(parts) != 2:
                    continue
                key = parts[0].strip()
                num = _NUM.search(parts[1])
                if num:
                    meminfo[key] = int(float(num.group(0)))
        total_kb = meminfo.get("MemTotal")
        avail_kb = meminfo.get("MemAvailable")
        if total_kb and avail_kb is not None:
            total = total_kb / 1024
            used = (total_kb - avail_kb) / 1024
            return {
                "ram_used_mb": round(used, 1),
                "ram_total_mb": round(total, 1),
                "ram_load_pct": round(100.0 * used / total, 1) if total else None,
            }
    except Exception:
        pass
    return {"ram_used_mb": None, "ram_total_mb": None, "ram_load_pct": None}


def _pick_better(store: dict[str, float], key: str, value: float, *, prefer_max: bool) -> None:
    if key not in store:
        store[key] = value
        return
    if prefer_max:
        store[key] = max(store[key], value)
    else:
        store[key] = value


def _ingest_sensor(
    store: dict[str, float],
    hw: str,
    group: str,
    sensor: str,
    value: float,
    *,
    raw_value: Any = None,
) -> None:
    g = group.lower()
    s = sensor.lower()

    if "temperature" in g or "温度" in g:
        if hw == "gpu":
            if any(k in s for k in ("hot spot", "hotspot", "junction")):
                _pick_better(store, "gpu_hotspot", value, prefer_max=True)
            else:
                _pick_better(store, "gpu_temp", value, prefer_max=True)
        elif hw == "cpu":
            if any(k in s for k in ("package", "tctl", "tdie", "average", "core max", "cpu")):
                _pick_better(store, "cpu_temp", value, prefer_max=True)
            elif "cpu_temp" not in store:
                store["cpu_temp"] = value
        return

    if "load" in g or "负载" in g or "utilization" in g:
        if hw == "gpu":
            if any(k in s for k in ("core", "d3d", "3d", "graphics", "gpu")) and "mem" not in s:
                _pick_better(store, "gpu_load", value, prefer_max=True)
            elif "memory" in s or "mem" in s:
                _pick_better(store, "gpu_mem_load", value, prefer_max=True)
        elif hw == "cpu":
            if "total" in s or s in ("cpu total", "cpu"):
                store["cpu_load"] = value
            elif "cpu_load" not in store and "core" in s:
                store["cpu_load"] = value
        elif hw == "ram":
            if "virtual" in s:
                return
            if "memory" in s or s in ("ram", "used", "load"):
                store["ram_load"] = value
        return

    if "memory" in g or "内存" in g or g == "data":
        if hw == "ram":
            mb = _parse_memory_mb(raw_value if raw_value is not None else value)
            if mb is None:
                return
            if "used" in s and "virtual" not in s:
                store["ram_used"] = mb
            elif "available" in s or "free" in s:
                store["ram_free"] = mb
            elif "total" in s and "virtual" not in s:
                store["ram_total"] = mb
            return
        if hw != "gpu":
            return
        if "memory" not in s and "mem" not in s and "vram" not in s and g != "memory" and "内存" not in g:
            return
        mb = _parse_memory_mb(raw_value if raw_value is not None else value)
        if mb is None:
            return
        if "load" in s:
            _pick_better(store, "gpu_mem_load", value, prefer_max=True)
        elif "used" in s or "dedicated" in s:
            store["gpu_mem_used"] = mb
        elif "total" in s:
            store["gpu_mem_total"] = mb
        elif "available" in s or "free" in s:
            store["gpu_mem_free"] = mb
        return

    if "power" in g or "功率" in g:
        if hw == "gpu" and any(k in s for k in ("gpu", "board", "total", "package")):
            _pick_better(store, "gpu_power", value, prefer_max=True)
        elif hw == "cpu" and any(k in s for k in ("package", "cpu", "total")):
            _pick_better(store, "cpu_power", value, prefer_max=True)
        return

    if "fan" in g or "风扇" in g:
        if hw == "gpu":
            _pick_better(store, "fan", value, prefer_max=True)
        return

    if "clock" in g or "时钟" in g:
        if hw == "gpu" and ("core" in s or "gpu" in s):
            _pick_better(store, "gpu_clock", value, prefer_max=True)


def summarize_lhm_tree(root: Any) -> dict[str, Any]:
    """Reduce LHM JSON tree to a stable summary for API clients."""
    store: dict[str, float] = {}
    cpu_name = ""
    gpu_name = ""

    def visit_hw(node: dict[str, Any], hw: str) -> None:
        for group_node in _children(node):
            group = _text(group_node)
            sensors = _children(group_node)
            if sensors:
                for sensor_node in sensors:
                    # Nested groups (rare)
                    if _children(sensor_node) and _parse_number(sensor_node.get("Value")) is None:
                        visit_hw(sensor_node, hw)
                        continue
                    raw = sensor_node.get("Value")
                    val = _parse_number(raw)
                    if val is None:
                        continue
                    _ingest_sensor(store, hw, group, _text(sensor_node), val, raw_value=raw)
            else:
                raw = group_node.get("Value")
                val = _parse_number(raw)
                if val is not None:
                    _ingest_sensor(store, hw, "", group, val, raw_value=raw)

    def walk(node: dict[str, Any]) -> None:
        nonlocal cpu_name, gpu_name
        name = _text(node)
        if _is_gpu_hw(name):
            if not gpu_name:
                gpu_name = name
            visit_hw(node, "gpu")
            return
        if _is_cpu_hw(name):
            if not cpu_name:
                cpu_name = name
            visit_hw(node, "cpu")
            return
        if _is_ram_hw(name):
            visit_hw(node, "ram")
            return
        for child in _children(node):
            walk(child)

    if isinstance(root, dict):
        walk(root)

    def f(key: str) -> float | None:
        v = store.get(key)
        return round(v, 1) if v is not None else None

    used = f("gpu_mem_used")
    total = f("gpu_mem_total")
    free = f("gpu_mem_free")
    if used is not None and free is not None and total is None:
        total = round(used + free, 1)

    ram_used = f("ram_used")
    ram_total = f("ram_total")
    ram_free = f("ram_free")
    if ram_used is not None and ram_free is not None and ram_total is None:
        ram_total = round(ram_used + ram_free, 1)
    ram_load = f("ram_load")
    if ram_load is None and ram_used is not None and ram_total and ram_total > 0:
        ram_load = round(100.0 * ram_used / ram_total, 1)

    cpu_power = f("cpu_power")
    gpu_power = f("gpu_power")
    total_power: float | None = None
    if cpu_power is not None or gpu_power is not None:
        total_power = round((cpu_power or 0.0) + (gpu_power or 0.0), 1)

    return {
        "cpu_name": cpu_name or None,
        "gpu_name": gpu_name or None,
        "cpu_temp_c": f("cpu_temp"),
        "cpu_load_pct": f("cpu_load"),
        "cpu_power_w": cpu_power,
        "gpu_temp_c": f("gpu_temp"),
        "gpu_hotspot_c": f("gpu_hotspot"),
        "gpu_load_pct": f("gpu_load"),
        "gpu_mem_load_pct": f("gpu_mem_load"),
        "gpu_mem_used_mb": used,
        "gpu_mem_total_mb": total,
        "gpu_power_w": gpu_power,
        "gpu_fan_rpm": f("fan"),
        "gpu_clock_mhz": f("gpu_clock"),
        "ram_used_mb": ram_used,
        "ram_total_mb": ram_total,
        "ram_load_pct": ram_load,
        "total_power_w": total_power,
    }


async def fetch_host_metrics(settings: Settings) -> dict[str, Any]:
    """Return API-shaped metrics dict including ok / message / source."""
    base = (settings.lhm_url or "http://127.0.0.1:8085").rstrip("/")
    paths = ["/Data.json", "/data.json"]
    last_err = "unreachable"
    timeout = max(1.0, float(settings.lhm_timeout_seconds))

    async with httpx.AsyncClient(timeout=timeout) as client:
        for path in paths:
            url = f"{base}{path}"
            try:
                res = await client.get(url)
            except httpx.HTTPError as exc:
                last_err = str(exc)[:160]
                continue
            if res.status_code != 200:
                last_err = f"HTTP {res.status_code}"
                continue
            try:
                data = res.json()
            except ValueError:
                last_err = "invalid JSON"
                continue
            summary = summarize_lhm_tree(data)
            if summary.get("ram_used_mb") is None or summary.get("ram_total_mb") is None:
                summary = {**summary, **{k: v for k, v in _ram_from_os().items() if v is not None}}
            return {
                "ok": True,
                "message": "ok",
                "source": "libre_hardware_monitor",
                "url": url,
                **summary,
            }

    return {
        "ok": False,
        "message": (
            f"LibreHardwareMonitor 不可用（{last_err}）。"
            "请确认已安装并开启 Remote Web Server。"
        ),
        "source": "libre_hardware_monitor",
        "url": f"{base}/Data.json",
        "cpu_name": None,
        "gpu_name": None,
        "cpu_temp_c": None,
        "cpu_load_pct": None,
        "cpu_power_w": None,
        "gpu_temp_c": None,
        "gpu_hotspot_c": None,
        "gpu_load_pct": None,
        "gpu_mem_load_pct": None,
        "gpu_mem_used_mb": None,
        "gpu_mem_total_mb": None,
        "gpu_power_w": None,
        "gpu_fan_rpm": None,
        "gpu_clock_mhz": None,
        "ram_used_mb": None,
        "ram_total_mb": None,
        "ram_load_pct": None,
        "total_power_w": None,
    }
