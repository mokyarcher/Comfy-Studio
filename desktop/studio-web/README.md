# Comfy Studio Web

浏览器端远程创作工作空间。与 Electron Studio 共用 FastAPI 契约；会话密钥默认存 `sessionStorage`（可勾选「记住账号」写 localStorage），本地画廊用 IndexedDB。

生产拓扑多为 **云 Meta（用户 / 画廊 / 展馆 / works）+ FRP 生成面**，见 [`../../docs/ARCHITECTURE_CLOUD_DATA.md`](../../docs/ARCHITECTURE_CLOUD_DATA.md)。功能验收以云端为准（见仓库 `.cursor/rules/test-on-cloud.mdc`）。

## 能力摘要

| 能力 | 说明 |
|------|------|
| 账号 | 注册（可填邮箱）→ 审核；登录可用**用户名或已绑定邮箱**；设置页绑定/更换找回邮箱；忘记密码走邮件 OTP |
| 创作 | 文生图 / 图编辑 / 图生视频；网关润色与翻译 |
| 最近作品 | 预览条可开关；「清除」仅藏预览（localStorage），**不删** IndexedDB / 云端 |
| 保存至云端 | 成功后上传 `/v1/cloud-gallery`（权威在云 Meta，不是本机 Gateway 独占库） |
| 作品记录 | 出图成功后写 `/v1/works` |
| 展馆 | 分享 / 下架；点赞、收藏、评论（与 Electron Studio 同一套 API） |

契约见 [`../docs/api-contract.md`](../docs/api-contract.md)。

## 开发

```powershell
cd desktop\studio-web
npm install
npm run dev
```

浏览器打开终端提示的地址（默认 `http://localhost:5173`）。本机开发可把 Vite 代理到本机 FastAPI（`:8000`）；联调账号/画廊/展馆时优先打云端同源 `/v1`。

背景图在 `public/backgrounds/`（含 `preview/` 缩略图）；开发服对 `/backgrounds/*` 开了长缓存，硬刷新仍会重下，普通刷新可复用。

跨域直连时设置：

```env
VITE_API_BASE=https://app.comfy-studio.sharex.team
```

并确保 API / Meta `.env` 的 `CORS_ORIGINS` 含当前页面 Origin。

## 构建与部署

```powershell
npm run build
# 产物 dist/ → 服务器 /var/www/comfy-studio-app
# 背景图若有增删：同步上传 public/backgrounds/（或确保 build 已打进 dist）
```

Nginx：

- 整包反代（旧）：[`deploy/comfy-studio-app.nginx.conf`](../../deploy/comfy-studio-app.nginx.conf)
- **数据面 / 生成面分流**（现网）：[`deploy/comfy-studio-app.split.nginx.conf`](../../deploy/comfy-studio-app.split.nginx.conf)

## 安全

- 勿在公用电脑勾选「记住账号」
- 禁止在浏览器配置上游润色 Key；只用网关 `/v1/prompt/polish*`
- 生成成功后默认 purge；关闭页面前确认本地画廊已写入（云端另走「保存至云端」/ works）
