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
                ],
            }
        ],
    }
    s = summarize_lhm_tree(tree)
    assert s["cpu_name"] and "7950X" in s["cpu_name"]
    assert s["gpu_name"] and "4090" in s["gpu_name"]
    assert s["cpu_temp_c"] == 62.4
    assert s["cpu_load_pct"] == 18.5
    assert s["gpu_temp_c"] == 71.0
    assert s["gpu_hotspot_c"] == 82.0
    assert s["gpu_load_pct"] == 95.0
    assert s["gpu_mem_load_pct"] == 40.0
    assert s["gpu_mem_used_mb"] == 10240.0
    assert s["gpu_mem_total_mb"] == 24576.0
    assert s["gpu_power_w"] == 350.0
    assert s["gpu_fan_rpm"] == 2100.0
