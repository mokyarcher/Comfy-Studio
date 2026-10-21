# Comfy Studio · 项目速览（新对话可先贴这段）

一句话：**本机 GPU 出图，公网 HTTPS 入口；用户/画廊/展馆等权威数据在云 Meta（按 `INSTANCE_ID` 隔离）。**

```text
Studio / Admin（浏览器或 Electron）
  → 云 Nginx
      ├─ 数据面 → 云 Meta :8101   # 登录邮箱、提示词、works、画廊、展馆赞藏评…
      └─ 生成面 → FRP :18000 → 本机 FastAPI → ComfyUI :8188 → GPU
```

| 块 | 路径 | 干什么 |
|----|------|--------|
| API | `app/` | FastAPI：生成队列、鉴权、润色代理、展馆、Meta/生成角色 |
| 工作流 | `llm_workflow/` | Comfy 文生图 / 图编 / 图生视频 + mapping |
| Web Studio | `desktop/studio-web` | 浏览器创作；部署 `/var/www/comfy-studio-app` |
| Electron Studio | `desktop/studio` | 桌面创作客户端 |
| Gateway | `desktop/gateway` + `gateway-web` | 本机启停 / 外网审用户（TOTP） |
| 官网 | `web/` | Astro 营销站 |
| 云数据说明 | `docs/ARCHITECTURE_CLOUD_DATA.md` | Meta、`INSTANCE_ID`、分流 nginx |
| 契约 | `desktop/docs/api-contract.md` | 前后端 API |
| 待办 | `docs/TODO.md` | 下一步功能 |
| Agent 约束 | `AGENTS.md` | 改代码必读 |

**硬约束**：不暴露 Comfy `8188`；不提交真实 `.env`/Key；账号相关验收以云端为准；拉代码只跟 GitHub `origin`。

**常用运维**：Web Studio `npm run build` → 云 `/var/www/comfy-studio-app`；Meta 更新 `scripts/deploy_cloud_meta.ps1`（合并远端 `.env`，不整盖密钥）。
