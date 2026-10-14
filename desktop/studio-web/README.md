# Comfy Studio Web

浏览器端远程创作工作空间。与 Electron Studio 共用 FastAPI 契约；密钥默认存 `sessionStorage`，画廊用 IndexedDB。

## 开发

```powershell
cd desktop\studio-web
npm install
npm run dev
```

浏览器打开终端提示的地址（默认 `http://localhost:5173`）。本机还需先起 FastAPI（`:8000`），Vite 会把 `/v1`、`/health` 代理过去。

背景图已压到约 1920 宽；开发服对 `/backgrounds/*` 开了长缓存，硬刷新仍会重下，普通刷新可复用。

跨域直连时设置：

```env
VITE_API_BASE=https://qwen-image-2-1.sharex.team
```

并确保 API `.env` 的 `CORS_ORIGINS` 含当前页面 Origin。

## 构建与部署

```powershell
npm run build
# 产物 dist/ → 服务器 /var/www/comfy-studio-app
```

Nginx 模板：[`deploy/comfy-studio-app.nginx.conf`](../../deploy/comfy-studio-app.nginx.conf)（同源反代 `/v1` + SPA）。

## 安全

- 勿在公用电脑勾选「记住账号」
- 禁止在浏览器配置上游润色 Key；只用网关 `/v1/prompt/polish*`
- 生成成功后默认 purge；关闭页面前确认画廊已写入
