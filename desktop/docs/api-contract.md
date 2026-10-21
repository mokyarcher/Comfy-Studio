# 现有 FastAPI 契约（脱敏）

> 以仓库 `app/main.py` 实测为准。桌面端必须兼容，不得擅自改字段。

## Base URL

- 本机：`http://127.0.0.1:8000`
- 公网 HTTPS（推荐，已备案域名）：`https://qwen-image-2-1.sharex.team`  
- 公网 HTTP 备用：`http://<SERVER_IP>:8080/qwen-image`  
  （8080 路径前缀由 Nginx 剥离；HTTPS 域名根路径直接反代本地 API）

客户端配置 Base URL 时**不要**末尾斜杠；请求路径拼接为 `{base}/health/ready`。

## 鉴权

- Header：`X-API-Key: <key>`
- 健康检查接口**不需要** Key
- 生图 / 任务 / 图片接口**需要** Key；错误返回 `401`

## 端点

### `GET /health/live`

```json
{ "status": "ok" }
```

### `GET /health/ready`

成功 `200`：

```json
{
  "status": "ready",
  "comfyui": "up",
  "max_steps": 40,
  "max_width": 1024,
  "max_height": 1024
}
```

`max_*` 来自服务端 `.env`（`MAX_STEPS` / `MAX_WIDTH` / `MAX_HEIGHT`），供 Studio 限制创作页输入。

ComfyUI 不可达时 `503`：

```json
{ "detail": { "status": "not_ready", "comfyui": "down" } }
```

### CORS（Web Studio / Gateway Admin）

- 环境变量 `CORS_ORIGINS`：逗号分隔浏览器 Origin 白名单；空字符串则不挂 CORS 中间件。
- 默认含官网、`app.comfy-studio.sharex.team`、`comfy-gateway.sharex.team`、本地 Vite `5173`（Studio）与 `5174`（Gateway Admin）。
- 推荐部署：`app` / `comfy-gateway` 同源反代 `/v1`、`/health`（见 `deploy/comfy-studio-app.nginx.conf`、`deploy/comfy-gateway-admin.nginx.conf`），可少依赖 CORS。
- 鉴权仍为 `X-API-Key`（非 Cookie）；浏览器拉图须 `fetch` + Blob，不可裸 `<img src>`。

### `POST /v1/images/upload`

Header：`X-API-Key`；`multipart/form-data` 字段 `file`。

- 后缀限 png/jpg/jpeg/webp/bmp/gif；大小 ≤ `MAX_UPLOAD_BYTES`（默认 15MB）
- 成功返回 `{ "filename": "<comfy-input-name>" }`，供 generate 的 `images[]` 使用

### `POST /v1/images/generate`

全局 **GPU 串行队列**：任意时刻最多 1 个 `running`；后来的请求进入 `queued`，按提交时间 FIFO。队满（`MAX_QUEUE_SIZE`，含排队+运行中）返回 `429 queue_full`。响应与 `GET /v1/tasks/{id}` 含 `queue_position` / `queue_ahead` / `queue_size`。

Header：`X-API-Key`、`Content-Type: application/json`

请求体：

```json
{
  "mode": "txt2img",
  "workflow_id": "qwen-default",
  "prompt": "a red fox in snow",
  "negative_prompt": "",
  "width": 1024,
  "height": 1024,
  "steps": 25,
  "seed": null,
  "images": [],
  "length": null
}
```

- `prompt` 必填；`mode`：`txt2img` | `image_edit` | `image_to_video`（默认 `txt2img`）
- `workflow_id`：可选；该 mode 下的具体管线（文生图可多套）。省略则用该 mode 的默认套。列表见 `GET /v1/workflows?mode=txt2img`（生成面 / GPU，非 Meta）
- `images`：先经 upload 得到的 Comfy 文件名；`image_edit` / `image_to_video` 需要
- `length`：仅图生视频可选帧长
- `seed` 省略时由服务端随机
- 尺寸需为 `SIZE_MULTIPLE`（默认 8）的倍数
- 文生图 / 图像编辑：每边 ≤ `MAX_WIDTH`/`MAX_HEIGHT`（默认 1024），且像素 ≤ `MAX_IMAGE_PIXELS`（默认 1024²）
- 图生视频：须落在 `MAX_VIDEO_LONG_SIDE`×`MAX_VIDEO_SHORT_SIDE` 框内（默认 800×496 或 496×800）

成功 `202`：

```json
{ "task_id": "uuid", "status": "queued" }
```

队列满：`429`；未知 `workflow_id`：`400 unknown_workflow`；参数错误：`422`；鉴权失败：`401`

### `GET /v1/workflows?mode=txt2img`

生成面（GPU）。返回该 mode 下已加载的管线列表：

```json
{
  "mode": "txt2img",
  "default": "qwen-default",
  "workflows": [
    {
      "id": "qwen-default",
      "display_name": "Qwen 文生图",
      "description": "默认文生图管线",
      "default": true,
      "mode": "txt2img"
    }
  ]
}
```

需 `X-API-Key`。云端分流须把 `/v1/workflows` 指到 GPU，勿进 Meta。

### `GET /v1/tasks/{task_id}`

状态：`queued` | `running` | `succeeded` | `failed`

`running` 且 ComfyUI 已开始采样时，可能带：

```json
{ "progress": { "value": 9, "max": 20, "percent": 45.0 } }
```

来自 ComfyUI WebSocket `progress`（当前采样段步数；多节点工作流会重置）。无 tick 时字段为 `null`/省略。

### `GET /v1/tasks/{task_id}/result`

成功时含 `images[]`，每项含 `index`、`filename`、`content_type`、`url`（相对路径如 `/v1/tasks/.../images/0`）

### `GET /v1/tasks/{task_id}/images/{index}`

返回图片/视频二进制；需 `X-API-Key`

### `POST /v1/tasks/{task_id}/purge`

隐私清理：删除服务端任务结果与可选 Comfy 输入输出；需 `X-API-Key`。客户端应先下载再 purge。

### 官方提示词库

- `GET /v1/prompt-library` → `{ version, updated_at, templates[], phrases[] }`（需 Key）

### 展馆（Showcase）

- `GET /v1/showcase` → `{ items[], count }`（含 `image_url` / `thumb_url` / `ref_urls`，拉媒体仍需 Key；含互动字段 `like_count` / `favorite_count` / `comment_count` / `liked_by_me` / `favorited_by_me`）
- `POST /v1/showcase`：`multipart` 主图 `image` + 元数据字段；可选 `refs`
- `POST /v1/showcase/{id}/unlist`：作者下架
- `POST /v1/showcase/{id}/like` · `/favorite` → 切换点赞/收藏，返回互动计数
- `GET|POST /v1/showcase/{id}/comments` · `DELETE .../comments/{comment_id}`：评论列表 / 发表（body≤500）/ 作者或管理员删除

### 私有云端画廊（Gateway 本机）

跨设备同步用，仅本人可见，存在 FastAPI 宿主机 `data/cloud_gallery/`（不是公网 VPS）。

- `GET /v1/cloud-gallery` → `{ items[], count }`
- `POST /v1/cloud-gallery`：`multipart` 字段同展馆（`image` + prompt/mode/尺寸等），支持图/视频
- `GET /v1/cloud-gallery/{id}/image` · `/thumb`（需 Key，且仅 owner）
- `DELETE /v1/cloud-gallery/{id}`

### 统一作品记录（`INSTANCE_ID` 隔离目录下的 `works.db`）

- `GET /v1/works` → `{ items[], count }`（含可选 `cloud_gallery_id` / `image_url`）
- `POST /v1/works` `{ prompt, mode, width, height, steps, seed?, remote_task_id?, cloud_gallery_id?, … }`
- `DELETE /v1/works/{id}`

部署：云 Meta 设 `ENABLE_GENERATION=false` + `INSTANCE_ID=…`；nginx 分流见 `deploy/comfy-studio-app.split.nginx.conf` 与 `docs/ARCHITECTURE_CLOUD_DATA.md`。

### `GET /v1/prompt/polish/status`

需 `X-API-Key`。查询网关 AI 润色是否启用、配额剩余。

### `POST /v1/prompt/polish`

需 `X-API-Key`。由**服务端**持有上游 DeepSeek/商汤等 Key，代为润色（Studio 不拿到上游 Key）。

请求体：

```json
{
  "prompt": "一只黑猫",
  "negative_prompt": "",
  "output_language": "match_input",
  "detail": "standard",
  "model_profile": "unknown",
  "generation_mode": "txt2img"
}
```

- `generation_mode`：`txt2img` | `image_edit` | `image_to_video`（默认 `txt2img`）。`image_to_video` 时服务端使用导演式视频润色 system prompt（运动/运镜优先，尊重起始图）。
- `model_profile`：`sd15` | `sdxl` | `flux` | `sd3` | `wan` | `unknown`（视频建议 `wan`）。

成功 `200`：含 `enhanced_prompt`、`added_details`、`quota` 等。  
配额用尽 / 过频：`429`；服务端未配置：`503`。

服务端 `.env`：`POLISH_ENABLED`、`POLISH_AI_BASE_URL`、`POLISH_AI_API_KEY`、`POLISH_AI_MODEL`、`POLISH_RATE_PER_MINUTE`。

### `GET /v1/system/gpu`

任意已鉴权用户可查 GPU / 队列负荷（Studio 顶栏「空闲 / 繁忙」）。

成功 `200`：

```json
{
  "state": "idle",
  "queue_running": 0,
  "queue_queued": 0,
  "local_hold": false
}
```

- `state`：`idle` | `busy`（`local_hold` 或队列有 running/queued 即为 `busy`）
- 需 `X-API-Key`；未鉴权 `401`

### 提示词译文

- `POST /v1/prompt/translate` `{ "text": "...", "direction": "en2zh"|"zh2en" }` → `{ "translation": "...", "source": "...", "direction": "..." }`
- `direction` 默认 `en2zh`（兼容画廊「查看译文」）；`zh2en` 供创作页中译英
- 复用润色上游（`POLISH_*`）；仅限流，不扣日润色配额
- **服务端持久化缓存**（`data/translate_cache.db`，按原文 SHA-256；`zh2en` 与 `en2zh` 分键）：命中则不再打上游，全用户共享
- 服务端只返回译文；是否写回输入框由客户端决定（创作页双译会写回，画廊仅展示）

### 共享提示词库（玩家投稿，与官方库分离）

需 `X-API-Key`。只存模板，不含短语。

- `GET /v1/prompt-library/shared` → `{ items: [{ id, title, prompt, negative_prompt, tags, author_name, author_username, created_at, mine }], count }`
- `POST /v1/prompt-library/shared` `{ title, prompt, negative_prompt?, tags? }` → 201，来源取当前用户
- `DELETE /v1/prompt-library/shared/{id}` → 仅作者
- `GET /v1/admin/prompt-library/shared` / `DELETE /v1/admin/prompt-library/shared/{id}` → 管理员

### 多用户（注册待审 + 名额池）

- 首次启动：若 `users.db` 为空，将 `.env` 的 `API_KEY` 导入为**管理员**（Gateway 管理用，不占名额）。
- 用户自助：
  - `POST /v1/auth/register` `{username, password, display_name?, email}` → `pending`（尚无 Key；邮箱唯一）
  - `POST /v1/auth/login` `{ username, password }` → `username` 可为**用户名或已绑定邮箱**；仅 `active` 返回 `api_key` + `email`；pending/rejected/disabled 返回 403
  - `GET /v1/auth/profile`（`X-API-Key`）→ `{ user_id, username, name, email }`
  - `POST /v1/auth/email`（`X-API-Key`）`{ password, email }` → 校验当前密码后绑定/更换找回邮箱（**不发邮件**）
  - `POST /v1/auth/password-reset/send` `{ email }` → 向已绑定邮箱发验证码（`cooldown_seconds`）；未绑定 404
  - `POST /v1/auth/password-reset` `{ email, code, new_password, confirm_password }`
  - `POST /v1/auth/change-password`（需用户自己的 `X-API-Key`）`{old_password, new_password}`
  - 邮件：`.env` 的 `MAIL_*`；`MAIL_DRY_RUN=true` 时验证码打日志
- 管理员（Header `X-API-Key` = 管理员 Key，**或** Gateway Admin Web 的 `admin_session` Cookie）：
  - `GET /v1/admin/stats`（含 `pending_users`、`pool_remaining`、`max_approved_users`）
  - `GET /v1/admin/users` → 含 `last_seen_at`（业务请求会刷新；Admin Web 用 `ACTIVE_USER_WINDOW_MINUTES` 默认 15 分钟内视为在线）
  - `POST /v1/admin/users/{id}/approve` → 自动生成 Key（受 `MAX_APPROVED_USERS` 限制）
  - `POST /v1/admin/users/{id}/reject`
  - `DELETE /v1/admin/users/{id}` → 注销用户：删除账号及云端画廊 / 展馆投稿 / 共享提示词 / 作品记录 / 用量记录（不可删管理员）；响应含 `cloud_gallery_deleted` / `showcase_deleted` / `shared_prompts_deleted` / `works_deleted`
  - `POST /v1/admin/users/{id}/reset-password` → 返回临时密码（忘密时由管理员重置）
  - `PATCH /v1/admin/users/{id}`、`POST .../rotate-key`
  - `GET|POST /v1/admin/local-hold`
  - `GET|POST /v1/admin/host-services*` → 见下文「本机服务启停」
- 业务接口仍用 `X-API-Key`；按用户计日限额。全局队列受 `MAX_QUEUE_SIZE` 限制。

### 管理员登录（Gateway Admin Web）

浏览器**不存**主 API Key；会话 Cookie `admin_session`（HttpOnly）。

默认 `ADMIN_LOGIN_MODE=totp`（密码 + Authenticator，无需短信资质）：

- `POST /v1/auth/admin/login` `{ password, totp_code }` → Set-Cookie
- `POST /v1/auth/admin/logout` → 清除会话
- `GET /v1/auth/me` → 需管理员会话或管理员 Key

可选 `ADMIN_LOGIN_MODE=sms`（需 `ADMIN_PHONE` + 腾讯云/阿里云签名模板）：

- `POST /v1/auth/sms/send` `{ phone }` / `POST /v1/auth/sms/verify` `{ phone, code }`

配置见根目录 `.env.example`。前端：`desktop/gateway-web/`；域名：`https://comfy-gateway.sharex.team`。

## 本地启动（Gateway 应复用）

```text
工作目录：API 项目根目录
命令：{venv}\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
环境：读取项目根 .env（含 API_KEY、COMFYUI_URL 等）
```

也可调用现有 `scripts/start_api.ps1`。

## FRP（Gateway 应复用）

```text
可执行文件：frpc.exe
配置：含 qwen-image-api 代理，localPort=8000 → remotePort=18000
```

## ComfyUI 探测

```text
GET {COMFYUI_URL}/system_stats  → 200 视为可达
```

## Admin：本机服务启停（Gateway Web）

需管理员会话（cookie）或管理员 API Key。跑在 **GPU 本机** 的 FastAPI 内执行；Admin Web 只发指令。

本机 `.env`：

- `HOST_SERVICES_ENABLED`（默认 true；false 时接口仍可读状态，但 action 拒绝）
- `HOST_COMFY_DIR` / `HOST_COMFY_LAUNCH`（在目录下执行；**须用 ComfyUI 自带 `.venv`**）
- `HOST_FRPC_PATH` / `HOST_FRPC_CONFIG_PATH`

```text
GET  /v1/admin/host-services
  → { enabled, services: [{ id, label, ok, state, message, pid?, configured, detail }] }

POST /v1/admin/host-services/action
  body: {
    "service": "comfy"|"api"|"frp",
    "action": "start"|"stop"|"force_stop"|"restart",
    "totp_code": "123456"   // Authenticator 六位动态码（每次启停必填）
  }
  → { ok, message, services }
```

- `comfy`：start / stop / force_stop  
- `frp`：start / stop（停止会断开公网隧道）  
- `api`：仅 restart（远程无法在 API 已离线时再拉起）  
- 动态码错误 → `401`；未配置 `ADMIN_TOTP_SECRET` → `503`；未启用 / 未配置路径 → `400` 类业务错误  

Electron Gateway 仍可本机直接启停 ComfyUI / API / FRP（不经此接口），设置里可勾选开机自启三项。


## 未支持（客户端勿发送）

- CFG / sampler / batch 等未在契约中的字段
- 任意工作流 JSON 上传
- 取消远程 GPU 任务
