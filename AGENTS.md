# AGENTS.md — 给 AI / 开发者的工程指南

> 面向改代码的人（含 Cursor Agent）。产品说明与快速上手见根目录 `README.md`；长篇设计/部署文见 `docs/`。

## 一句话架构

```text
Studio（远程客户端）
  → HTTPS/公网 Nginx → FRP → 本机 FastAPI（app/）
  → ComfyUI → 本地 GPU

Gateway（本机控制台）
  → 启停 FastAPI / frpc、用户与监控、提示词库管理、工作流相关运维
```

推理永远在本机 GPU；云端只做入口与转发。**不要**把 ComfyUI `8188` 暴露到公网。

## 仓库地图

| 路径 | 职责 |
|------|------|
| `app/` | FastAPI：任务队列、鉴权、工作流注入、润色代理、展馆、提示词库 |
| `llm_workflow/` | ComfyUI API/UI 工作流与 `*_mapping.json`（**运行时路径默认在这里**） |
| `desktop/gateway` | Electron 服务端控制台 |
| `desktop/gateway-web` | 浏览器端 Gateway 管理台（密码+TOTP，审用户 / hold） |
| `desktop/studio` | Electron 远程创作客户端 |
| `desktop/studio-web` | 浏览器端 Studio 工作空间（Vite + React） |
| `desktop/shared` / `desktop/*/src/shared` | 桌面端共享类型与契约 |
| `web/` | 官方网站（Astro）：介绍 / 演示 / 部署 / 下载 |
| `scripts/` | 启动、巡检、UI→API 工作流转换；`start_stack.ps1` 一键 ComfyUI+API+frpc+Studio（路径见 `stack.local.json`） |
| `tests/` | pytest |
| `docs/` | 实施/部署/排障长文 |
| `other/` | 杂项资产（如本地润色库 JSON），**不进运行时默认路径** |
| `data/` | 运行时 DB/图片（gitignore） |
| `deploy/` | 云端/FRP 相关模板 |

## 生成模式（API / Studio）

| mode | 工作流文件（均在 `llm_workflow/`） | 要点 |
|------|----------------------------------|------|
| `txt2img` | `workflow_api.json` + `workflow_mapping.json` | Qwen 文生图 |
| `image_edit` | `workflow_image_edit_*` | 底图/参考图；提示词可用 `<image1>` / `<image2>` |
| `image_to_video` | `workflow_image_to_video_*` | Wan TI2V；起始图 + 镜头提示；超时更长 |

改图流程：

1. ComfyUI 里调通 → **Export (API)** 或用 `scripts/convert_*_ui_to_api.py`
2. 覆盖 `llm_workflow/` 下对应 API JSON
3. 用 `scripts/inspect_workflow.py` 核对节点，再改 mapping
4. **禁止**凭空编造 node_id / input 名

环境变量见 `.env.example`（`WORKFLOW_*`、`IMAGE_EDIT_*`、`IMAGE_TO_VIDEO_*`）。

## 后端约定（`app/`）

- 配置入口：`app/config.py` + 根目录 `.env`（相对路径相对**仓库根**解析）
- 任务异步：`POST` 返回 `task_id`，客户端轮询；结果图落 `data/images`
- 鉴权：`X-API-Key`；用户/配额相关见 `user_store` / `polish_quota`
- AI 润色：`/v1/prompt/polish*` —— **上游 Key 只留服务端**（`POLISH_*`）；Studio 默认走网关代理
- 隐私：成功下载后可清理任务与 Comfy 输入输出；不要在日志打印完整 Key
- 本地占用：`local_hold` —— Gateway 可「本地占用 GPU」，避免与远程任务抢卡

测试：

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

改工作流后至少跑：`tests/test_workflow.py`。

## 桌面端约定（`desktop/`）

### 分工

- **Gateway**：管本机服务、用户审核、官方提示词库维护、玩家共享库审核删除、hold 开关等
- **Studio**：登录会话、创作（文生图/图编/图生视频）、队列、画廊、展馆、本地/官方/共享提示词库

### UI / 文案

- 大道至简：少 `page-desc`、少问号长 tip、空状态短句即可
- 账号体系用语用「账号」而不是「配置/多 Profile 下拉」
- 占位提示跟界面语言一致（中文 UI 不要塞英文 placeholder，除非协议字面量如 `<image1>`）

### 打包（Windows）

```powershell
# Studio
cd desktop\studio
# 若 Access denied：先结束 "Comfy Studio" 进程，再改名/删旧 win-unpacked
npm run dist:dir   # → release\win-unpacked\Comfy Studio.exe

# Gateway
cd desktop\gateway
npm run dist:dir   # → release\win-unpacked\Comfy Gateway.exe
```

- 图标：`desktop/*/resources/icon.png`（Gateway 另有托盘 `tray*.png`，经 `extraResources` 打进包）
- 当前默认目标多为 `dir`（解压即用）；NSIS 需在线工具时再开

### 开发

```powershell
cd desktop\gateway   # 或 studio / studio-web / gateway-web
npm install
npm run dev
```

Web Studio：`desktop/studio-web`（Vite）；部署见 `deploy/comfy-studio-app.nginx.conf`。  
Gateway Admin Web：`desktop/gateway-web`（默认端口 5174）；部署见 `deploy/comfy-gateway-admin.nginx.conf`。本机 `.env` 配 `ADMIN_LOGIN_MODE=totp` + `ADMIN_PASSWORD` + `ADMIN_TOTP_SECRET`（Authenticator）；短信模式可选。  
API 需配置 `CORS_ORIGINS`（或同源反代 `/v1`）。

契约补充：`desktop/docs/api-contract.md`。

## 文档放哪

| 类型 | 位置 |
|------|------|
| 用户/运维快速上手 | `README.md` |
| Agent / 开发约束（本文） | `AGENTS.md` |
| 长篇设计、部署、排障 | `docs/` |
| 桌面端说明 | `desktop/README.md` |
| Web Studio | `desktop/studio-web/README.md` |
| Gateway Admin Web | `desktop/gateway-web/README.md` |
| 官方网站 | `web/README.md` |

改架构或目录约定时，**同步更新本文**，避免 Agent 按旧路径瞎改。

## Cursor Agent 执行授权

主人已授权本仓库的常规运维，**Agent 应直接执行、不要反复要批准**：

| 操作 | 说明 |
|------|------|
| 云机 `root@111.229.166.216` | `ssh` / `scp` / `rsync` 部署 Web Studio 与相关 nginx |
| 路径 | `/var/www/comfy-studio-app`、`/var/www/comfy-gateway-admin`、背景图、`app.comfy-studio` / `comfy-gateway.sharex.team` 证书与站点 |
| 本地 | `desktop/studio-web` / `gateway-web` 的 `npm run build`、pytest、用户已要求的 git commit |

配置落点（提交进仓库）：

- `.cursor/permissions.json` — Auto-review 放行指引 + 终端白名单  
- `.cursor/rules/deploy-authorization.mdc` — alwaysApply 规则  

请在 Cursor Settings → Agents → **Run Mode** 使用 **Auto-review**（或 Allowlist / Run Everything）。`permissions.json` 只在启用了 Run Mode 时生效。若仍弹批准，可对本机临时改用 Run Everything。

## 安全与禁区

- 不提交真实 `.env`、API Key、上游润色 Key
- 不把 ComfyUI / FastAPI 绑到公网 `0.0.0.0` 当「临时方便」
- 不在渲染进程明文落盘 Studio 密钥（走主进程 `safeStorage` + IPC）
- Web Studio 密钥仅 sessionStorage（可选 localStorage「记住」）；禁止浏览器存上游润色 Key
- 不做「取消远端 GPU 任务」——后端若无取消接口，UI 只能移除本地记录并说清楚
- 不对 `main`/`master` force-push；不在服务器上做与本项目无关的破坏性清盘

## 常见坑

1. **工作流还在根目录？** 已迁到 `llm_workflow/`；旧 `.env` 路径要跟着改。
2. **打包 Access denied**：目标 exe 仍在运行。
3. **节点报错**：先在 ComfyUI UI 用同一工作流出图，再查自定义节点与 mapping。
4. **502 / 连不上**：先 Gateway 侧 API+FRP，再 Studio「测试连接」；错误文案保持短、带状态码即可。

## 改动优先级建议

1. 能只改 `llm_workflow/*_mapping.json` 就不动代码  
2. 能只改 Studio/Gateway UI 就不动 FastAPI 契约  
3. 改 API 契约时同步 `desktop/docs/api-contract.md` 与两端客户端  
4. 大改前先跑相关 pytest / `npm run typecheck`
