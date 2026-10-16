# Comfy Gateway Admin Web

外网管理台：密码 + Authenticator 动态码登录，审用户 / 看在线态 / 本地占用 GPU / 注销用户；
总览页可远程启停 ComfyUI、FRP，以及重启 FastAPI（本机 `.env` 需配置 `HOST_*`；每次操作再填 TOTP）。

线上：`https://comfy-gateway.sharex.team`

**依赖**：台式机上 FastAPI + frpc 已在跑（隧道通着）。远程启停走 FastAPI 的 `/v1/admin/host-services*`，**不是**再起一套 Electron。ComfyUI 本身不必事先在跑——可由总览远程拉起。

## 开发

```powershell
cd desktop\gateway-web
npm install
npm run dev
```

默认 `http://localhost:5174`，`/v1` 代理到本机 FastAPI `:8000`。

本机项目根 `.env`（与 FastAPI 同一份）：

```env
ADMIN_LOGIN_MODE=totp
ADMIN_PASSWORD=你的管理密码
# 生成密钥：
#   .\.venv\Scripts\python.exe -c "from app.totp import generate_totp_secret, otpauth_uri; s=generate_totp_secret(); print(s); print(otpauth_uri(secret=s))"
ADMIN_TOTP_SECRET=
ADMIN_SESSION_SECRET=一长串随机字符
CORS_ORIGINS=...,https://comfy-gateway.sharex.team,http://localhost:5174,http://127.0.0.1:5174

# 远程启停（可选但推荐）
HOST_SERVICES_ENABLED=true
HOST_COMFY_DIR=D:\path\to\ComfyUI
HOST_COMFY_LAUNCH=.venv\Scripts\python.exe main.py --listen 127.0.0.1 --port 8188
HOST_FRPC_PATH=
HOST_FRPC_CONFIG_PATH=
```

手机 Authenticator 导入 `ADMIN_TOTP_SECRET`（或扫码 `otpauth://`）后，用密码 + 6 位动态码登录。

可选：`ADMIN_LOGIN_MODE=sms` 时 API 提供短信 OTP（需腾讯云/阿里云签名模板，见根目录 `.env.example`）。当前本 SPA 仅对接 TOTP 登录页。

## 用户与在线

- 列表展示 `last_seen_at`：业务请求会刷新；约 `ACTIVE_USER_WINDOW_MINUTES`（默认 15）分钟内视为在线
- 「注销」→ `DELETE /v1/admin/users/{id}`：永久删除账号及云端画廊、展馆投稿、共享提示词、用量记录（不可删管理员）。需确认

## 本机服务（总览）

| 服务 | 可执行动作 |
|------|------------|
| ComfyUI | start / stop / force_stop |
| FRP | start / stop（停则断公网） |
| FastAPI | 仅 restart |

每次 action 弹窗再填 Authenticator 六位码。契约见 [`../docs/api-contract.md`](../docs/api-contract.md)。

## 构建与部署

```powershell
npm run build
# dist/ → 服务器 /var/www/comfy-gateway-admin
```

Nginx：[`deploy/comfy-gateway-admin.nginx.conf`](../../deploy/comfy-gateway-admin.nginx.conf)

1. DNS：`comfy-gateway.sharex.team` A 记录 → VPS IP  
2. 上传 `dist/` 到 `/var/www/comfy-gateway-admin`  
3. 启用 nginx 后：`certbot --nginx -d comfy-gateway.sharex.team`  
4. **台式机**（跑 FastAPI + frpc）的 `.env` 配好 `ADMIN_*` 与 `HOST_*`，`CORS_ORIGINS` 含该域名，并重启 FastAPI  
