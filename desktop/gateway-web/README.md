# Comfy Gateway Admin Web

外网管理台：手机短信验证码登录（仅 `ADMIN_PHONE`），审用户 / 看状态 / 本地占用 GPU。

不包含启停 API / FRP（仍用本机 Electron Gateway）。

## 开发

```powershell
cd desktop\gateway-web
npm install
npm run dev
```

默认 `http://localhost:5174`，`/v1` 代理到本机 FastAPI `:8000`。

本机 `.env` 需配置（腾讯云短信示例）：

```env
ADMIN_PHONE=你的手机号
SMS_PROVIDER=tencent
SMS_DRY_RUN=false
SMS_SECRET_ID=...
SMS_SECRET_KEY=...
SMS_SDK_APP_ID=1400xxxxxx
SMS_SIGN_NAME=已审核签名
SMS_TEMPLATE_ID=1234567
SMS_REGION=ap-guangzhou
```

模板内容需含验证码变量（一般 1 个参数，填入 6 位码）。本地可先 `SMS_DRY_RUN=true`，验证码打在 API 日志。

## 构建与部署

```powershell
npm run build
# dist/ → 服务器 /var/www/comfy-gateway-admin
```

Nginx：[`deploy/comfy-gateway-admin.nginx.conf`](../../deploy/comfy-gateway-admin.nginx.conf)

线上域名：`https://comfy-gateway.sharex.team`

1. DNS：`comfy-gateway.sharex.team` A 记录 → VPS IP  
2. 上传 `dist/` 到 `/var/www/comfy-gateway-admin`  
3. 启用 nginx 配置后：`certbot --nginx -d comfy-gateway.sharex.team`  
4. Gateway 本机 `.env` 配好 `ADMIN_PHONE` / 短信（或 `SMS_DRY_RUN=true`），`CORS_ORIGINS` 含该域名，并重启 FastAPI
