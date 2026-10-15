# FRP + Nginx HTTPS 部署说明

目标：外网通过 `https://你的域名` 访问本地 FastAPI，**不暴露** ComfyUI `8188`。

## 端口规划

| 端口 | 角色 | 公网 |
|------|------|------|
| 22 | SSH | 限制来源 |
| 7000 | frpc ↔ frps | 建议限来源 + 强 token |
| 80 / 443 | 证书与 HTTPS API | 443 对外开放 |
| 18000 | Nginx → FRP | **仅 127.0.0.1** |
| 8000 | 本地 FastAPI | 仅本机 |
| 8188 | ComfyUI | **禁止映射** |

## 1. 云服务器 frps

安装与 frpc **同版本**的官方 FRP Release，例如配置 `/etc/frp/frps.toml`：

```toml
bindPort = 7000
auth.method = "token"
auth.token = "REPLACE_WITH_STRONG_FRP_TOKEN"

# 代理端口只给本机 Nginx 用
proxyBindAddr = "127.0.0.1"
allowPorts = [
  { start = 18000, end = 18000 }
]
```

systemd 示例 `/etc/systemd/system/frps.service`：

```ini
[Unit]
Description=FRP Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/frps -c /etc/frp/frps.toml
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now frps
ss -lntp | grep 18000   # 应只见 127.0.0.1:18000 或暂无（等 frpc 连上）
```

防火墙 / 安全组：开放 443、（按需）7000；**不要**对公网开放 18000。

## 2. 本地 Windows frpc

`frpc.toml` 示例：

```toml
serverAddr = "YOUR_SERVER_PUBLIC_IP"
serverPort = 7000
auth.method = "token"
auth.token = "REPLACE_WITH_STRONG_FRP_TOKEN"

transport.tls.enable = true

[[proxies]]
name = "comfy-image-api"
type = "tcp"
localIP = "127.0.0.1"
localPort = 8000
remotePort = 18000
```

先确保本地 API 已启动，再运行 `frpc.exe -c frpc.toml`。

云端验收：

```bash
curl -sS http://127.0.0.1:18000/health/ready
```

## 3. Nginx + HTTPS

DNS：`img-api.example.com` A 记录指向云服务器。

```nginx
server {
    listen 80;
    server_name img-api.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name img-api.example.com;

    ssl_certificate     /etc/letsencrypt/live/img-api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/img-api.example.com/privkey.pem;

    client_max_body_size 4m;

    location / {
        proxy_pass http://127.0.0.1:18000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 30s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
    }
}
```

证书可用 Certbot 申请。异步提交不必把超时拉到整次 GPU 时长。

公网验收：

```bash
curl -sS https://img-api.example.com/health/ready
curl -sS -o /dev/null -w "%{http_code}\n" https://img-api.example.com/v1/images/generate
# 期望 401（缺 Key）
```

## 4. 同机 SPA 管理台 / Web Studio（可选）

API 仍走 FRP `18000`；静态站可另开子域，同源反代 `/v1` + `/health`：

| 站点 | 配置 | 静态目录 |
|------|------|----------|
| Web Studio | `deploy/comfy-studio-app.nginx.conf` | `/var/www/comfy-studio-app` |
| Gateway Admin | `deploy/comfy-gateway-admin.nginx.conf` | `/var/www/comfy-gateway-admin` |

Gateway Admin 登录：台式机 `.env` 配 `ADMIN_LOGIN_MODE=totp` + `ADMIN_PASSWORD` + `ADMIN_TOTP_SECRET`（见根目录 `.env.example`）。

## 5. 生产配置提醒

- `.env` 中 `ENABLE_DOCS=false`
- `API_KEY` 与 FRP `auth.token` 使用不同长随机串
- Key 只放可信后端（Joy 等），不要进 App/前端
- 本地电脑勿睡眠；断网/关机时公网无法出图，属预期

## 6. 排障顺序

1. `http://127.0.0.1:8188/system_stats` — ComfyUI
2. `http://127.0.0.1:8000/health/ready` — 本地 API
3. 云端 `http://127.0.0.1:18000/health/ready` — FRP
4. `https://域名/health/ready` — Nginx / DNS / 证书

不要同时改多层配置。
