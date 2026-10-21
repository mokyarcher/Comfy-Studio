# AGENTS.md — 给 AI / 开发者的工程指南

> 面向改代码的人（含 Cursor Agent）。  
> **新对话速览**先看 [`docs/PROJECT_BRIEF.md`](docs/PROJECT_BRIEF.md)；产品上手见根目录 `README.md`；长篇设计/部署见 `docs/`。

## 一句话架构

```text
Studio（远程客户端）
 → HTTPS/公网 Nginx
    ├─ 数据面（云机 Meta：INSTANCE_ID 隔离）提示词 / 用户 / works / 画廊 / 展馆
    └─ 生成面（FRP → 本机 FastAPI）/v1/images /v1/tasks → ComfyUI → 本地 GPU

Gateway（本机 Electron）
 → 启停 ComfyUI / FastAPI / frpc、开机自启勾选、用户与监控、提示词库、工作流运维

Gateway Admin Web（外网）
 → 审用户 / hold / 注销；总览可远程启停本机 ComfyUI·FRP·重启 API（需 HOST_* + 每次 TOTP）
```

推理永远在本机 GPU；**权威用户内容按 `INSTANCE_ID` 落在云机**（见 `docs/ARCHITECTURE_CLOUD_DATA.md`）。**不要**把 ComfyUI `8188` 暴露到公网。共用隧道时不同产品链必须不同 `INSTANCE_ID` / Meta 进程，禁止串库。

## 仓库地图

| 路径 | 职责 |
|------|------|
| `app/` | FastAPI：任务队列、鉴权、工作流注入、润色代理、展馆、提示词库、本机服务启停（`host_services`） |
| `llm_workflow/` | ComfyUI API/UI 工作流与 `*_mapping.json`（**运行时路径默认在这里**） |
| `desktop/gateway` | Electron 服务端控制台（含 ComfyUI 启停与开机自启） |
| `desktop/gateway-web` | 浏览器端 Gateway 管理台（TOTP；审用户 / 在线态 / hold / 注销 / 远程启停） |
| `desktop/studio` | Electron 远程创作客户端（账号登录、展馆点赞/收藏/评论） |
| `desktop/studio-web` | 浏览器端 Studio（邮箱注册/找回、云画廊、展馆互动、最近预览清除） |
| `desktop/shared` / `desktop/*/src/shared` | 桌面端共享类型与契约 |
| `web/` | 官方网站（Astro）：毛玻璃气质 + ICP 页脚；介绍 / 演示 / 部署 / 下载 |
| `scripts/` | 启动、巡检、UI→API 转换；`start_stack.ps1`；**`deploy_cloud_meta.ps1`**（云 Meta 部署，合并远端 `.env` 不整文件覆盖密钥）；`migrate_data_to_instance.py` |
| `tests/` | pytest |
| `docs/` | 实施/部署/排障长文（云数据面见 `ARCHITECTURE_CLOUD_DATA.md`；待办见 `TODO.md`） |
| `other/` | 杂项资产（如本地润色库 JSON），**不进运行时默认路径** |
| `data/` | 运行时 DB/图片（gitignore；生产按 `INSTANCE_ID` 落 `data/instances/…`） |
| `deploy/` | 云端/FRP 相关模板（含 `comfy-studio-app.split.nginx.conf` 数据面/生成面分流） |

## 生成模式（API / Studio）

| mode | 工作流文件（均在 `llm_workflow/`） | 要点 |
|------|----------------------------------|------|
| `txt2img` | `txt2img/<workflow_id>/`（`workflow_api.json` + `workflow_mapping.json` + `meta.json`）；可多套，请求用 `workflow_id` | 默认 `qwen-default`；扁平旧路径仍作回退 |
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
- 本机服务启停：`app/host_services.py` + `GET|POST /v1/admin/host-services*`；`.env` 配 `HOST_COMFY_DIR` / `HOST_COMFY_LAUNCH`（须用 ComfyUI 自己的 `.venv`，勿用系统 Python）/ `HOST_FRPC_*` / `HOST_LHM_PATH`（LibreHardwareMonitor）；可用 `HOST_SERVICES_ENABLED=false` 关掉远程启停。每次 action 须再填 Authenticator 动态码
- 主机传感器：`GET /v1/system/host-metrics`（生成面）代理本机 LHM `Data.json` 摘要；**勿**把 `8085` 暴露公网

测试：

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

改工作流后至少跑：`tests/test_workflow.py`。

## 桌面端约定（`desktop/`）

### 分工

- **Gateway（Electron）**：本机 ComfyUI / FastAPI / frpc 启停与开机自启、用户审核、官方提示词库、玩家共享库审核删除、hold 开关等
- **Gateway Admin Web**：外网审用户（含 `last_seen_at` 在线/离线）、hold、注销；总览远程启停（依赖台式机 FastAPI 已在跑 + `HOST_*`）
- **Studio**：登录会话、创作（文生图/图编/图生视频）、队列、画廊、展馆（含点赞/收藏/评论）、本地/官方/共享提示词库；Web Studio 另可「保存至云端」（私有 cloud gallery，权威在云 Meta）
- **Studio Web 账号**：注册可填邮箱；设置页绑定找回邮箱；登录支持用户名或已绑定邮箱；忘记密码走邮件 OTP（`MAIL_*`）
- **Studio Web「最近作品 · 清除」**：仅从创作页预览隐藏（localStorage），**不删** IndexedDB / 云端画廊 / works

### UI / 文案

- 大道至简：少 `page-desc`、少问号长 tip、空状态短句即可
- 账号体系用语用「账号」而不是「配置/多 Profile 下拉」
- 占位提示跟界面语言一致（中文 UI 不要塞英文 placeholder，除非协议字面量如 `<image1>`）
- Studio Web 小操作钮用液态玻璃（`.glass-cta-btn-sm`），与「保存至云端」开关同行同高、同字号

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

Web Studio：`desktop/studio-web`（Vite）；部署见 `deploy/comfy-studio-app.nginx.conf`。生产若已拆云 Meta，用 `deploy/comfy-studio-app.split.nginx.conf`（数据类 → Meta，生成类 → FRP）。  
云 Meta 部署：`.\scripts\deploy_cloud_meta.ps1`（详见 `docs/ARCHITECTURE_CLOUD_DATA.md`）。  
Gateway Admin Web：`desktop/gateway-web`（默认端口 5174）；部署见 `deploy/comfy-gateway-admin.nginx.conf`。本机 `.env` 配 `ADMIN_LOGIN_MODE=totp` + `ADMIN_PASSWORD` + `ADMIN_TOTP_SECRET`（Authenticator）；短信模式可选；远程启停另配 `HOST_*`。  
API 需配置 `CORS_ORIGINS`（或同源反代 `/v1`）。

契约补充：`desktop/docs/api-contract.md`。

### Gateway 启停注意

- ComfyUI 启动：桌面版用其目录下 `.venv\Scripts\python.exe`；Windows 便携版选 `ComfyUI_windows_portable`（或外层安装夹），Gateway / `HOST_COMFY_*` 会改用 `python_embeded`。勿用系统 Python（常缺 alembic/sqlalchemy）
- Electron「启动全部」可按勾选拉起 ComfyUI → API → FRP；Admin Web 侧停 FRP / 重启 API 会短暂断公网隧道

## 文档放哪

| 类型 | 位置 |
|------|------|
| 用户/运维快速上手 | `README.md` |
| Agent / 开发约束（本文） | `AGENTS.md` |
| 长篇设计、部署、排障 | `docs/` |
| 产品/工程待办 | `docs/TODO.md` |
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
5. **ComfyUI 启不来 / 缺包**：多半用了系统 `python`，改回 ComfyUI `.venv` 启动命令。
6. **Admin Web 远程启停无效**：确认台式机 FastAPI 在跑、`.env` 已配 `HOST_*` 且 `HOST_SERVICES_ENABLED=true`，操作时填对 TOTP。

## 改动优先级建议

1. 能只改 `llm_workflow/*_mapping.json` 就不动代码  
2. 能只改 Studio/Gateway UI 就不动 FastAPI 契约  
3. 改 API 契约时同步 `desktop/docs/api-contract.md` 与两端客户端  
4. 大改前先跑相关 pytest / `npm run typecheck`
