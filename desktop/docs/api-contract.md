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

### CORS（Web Studio）

- 环境变量 `CORS_ORIGINS`：逗号分隔浏览器 Origin 白名单；空字符串则不挂 CORS 中间件。
- 默认含官网、`app.comfy-studio.sharex.team`、本地 Vite `5173`。
- 推荐部署：`app` 同源反代 `/v1`、`/health`（见 `deploy/comfy-studio-app.nginx.conf`），可少依赖 CORS。
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

队列满：`429`；参数错误：`422`；鉴权失败：`401`

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

- `GET /v1/showcase` → `{ items[], count }`（含 `image_url` / `thumb_url` / `ref_urls`，拉媒体仍需 Key）
- `POST /v1/showcase`：`multipart` 主图 `image` + 元数据字段；可选 `refs`
- `POST /v1/showcase/{id}/unlist`：作者下架

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
  - `POST /v1/auth/register` `{username, password, display_name?}` → `pending`（尚无 Key）
  - `POST /v1/auth/login` → 仅 `active` 返回 `api_key`；pending/rejected/disabled 返回 403
  - `POST /v1/auth/change-password`（需用户自己的 `X-API-Key`）`{old_password, new_password}`
- 管理员（Header `X-API-Key` = 管理员 Key）：
  - `GET /v1/admin/stats`（含 `pending_users`、`pool_remaining`、`max_approved_users`）
  - `GET /v1/admin/users`
  - `POST /v1/admin/users/{id}/approve` → 自动生成 Key（受 `MAX_APPROVED_USERS` 限制）
  - `POST /v1/admin/users/{id}/reject`
  - `POST /v1/admin/users/{id}/reset-password` → 返回临时密码（忘密时由管理员重置）
  - `PATCH /v1/admin/users/{id}`、`POST .../rotate-key`
- 业务接口仍用 `X-API-Key`；按用户计日限额。全局队列受 `MAX_QUEUE_SIZE` 限制。

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

## 未支持（客户端勿发送）

- CFG / sampler / batch 等未在契约中的字段
- 任意工作流 JSON 上传
- 取消远程 GPU 任务
