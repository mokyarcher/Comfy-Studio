from pathlib import Path

p = Path("/usr/local/frp/frps.toml")
text = p.read_text(encoding="utf-8") if p.exists() else ""
token = "Mqm1123581321."
pwd = "112358"
for line in text.splitlines():
    if "auth.token" in line and "=" in line:
        token = line.split("=", 1)[1].strip().strip('"')
    if "webServer.password" in line and "=" in line:
        pwd = line.split("=", 1)[1].strip().strip('"')

new = f"""bindPort = 7000
auth.method = "token"
auth.token = "{token}"

proxyBindAddr = "127.0.0.1"
allowPorts = [
  {{ start = 11434, end = 11434 }},
  {{ start = 18000, end = 18000 }},
  {{ start = 18001, end = 18001 }}
]

webServer.addr = "127.0.0.1"
webServer.port = 7500
webServer.user = "admin"
webServer.password = "{pwd}"
"""
p.write_text(new, encoding="utf-8")
print(p.read_text(encoding="utf-8"))
