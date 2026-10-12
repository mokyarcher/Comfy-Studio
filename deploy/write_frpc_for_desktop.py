import re
from pathlib import Path

text = Path("/usr/local/frp/frps.toml").read_text(encoding="utf-8")
match = re.search(r'auth\.token\s*=\s*"([^"]+)"', text)
token = match.group(1) if match else "REPLACE_TOKEN"

# One frpc can carry both Ollama and Image API proxies.
content = f'''serverAddr = "111.229.166.216"
serverPort = 7000
auth.method = "token"
auth.token = "{token}"

transport.tls.enable = true

[[proxies]]
name = "ollama-api"
type = "tcp"
localIP = "127.0.0.1"
localPort = 11434
remotePort = 11434

[[proxies]]
name = "qwen-image-api"
type = "tcp"
localIP = "127.0.0.1"
localPort = 8000
remotePort = 18000
'''
Path("/root/frpc.qwen-image.toml").write_text(content, encoding="utf-8")
print("wrote /root/frpc.qwen-image.toml")
print(content.replace(token, "***"))
