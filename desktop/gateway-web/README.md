# Comfy Gateway Admin Web

外网管理台：密码 + Authenticator 动态码登录，审用户 / 看状态 / 本地占用 GPU / 注销用户。

不包含启停 API / FRP（仍用本机 Electron Gateway）。

线上：`https://comfy-gateway.sharex.team`

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
```

手机 Authenticator 导入 `ADMIN_TOTP_SECRET`（或扫码 `otpauth://`）后，用密码 + 6 位动态码登录。

可选：`ADMIN_LOGIN_MODE=sms` 时 API 提供短信 OTP（需腾讯云/阿里云签名模板，见根目录 `.env.example`）。当前本 SPA 仅对接 TOTP 登录页。

## 用户注销

用户列表「注销」→ `DELETE /v1/admin/users/{id}`：永久删除账号及云端画廊、展馆投稿、共享提示词、用量记录（不可删管理员）。需确认。

## 构建与部署

```powershell
npm run build
# dist/ → 服务器 /var/www/comfy-gateway-admin
```

Nginx：[`deploy/comfy-gateway-admin.nginx.conf`](../../deploy/comfy-gateway-admin.nginx.conf)

1. DNS：`comfy-gateway.sharex.team` A 记录 → VPS IP  
2. 上传 `dist/` 到 `/var/www/comfy-gateway-admin`  
3. 启用 nginx 后：`certbot --nginx -d comfy-gateway.sharex.team`  
4. **台式机**（跑 FastAPI + frpc）的 `.env` 配好 `ADMIN_*`，`CORS_ORIGINS` 含该域名，并重启 FastAPI  
