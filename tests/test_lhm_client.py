from __future__ import annotations

from app.lhm_client import summarize_lhm_tree


def test_summarize_lhm_tree_cpu_gpu():
    tree = {
        "Text": "Sensor",
        "Children": [
            {
                "Text": "DESKTOP",
                "Children": [
                    {
                        "Text": "AMD Ryzen 9 7950X",
                        "Children": [
                            {
                                "Text": "Temperatures",
                                "Children": [
                                    {"Text": "CPU Package", "Value": "62.4 °C"},
                                ],
                            },
                            {
                                "Text": "Load",
                                "Children": [
                                    {"Text": "CPU Total", "Value": "18.5 %"},
                                ],
                            },
                            {
                                "Text": "Powers",
                                "Children": [
                                    {"Text": "Package", "Value": "88.0 W"},
                                ],
                            },
                        ],
                    },
                    {
                        "Text": "NVIDIA GeForce RTX 4090",
                        "Children": [
                            {
                                "Text": "Temperatures",
                                "Children": [
                                    {"Text": "GPU Core", "Value": "71.0 °C"},
                                    {"Text": "GPU Hot Spot", "Value": "82.0 °C"},
                                ],
                            },
                            {
                                "Text": "Load",
                                "Children": [
                                    {"Text": "GPU Core", "Value": "95.0 %"},
                                    {"Text": "GPU Memory", "Value": "40.0 %"},
                                ],
                            },
                            {
                                "Text": "Data",
                                "Children": [
                                    {"Text": "Memory Used", "Value": "10240 MB"},
                                    {"Text": "Memory Total", "Value": "24576 MB"},
                                ],
                            },
                            {
                                "Text": "Powers",
                                "Children": [
                                    {"Text": "GPU Package", "Value": "350.0 W"},
                                ],
                            },
                            {
                                "Text": "Fans",
                                "Children": [
                                    {"Text": "GPU Fan", "Value": "2100 RPM"},
                                ],
                            },
                        ],
                    },
                    {
                        "Text": "Virtual Memory",
                        "Children": [
                            {
                                "Text": "Data",
                                "Children": [
                                    {"Text": "Memory Used", "Value": "40.0 GB"},
                                    {"Text": "Memory Available", "Value": "20.0 GB"},
                                ],
                            },
                        ],
                    },
                    {
                        "Text": "Total Memory",
                        "Children": [
                            {
                                "Text": "Load",
                                "Children": [
                                    {"Text": "Memory", "Value": "42.5 %"},
                                ],
                            },
                            {
                                "Text": "Data",
                                "Children": [
                                    {"Text": "Memory Used", "Value": "13.6 GB"},
                                    {"Text": "Memory Available", "Value": "18.4 GB"},
                                ],
                            },
                        ],
                    },
                ],
            }
        ],
    }
    s = summarize_lhm_tree(tree)
    assert s["cpu_name"] and "7950X" in s["cpu_name"]
    assert s["gpu_name"] and "4090" in s["gpu_name"]
    assert s["cpu_temp_c"] == 62.4
    assert s["cpu_load_pct"] == 18.5
    assert s["cpu_power_w"] == 88.0
    assert s["gpu_temp_c"] == 71.0
    assert s["gpu_hotspot_c"] == 82.0
    assert s["gpu_load_pct"] == 95.0
    assert s["gpu_mem_load_pct"] == 40.0
    assert s["gpu_mem_used_mb"] == 10240.0
    assert s["gpu_mem_total_mb"] == 24576.0
    assert s["gpu_power_w"] == 350.0
    assert s["gpu_fan_rpm"] == 2100.0
    assert s["ram_load_pct"] == 42.5
    assert s["ram_used_mb"] == 13.6 * 1024
    assert s["ram_total_mb"] == round(13.6 * 1024 + 18.4 * 1024, 1)
    assert s["total_power_w"] == 438.0


def test_summarize_ignores_cpu_distance_to_tjmax():
    """Distance-to-TjMax is headroom (~70°C idle), not die temperature."""
    tree = {
        "Text": "Sensor",
        "Children": [
            {
                "Text": "12th Gen Intel Core i5-12400F",
                "Children": [
                    {
                        "Text": "Temperatures",
                        "Children": [
                            {"Text": "CPU Package", "Value": "34.0 °C"},
                            {"Text": "Core Max", "Value": "33.0 °C"},
                            {"Text": "Core Average", "Value": "32.0 °C"},
                            {"Text": "CPU Core #1", "Value": "31.0 °C"},
                            {"Text": "CPU Distance to TjMax", "Value": "68.0 °C"},
                            {"Text": "CPU Core #1 Distance to TjMax", "Value": "72.0 °C"},
                        ],
                    },
                ],
            }
        ],
    }
    s = summarize_lhm_tree(tree)
    assert s["cpu_temp_c"] == 32.0


def test_summarize_cpu_temp_falls_back_to_core_sensors():
    tree = {
        "Text": "Sensor",
        "Children": [
            {
                "Text": "12th Gen Intel Core i5-12400F",
                "Children": [
                    {
                        "Text": "Temperatures",
                        "Children": [
                            {"Text": "CPU Core #1 Distance to TjMax", "Value": "72.0 °C"},
                            {"Text": "CPU Core #1", "Value": "31.0 °C"},
                            {"Text": "CPU Core #2", "Value": "33.0 °C"},
                        ],
                    },
                ],
            }
        ],
    }
    s = summarize_lhm_tree(tree)
    assert s["cpu_temp_c"] == 33.0


def test_summarize_ignores_d3d_shared_memory_for_vram():
    """NVIDIA LHM lists Shared after Used; Shared must not overwrite VRAM."""
    tree = {
        "Text": "Sensor",
        "Children": [
            {
                "Text": "NVIDIA GeForce RTX 5070",
                "Children": [
                    {
                        "Text": "Data",
                        "Children": [
                            {"Text": "GPU Memory Free", "Value": "9534.0 MB"},
                            {"Text": "GPU Memory Used", "Value": "2692.0 MB"},
                            {"Text": "GPU Memory Total", "Value": "12227.0 MB"},
                            {"Text": "D3D Dedicated Memory Used", "Value": "2428.3 MB"},
                            {"Text": "D3D Shared Memory Used", "Value": "432.6 MB"},
                        ],
                    },
                ],
            }
        ],
    }
    s = summarize_lhm_tree(tree)
    assert s["gpu_mem_used_mb"] == 2692.0
    assert s["gpu_mem_total_mb"] == 12227.0
