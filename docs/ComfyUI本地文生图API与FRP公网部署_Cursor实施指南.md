# ComfyUI 本地文生图 API + FRP 公网部署实施指南

> **用途：** 将本地 Windows 电脑上的 ComfyUI 文生图工作流封装为受 API Key 保护的 HTTP API，再通过 FRP 反向代理和云服务器上的 HTTPS 域名提供给外部程序调用。
>
> **交付方式：** 将本文档交给 Cursor 作为工程需求说明。把 ComfyUI 导出的 API 格式工作流 `workflow_api.json` 一并放入项目目录；Cursor 必须根据真实工作流配置节点映射，不能凭空猜节点 ID。

---

## 0. 给 Cursor 的总任务说明

请按本文档在当前项目中实现完整方案，尽量直接创建代码、配置模板、脚本、测试和部署文档，不要只输出建议或伪代码。

### 实现原则

1. 先检查当前工作区和已有文件；不要覆盖或删除无关项目文件。
2. 使用 Python + FastAPI 封装本地 ComfyUI HTTP API；ComfyUI 本身和模型继续运行在本地，不搬到云端。
3. 通过 `workflow_api.json` 和独立的 `workflow_mapping.json` 配置工作流节点映射。**不得假定提示词、采样器、尺寸节点的 ID 一定是某些固定数字。**
4. 启动时校验工作流及映射：节点 ID 或输入字段无效时，给出明确错误和定位信息，不要静默忽略。
5. 对外 API 采用“提交任务 → 返回 `task_id` → 查询任务状态 → 获取图片”的异步模式，不让客户端长时间等待一次 HTTP 请求。
6. 同一台 GPU 默认一次只执行一个 API 生图任务；任务持久化到 SQLite，重启后不能把未完成任务错误地报告成成功。
7. 使用环境变量或 `.env` 存储密钥和地址；不能将真实 API Key、FRP token、服务器密码写入代码或提交到 Git。
8. 对公网只提供经过 HTTPS 和 API Key 保护的封装 API；不能将 ComfyUI 的 `8188` 端口直接暴露公网。
9. 提供可执行的 Windows PowerShell 启动脚本、Linux `frps`/Nginx 配置示例、单元测试、API 调用示例及故障排查章节。
10. 如果当前目录没有真实的 `workflow_api.json`，仍然完成 API、数据库、FRP 模板及测试框架，但清楚标出需要用户放入工作流后才能完成的步骤；不要伪造节点映射。
11. 优先使用稳定且清晰的代码结构、类型注解、日志和错误处理。禁止把完整提示词、API Key 或 FRP token 写入日志。
12. 执行可运行的测试并修正问题。最终汇总已创建文件、启动方式、需要用户填写的配置和测试结果。

### 目标运行链路

```text
Joy Bot / 外部网站 / 其他程序
        │ HTTPS + API Key
        ▼
域名：例如 https://img-api.example.com
        │
        ▼
云服务器 Nginx（TLS 证书、请求转发）
        │ http://127.0.0.1:18000
        ▼
云服务器 frps（18000 只监听本机回环地址）
        ▲
        │ FRP 加密隧道，通常 TCP 7000
        │
本地 Windows：frpc
        │ 转发到 127.0.0.1:8000
        ▼
FastAPI 封装服务（127.0.0.1:8000）
        │
        ▼
ComfyUI（127.0.0.1:8188）
        │
        ▼
本地 GPU 加载工作流与模型并生成图片
```

**云服务器负责公网入口和转发，不负责模型推理。** 本地电脑关机、休眠、断网或 ComfyUI 停止时，公网生图服务也无法完成任务。

---

## 1. 项目范围与边界

### 必须实现

- 对本地 ComfyUI 可用性进行检查。
- 使用 ComfyUI API 格式的工作流 JSON 提交生图任务。
- 外部调用方只传递提示词、负面提示词、尺寸、步数和种子等允许修改的参数。
- 服务端读取固定工作流并只修改配置中明确允许改动的节点输入。
- API Key 鉴权、参数校验、任务排队、状态查询、结果下载。
- SQLite 记录任务状态、ComfyUI `prompt_id`、时间戳、错误摘要和输出图片元数据。
- 单 GPU 默认串行执行；队列有长度上限，防止请求无限堆积。
- 生成的图片保存到 API 项目的数据目录，不依赖 ComfyUI 临时历史文件长期存在。
- FRP 将本地 API 转发到云服务器；Nginx 通过 HTTPS 对外提供服务。
- 本地测试、云端部署、日常启动、日志和故障排查说明。

### 第一版暂不实现

- 不上传或提供任意工作流 JSON 给外部用户执行。
- 不允许用户选择本地模型文件路径、任意文件路径或任意 ComfyUI 节点。
- 不开放 ComfyUI 管理界面、`/queue`、`/free`、`/interrupt` 等内部管理接口给公网。
- 不直接暴露 `8188` 端口。
- 不实现多台 GPU 的分布式调度、付费计费系统或多租户管理；接口结构可为后续扩展留好位置。

---

## 2. 运行前需要准备的内容

### 2.1 本地 Windows 电脑

- ComfyUI 已安装，目标文生图工作流可以在 UI 中正常生成图片。
- ComfyUI 默认地址通常是 `http://127.0.0.1:8188`；如果你修改过端口，以真实设置为准。
- Python 3.11 或项目兼容的 Python 版本。
- FRP Windows 客户端 `frpc.exe`。FRP 下载应使用官方 Release，并尽量让客户端与服务端使用匹配版本。
- 从 ComfyUI UI 导出的 API 格式工作流 `workflow_api.json`。

### 2.2 云服务器

- 一台有公网 IP 的 Linux 云服务器。
- 可管理服务器防火墙、安全组、Nginx 和 systemd。
- 一个可配置 DNS 的域名或子域名，例如 `img-api.example.com`。
- 可申请有效 HTTPS/TLS 证书（例如通过 Certbot/Let's Encrypt）。
- 可安装官方 FRP 服务端 `frps`。

### 2.3 需要用户自己填写的值

文档中的地址、域名和密钥均为示例，不能直接照抄上线：

| 配置项 | 示例 | 要求 |
|---|---|---|
| ComfyUI 地址 | `http://127.0.0.1:8188` | 以本机实际端口为准 |
| FastAPI 本地端口 | `8000` | 建议只绑定 `127.0.0.1` |
| FRP 服务端地址 | `YOUR_SERVER_PUBLIC_IP` | 填云服务器公网 IP 或可解析地址 |
| FRP 服务端端口 | `7000` | 安全组只开放给需要的客户端来源更佳；家用 IP 变化时依赖强 token |
| FRP 代理端口 | `18000` | FRPS 应仅监听 `127.0.0.1`，供 Nginx 本机访问 |
| 公网域名 | `img-api.example.com` | DNS A 记录指向云服务器公网 IP |
| API Key | 长随机字符串 | 只存放在服务端与可信调用方，不要公开 |
| FRP token | 另一条长随机字符串 | 与 API Key 分开，frps/frpc 必须完全一致 |

---

## 3. 导出 ComfyUI API 工作流

1. 打开 ComfyUI，载入已经验证可以正常出图的工作流。
2. 在 ComfyUI 设置中启用开发者模式（不同版本的菜单名称可能不同）。
3. 使用 **Save (API Format)** 或对应版本的 API 格式工作流保存功能，导出 JSON。
4. 将其放到 API 项目根目录，文件名定为 `workflow_api.json`。
5. 不要把普通 UI 工作流 JSON 误当成 API 格式工作流。API 格式通常包含以节点 ID 为键的节点对象、`class_type` 和 `inputs` 等字段。
6. 先在 ComfyUI UI 中确认工作流能出图，再使用 API 测试；这样可以将模型/插件错误与 API 封装错误区分开。

### 工作流映射配置

Cursor 必须创建 `workflow_mapping.json`，由该文件告诉程序需要替换哪些节点输入。下面只是结构示例，节点 ID 和输入名必须从用户提供的真实 JSON 中确认：

```json
{
  "positive_prompt": { "node_id": "POSITIVE_NODE_ID", "input": "text" },
  "negative_prompt": { "node_id": "NEGATIVE_NODE_ID", "input": "text" },
  "width": { "node_id": "LATENT_NODE_ID", "input": "width" },
  "height": { "node_id": "LATENT_NODE_ID", "input": "height" },
  "steps": { "node_id": "SAMPLER_NODE_ID", "input": "steps" },
  "seed": { "node_id": "SAMPLER_NODE_ID", "input": "seed" }
}
```

注意事项：

- `POSITIVE_NODE_ID` 这类文本只是占位符，真实 JSON 中应填写实际节点 ID。
- 一些采样器的种子字段叫 `seed`，另一些节点可能使用 `noise_seed`；以真实输入字段为准。
- 如果工作流没有负面提示词节点，允许在映射中将该项设为 `null`，并由 API 明确忽略 `negative_prompt` 或返回清晰的配置错误；两种行为必须在 README 中说明。
- 不同模型工作流可能没有 `Empty Latent Image` 节点，也可能通过其他节点控制宽高或批次。不要只按 SD1.5/SDXL 的常见结构写死。
- 启动时校验每个配置映射：节点是否存在、`inputs` 是否存在、目标输入字段是否存在。
- 外部调用方不允许传入任意节点 ID 或输入字段名。

建议在项目中提供脚本 `scripts/inspect_workflow.py`，打印各节点的 ID、`class_type` 与 `inputs` 字段名，辅助用户配置映射。不要把敏感路径或整个工作流内容打到公网日志。

---

## 4. 建议的项目结构

Cursor 根据当前项目结构适配；如果当前目录为空，可以采用下面布局：

```text
comfy-image-api/
├─ app/
│  ├─ __init__.py
│  ├─ main.py                 # FastAPI 应用与路由
│  ├─ config.py               # 环境变量配置、路径与限制
│  ├─ schemas.py              # 请求/响应数据模型
│  ├─ auth.py                 # API Key 验证
│  ├─ comfy_client.py         # ComfyUI HTTP API 客户端
│  ├─ workflow.py             # 工作流读取、校验、参数替换
│  ├─ database.py             # SQLite 数据访问
│  ├─ worker.py               # 单 GPU 任务消费者
│  ├─ task_service.py         # 任务提交、状态与结果逻辑
│  └─ logging_config.py       # 日志配置与敏感字段过滤
├─ scripts/
│  ├─ inspect_workflow.py
│  ├─ check_local.ps1
│  └─ start_api.ps1
├─ data/
│  ├─ tasks.db                # 启动后生成，不提交 Git
│  └─ images/                 # 生图结果，不提交 Git
├─ tests/
│  ├─ test_workflow.py
│  ├─ test_api_auth.py
│  ├─ test_validation.py
│  └─ test_task_service.py
├─ workflow_api.json          # 用户导出的工作流，不要自动伪造
├─ workflow_mapping.json      # 真实节点 ID 映射
├─ .env                       # 本地真实配置，不提交 Git
├─ .env.example               # 无真实密钥的模板
├─ .gitignore
├─ requirements.txt
├─ README.md
└─ DEPLOY_FRP_NGINX.md        # 云服务器配置与排查
```

### `.gitignore` 必须包括

```gitignore
.venv/
__pycache__/
.pytest_cache/
.env
*.log
data/
```

`workflow_api.json` 是否忽略由用户决定；若工作流内包含本地路径、模型文件信息或私人参数，默认建议不要提交公共仓库。

---

## 5. Python 环境与依赖

建议依赖：

```text
fastapi
uvicorn[standard]
httpx
python-dotenv
```

SQLite 使用 Python 标准库即可。测试依赖可以放进 `requirements-dev.txt`，例如 `pytest`、`pytest-asyncio`、`respx`（用于模拟 HTTP）等。不要为了简单而在 ComfyUI 自己的 Python 环境中盲目升级 PyTorch 或其他推理依赖；API 服务可使用单独虚拟环境。

### Windows 初始化命令

在项目根目录执行：

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
Copy-Item .env.example .env
```

如本机没有 Python 3.11，Cursor 应根据安装环境调整命令，并在 README 写明实际版本。

### `.env.example` 建议字段

```dotenv
APP_ENV=development
HOST=127.0.0.1
PORT=8000

COMFYUI_URL=http://127.0.0.1:8188
COMFYUI_TIMEOUT_SECONDS=30
COMFYUI_POLL_INTERVAL_SECONDS=1.5
COMFYUI_JOB_TIMEOUT_SECONDS=900

API_KEY=replace-with-a-long-random-secret
DATABASE_PATH=data/tasks.db
IMAGE_OUTPUT_DIR=data/images
WORKFLOW_PATH=workflow_api.json
WORKFLOW_MAPPING_PATH=workflow_mapping.json

MAX_QUEUE_SIZE=20
MAX_PROMPT_LENGTH=2000
MAX_NEGATIVE_PROMPT_LENGTH=2000
MAX_WIDTH=1536
MAX_HEIGHT=1536
MAX_IMAGE_PIXELS=2097152
MAX_STEPS=60
ENABLE_DOCS=true
```

`.env` 中的 `API_KEY` 必须更改为高强度随机值。`ENABLE_DOCS=true` 只用于本地开发；公网生产环境应关闭文档端点，或通过独立鉴权/来源限制进行保护。

---

## 6. FastAPI 功能要求

### 6.1 健康检查

- `GET /health/live`：只确认 API 进程正在运行。
- `GET /health/ready`：检测 ComfyUI 是否可连接；成功返回简洁状态，失败返回 `503`。
- 健康检查不得返回服务器环境变量、密钥、磁盘完整路径或系统详细信息。
- 可以让健康检查不要求 API Key，但返回内容必须最小化。所有生图、任务查询和图片下载接口都必须鉴权。

### 6.2 提交生图任务

`POST /v1/images/generate`

请求头：

```http
X-API-Key: <API_KEY>
Content-Type: application/json
```

请求体示例：

```json
{
  "prompt": "一只黑色机械巨兽，电影级光影，细节丰富",
  "negative_prompt": "模糊，低质量",
  "width": 1024,
  "height": 1024,
  "steps": 25,
  "seed": 123456789
}
```

成功时建议返回 HTTP `202 Accepted`：

```json
{
  "success": true,
  "task_id": "服务端生成的唯一任务 ID",
  "status": "queued",
  "status_url": "/v1/tasks/服务端生成的唯一任务 ID",
  "result_url": "/v1/tasks/服务端生成的唯一任务 ID/result"
}
```

校验要求：

- `prompt` 非空且不超过配置的最大长度。
- `negative_prompt` 不超过配置的最大长度。
- `width`、`height` 必须是正整数、在配置允许范围内，并满足工作流所需的倍数限制（常见为 8，但不能忽略真实模型约束）。
- `width * height` 不能超过 `MAX_IMAGE_PIXELS`。
- `steps` 限制在 `1..MAX_STEPS`。
- `seed` 可选；若提供，必须是受支持范围内的整数。不提供则由服务端生成随机种子。
- 第一版固定 batch size 为 1；不要允许匿名用户设置巨大批次数量。
- 队列达到 `MAX_QUEUE_SIZE` 时返回 `429` 或 `503`，不要继续无限接收任务。
- 非法 API Key 返回 `401`；参数无效返回 `422`；ComfyUI 暂时不可用返回 `503`。

### 6.3 查询任务状态

`GET /v1/tasks/{task_id}`

返回示例：

```json
{
  "task_id": "...",
  "status": "running",
  "created_at": "ISO-8601 时间",
  "started_at": "ISO-8601 时间或 null",
  "finished_at": null,
  "progress": null,
  "error": null
}
```

状态建议：`queued`、`running`、`succeeded`、`failed`。如果需要显示百分比进度，后续可以接 ComfyUI WebSocket 事件；第一版轮询历史时没有可靠百分比就返回 `null`，不要伪造进度。

### 6.4 查询结果

`GET /v1/tasks/{task_id}/result`

成功示例：

```json
{
  "task_id": "...",
  "status": "succeeded",
  "images": [
    {
      "index": 0,
      "filename": "image.png",
      "content_type": "image/png",
      "url": "/v1/tasks/.../images/0"
    }
  ]
}
```

- 任务尚未完成时返回清晰状态，不返回伪造图片地址。
- 失败时返回通用错误信息和安全的错误摘要，不返回密钥、完整本地路径或内部堆栈。
- `GET /v1/tasks/{task_id}/images/{image_index}` 必须鉴权，并以图片二进制形式返回。
- 图片路由只能访问数据库记录中该任务实际生成的图片，禁止直接接受任意文件路径，避免路径穿越漏洞。
- 结果图片保存到 `IMAGE_OUTPUT_DIR/<task_id>/`，必要时提供配置化清理策略。

### 6.5 身份验证与日志

- 使用 `X-API-Key` 头，服务端通过常量时间比较（如 `secrets.compare_digest`）验证。
- 绝不能把 API Key 作为 URL query 参数；URL 经常会进入访问日志。
- 不在日志中记录 API Key、FRP token、完整提示词或 Base64 图片。
- 可以记录 task_id、状态、耗时、图片数量和不包含秘密的错误摘要。
- API Key 应通过环境变量加载，不写进仓库、README、截图或测试报告。
- 如将接口提供给不完全可信的第三方，后续应增加速率限制、用户配额和轮换 API Key 的机制。

**移动 App 安全提醒：** 不要把长期有效的主 API Key 硬编码进公开分发的 Android/iOS 客户端，因为安装包可能被逆向提取。移动 App 应调用你自己的受认证业务后端，由后端再访问生图 API。Joy 的可信服务端进程可直接保存服务端密钥。

---

## 7. ComfyUI API 调用逻辑

FastAPI 的 `comfy_client.py` 应负责所有 ComfyUI 网络请求，其他模块不要自行拼接请求。

### 7.1 提交工作流

向本机 ComfyUI 提交：

```http
POST http://127.0.0.1:8188/prompt
Content-Type: application/json
```

请求体结构：

```json
{
  "prompt": {
    "<节点 ID>": {
      "class_type": "节点类型",
      "inputs": {}
    }
  },
  "client_id": "唯一客户端 ID"
}
```

以上结构仅用于说明外层形状；真正的 `prompt` 字段必须是导出的完整 API 工作流，不能用这段示例代替。成功后保存 ComfyUI 返回的 `prompt_id`。

### 7.2 轮询任务历史

调用：

```http
GET http://127.0.0.1:8188/history/{prompt_id}
```

程序需要：

1. 按配置的间隔轮询，直到有完成结果、明确失败或超时。
2. 设置单任务最大等待时间，例如 900 秒，可通过环境变量调整。
3. 识别 ComfyUI 返回的任务执行错误；不能只因为 History 对象存在就当作成功。
4. 如果任务超时或服务断开，更新数据库状态为 `failed`，写入安全错误摘要。
5. 按 History 中的 `outputs` 找到图片记录，而不是猜测输出节点 ID。

### 7.3 下载图片

对每条 History 输出图片，调用 ComfyUI 的 `/view` 接口，使用 History 提供的 `filename`、`subfolder` 和 `type` 等字段读取图片二进制数据，然后保存到本项目自己的图片目录。

注意：ComfyUI 输出结构可能因工作流节点而异。程序应遍历 History 的所有输出节点，收集 `images` 数组，不应硬编码唯一输出节点。对不属于图片的输出类型，第一版可以忽略并写日志。

### 7.4 与 ComfyUI 并发的关系

- FastAPI 自身的任务队列默认只允许一个 API 任务调用 ComfyUI；防止多请求同时争抢显卡。
- 本地用户也可能同时在 ComfyUI UI 中点击生成。API 封装服务无法自动阻止 UI 自己的任务，因此需要在 README 说明二者会共享 ComfyUI 队列和 GPU。
- 第一版使用**一个 Uvicorn worker 进程**。如果 Uvicorn 开多个 worker，每个进程会各自启动任务消费者，可能突破单 GPU 限制。
- SQLite 保存任务信息；重启时发现之前为 `running` 的任务，应查询 ComfyUI History 尝试恢复状态，无法确认时标记为 `failed`（错误摘要为“服务重启时任务状态无法确认”），不能直接标记成功。

---

## 8. SQLite 数据模型建议

至少建立 `tasks` 与 `task_images` 两张表。

### tasks

- `task_id`：服务端生成 UUID，主键。
- `status`：queued/running/succeeded/failed。
- `request_json`：经过验证的请求参数。提示词属于用户内容，需明确本地保留策略，避免在普通日志记录。
- `comfy_prompt_id`：可空。
- `created_at`、`started_at`、`finished_at`。
- `error_code`、`error_message`：使用安全、简短的内部状态描述。
- `seed`：最终使用的种子。

### task_images

- `id`：主键。
- `task_id`：关联 tasks。
- `image_index`：任务中的图片序号。
- `filename`：保存后的安全文件名。
- `relative_path`：相对于数据根目录的受控路径。
- `content_type`：例如 `image/png`。
- `created_at`。

数据库访问要使用参数化 SQL；写入任务状态应使用事务。图片下载端点不能直接把用户请求的路径拼接为系统绝对路径。

---

## 9. 本地启动与测试

### 9.1 确认 ComfyUI 在本机可访问

先启动 ComfyUI，然后在 PowerShell 执行：

```powershell
curl.exe -f http://127.0.0.1:8188/system_stats
```

如果失败，先解决 ComfyUI 的启动、端口、防火墙或模型加载问题。不要继续排查 API 或 FRP。

### 9.2 检查工作流

在 API 项目根目录运行：

```powershell
.\.venv\Scripts\Activate.ps1
python scripts\inspect_workflow.py
```

依据输出填写 `workflow_mapping.json`。再运行项目提供的校验命令，例如：

```powershell
python -m app.workflow --check
```

上面校验命令只是建议接口名，Cursor 实现后应在 README 中写实际命令。

### 9.3 启动 API

```powershell
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

正式的 `start_api.ps1` 应从项目根目录正确加载 `.env`，检测 Python 虚拟环境和配置文件，输出明确错误后退出。

### 9.4 测试健康状态

```powershell
curl.exe -i http://127.0.0.1:8000/health/live
curl.exe -i http://127.0.0.1:8000/health/ready
```

如果本地开发模式启用了 API 文档，可以访问：

`http://127.0.0.1:8000/docs`

公网生产环境不要无保护地暴露 `/docs` 与 `/openapi.json`。

### 9.5 测试提交任务

将以下命令中的 Key 换成本机 `.env` 中的值：

```powershell
$headers = @{
  "X-API-Key" = "替换为实际 API Key"
}
$body = @{
  prompt = "一只黑色机械巨兽，电影级光影，细节丰富"
  negative_prompt = "模糊，低质量"
  width = 1024
  height = 1024
  steps = 25
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri "http://127.0.0.1:8000/v1/images/generate" `
  -Method Post `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $body
```

保存响应中的 `task_id`，再查询：

```powershell
$taskId = "替换为返回的 task_id"
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8000/v1/tasks/$taskId" `
  -Headers $headers
```

任务成功后：

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8000/v1/tasks/$taskId/result" `
  -Headers $headers
```

根据结果中的图片 URL，使用相同的 `X-API-Key` 下载图片。Cursor 应在 README 中提供完整 PowerShell 下载示例。

---

## 10. FRP 云端配置

> 下面配置示例基于当前 FRP TOML 风格。不同 FRP 版本的字段支持可能不同；安装后先用对应版本的配置验证命令或启动日志确认。不要把示例中的 token 原样用于正式环境。

### 10.1 云服务器安装 FRP

1. 从官方 Release 页面下载与云服务器操作系统和 CPU 架构匹配的压缩包：<https://github.com/fatedier/frp/releases>
2. 解压到例如 `/opt/frp/`。
3. 将 `frps`、`frps.toml` 放在受控目录。
4. 使用单独的 Linux 系统用户运行服务为更佳做法。

### 10.2 `frps.toml` 示例

```toml
bindAddr = "0.0.0.0"
bindPort = 7000

# 关键：FRP 代理的 remotePort 仅允许本机 Nginx 通过回环地址访问。
# 如果当前版本不支持此项，必须使用等效方案并通过 ss/netstat 确认 18000 不对公网监听。
proxyBindAddr = "127.0.0.1"

auth.method = "token"
auth.token = "请替换为高强度独立 FRP token"

# 只允许此 FRP 服务映射所需端口。
allowPorts = [
  { single = 18000 }
]
```

`bindPort=7000` 是 frpc 连接 frps 的控制端口；`remotePort=18000` 是映射 API 服务的代理端口。两者用途不同。

启动测试：

```bash
cd /opt/frp
./frps -c ./frps.toml
```

确认日志中没有配置错误。以 systemd 服务运行前，先手动验证客户端可连接。

### 10.3 Windows 本地 `frpc.toml` 示例

```toml
serverAddr = "YOUR_SERVER_PUBLIC_IP"
serverPort = 7000

auth.method = "token"
auth.token = "与 frps.toml 完全一致的 FRP token"

# 显式开启 FRP 客户端至服务器的 TLS 传输。
transport.tls.enable = true

[[proxies]]
name = "comfy-image-api"
type = "tcp"
localIP = "127.0.0.1"
localPort = 8000
remotePort = 18000
```

启动命令：

```powershell
.\frpc.exe -c .\frpc.toml
```

建议将 FRP 程序和配置放在专用目录，不要覆盖其他用途的 FRP 配置。

### 10.4 云服务器防火墙与安全组

最低限度需要评估以下端口：

| 端口 | 用途 | 公网策略 |
|---|---|---|
| `22/tcp` | SSH 管理 | 只允许管理员 IP 或通过其他安全管理方式访问 |
| `7000/tcp` | frpc 连接 frps | 建议尽量限制来源；如本地 IP 经常变化，务必使用强 token 并及时更新 FRP |
| `80/tcp` | HTTP/证书验证与跳转 HTTPS | 按证书方案需要开放 |
| `443/tcp` | HTTPS API | 对外开放 |
| `18000/tcp` | 云端 Nginx 访问 FRP 转发的 API | **不应对公网开放**；应仅绑定 `127.0.0.1` 或由防火墙严格限制 |
| `8188/tcp` | 本地 ComfyUI | **禁止在云服务器或路由器上转发给公网** |

部署后在服务器执行 `ss -lntp`（或对应系统工具）确认：Nginx 对外监听 443；FRPS 控制端口监听 7000；18000 只在 `127.0.0.1` 监听。若实际监听地址不是这样，应先修正再对外开放域名。

---

## 11. Nginx + HTTPS 域名

### 11.1 DNS

在域名服务商中新增：

- 类型：A
- 主机记录：例如 `img-api`
- 记录值：云服务器公网 IPv4
- 最终域名：`img-api.example.com`

等待 DNS 生效后再申请证书。若云服务器没有公网 IPv4，需根据实际网络配置调整 DNS 与访问方式。

### 11.2 Nginx 反向代理示例

下面是结构示例；证书路径应替换为实际路径。因为 API 采用异步提交模式，正常的生图提交请求很快返回 `task_id`，因此不应该把整个 GPU 生成耗时塞进同一个反向代理请求。

```nginx
server {
    listen 80;
    server_name img-api.example.com;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name img-api.example.com;

    ssl_certificate     /etc/letsencrypt/live/img-api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/img-api.example.com/privkey.pem;

    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:18000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 10s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
    }
}
```

配置文件验证并重载：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

证书可使用 Certbot 等方式申请和自动续期。具体安装命令取决于服务器的 Linux 发行版。

**HTTPS 说明：** 外部调用者到 Nginx 的连接由网站 TLS 证书保护；frpc 到 frps 的隧道是另一段链路，需使用 FRP 的 TLS/认证配置。不要把这两层混为一谈。

### 11.3 不要只因为有 HTTPS 就取消 API Key

HTTPS 保护传输，API Key 控制调用权限，两者作用不同。正式公网 API 仍然必须鉴权和限流。

---

## 12. 上线后的请求流程

### 12.1 提交任务

```bash
curl -X POST "https://img-api.example.com/v1/images/generate" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "prompt": "一只黑色机械巨兽，电影级光影，细节丰富",
    "negative_prompt": "模糊，低质量",
    "width": 1024,
    "height": 1024,
    "steps": 25
  }'
```

预期：返回 `202` 与 `task_id`，不是同步返回整张图片。

### 12.2 查询任务

```bash
curl "https://img-api.example.com/v1/tasks/TASK_ID" \
  -H "X-API-Key: YOUR_API_KEY"
```

轮询间隔建议 1–3 秒，客户端设置总等待上限；任务达到 `succeeded` 或 `failed` 后停止轮询。

### 12.3 获取结果和图片

```bash
curl "https://img-api.example.com/v1/tasks/TASK_ID/result" \
  -H "X-API-Key: YOUR_API_KEY"
```

再按响应中的图片 `url` 发起带同样 API Key 的 GET 请求，将返回的二进制图片保存成文件。

---

## 13. Joy / 其他服务调用注意事项

- Joy 的可信后端可以把 API Key 放到服务端秘密配置中，由后端直接调用生图 API。
- 不要把 FRP token、云服务器 SSH 密码或 API Key 暴露在群聊消息、前端页面、手机 App 包体或客户端日志里。
- 给群 Bot 暴露生图能力时，应另外限制群成员权限、每天任务数、单次分辨率、steps 上限和提示词长度，避免被刷爆本地 GPU。
- 在 API 调用方设置合理轮询间隔，不要每 100 毫秒请求一次任务状态。
- 如果服务端要转发图片 URL，确认 URL 只能指向该 API 服务的允许域名，避免把此功能扩展成可访问任意 URL 的 SSRF 风险。
- 如未来希望把图片临时放到对象存储，可增加可过期的签名 URL；第一版优先使用必须带 API Key 的图片下载接口。

---

## 14. 自动启动与长期运行

### 14.1 本地 Windows

建议通过 Windows 任务计划程序配置两个任务：

1. **ComfyUI**：按当前安装方式启动，等待模型服务可用。
2. **API + frpc**：在用户登录后或系统启动时启动；若 ComfyUI 未就绪，API 的 readiness 应返回未就绪，后台任务可在 ComfyUI 恢复后继续处理或按策略失败。

不要在启动脚本里写死 API Key 和 FRP token；从受限权限的配置文件或环境变量加载。

`start_api.ps1`、`start_frpc.ps1` 应支持清晰日志、退出码和重复运行检查，避免重复启动多个消费者。

### 14.2 云服务器

把 `frps` 设置为 systemd 服务，使机器重启后自动启动；Nginx 也应设置为 systemd 自动启动。FRP 服务文件示例需由 Cursor 根据实际安装路径、运行用户和 Linux 发行版生成，不要复制后不改路径就直接使用。

### 14.3 本地电脑的电源与网络

确保电脑不会因睡眠导致服务中断，网络断开后 FRPC 能自动重连。若需要真正稳定的 24/7 服务，应考虑专用主机或云 GPU；普通家用电脑的可用性受电源、系统更新、网络和硬件状态影响。

---

## 15. 测试清单与验收标准

Cursor 必须执行能在没有真实 GPU 的情况下完成的单元测试，并提供真实 ComfyUI 环境的手动验收步骤。

### 单元测试

- [ ] 工作流 JSON 格式错误时启动失败，并显示可读错误。
- [ ] 映射引用的节点不存在时校验失败。
- [ ] 映射引用的 input 不存在时校验失败。
- [ ] 正向提示词、负向提示词、宽度、高度、steps、seed 能正确写入指定输入字段。
- [ ] 对映射外的节点和输入不做更改。
- [ ] API Key 缺失或错误时，生图及任务相关接口返回 `401`。
- [ ] 非法尺寸、像素总量超限、steps 超限、超长提示词返回 `422`。
- [ ] 队列满时不继续接收任务。
- [ ] ComfyUI 调用异常时任务进入 `failed`，错误信息不会包含 API Key。
- [ ] 图片保存和下载只允许访问任务自身的数据库记录，无法构造路径穿越。
- [ ] 重启时遗留的 running 任务按既定策略恢复或标记失败。
- [ ] `ruff` 或类似静态检查通过（如项目配置了该工具）。

### 端到端手动验收

- [ ] `127.0.0.1:8188/system_stats` 能返回 ComfyUI 状态。
- [ ] 本地 FastAPI `/health/ready` 返回可用。
- [ ] 本地提交任务返回 `202` 和 `task_id`。
- [ ] 任务最终变为 `succeeded`，实际图片可下载并能正常打开。
- [ ] 关闭 ComfyUI 后 readiness 失败，API 不会错误地声称服务就绪。
- [ ] 启动 frpc 后，云服务器本机访问 `http://127.0.0.1:18000/health/ready` 能到达本地 API。
- [ ] 域名 HTTPS 访问成功，证书有效。
- [ ] 外网 API Key 错误时返回 `401`。
- [ ] 云端 `18000` 不可从公网直接访问，ComfyUI `8188` 没有映射到公网。
- [ ] 本地电脑断网后，外部请求得到明确的服务不可用错误，而不是无限挂起。

---

## 16. 常见故障排查

| 症状 | 优先检查 | 处理方向 |
|---|---|---|
| `127.0.0.1:8188/system_stats` 连接失败 | ComfyUI 是否运行、真实端口是否变化 | 先修复 ComfyUI，不要先查 FRP |
| API 启动时提示找不到节点 | `workflow_mapping.json` 的 node_id | 从实际 API 工作流 JSON 重新确认节点 ID |
| 提交给 ComfyUI 返回无效工作流 | 是否导出 API Format、节点连接和 class_type 是否完整 | 用 ComfyUI UI 验证同一工作流，并检查导出格式 |
| 工作流完成但没有图片 | History 的 `outputs` 是否包含 `images` | 检查工作流是否真的包含保存图片的输出节点 |
| 任务总是超时 | 生成时间、ComfyUI 队列、OOM、插件报错 | 查看 ComfyUI 终端日志和任务超时配置 |
| HTTP 401 | `X-API-Key`、`.env` 和调用端密钥是否一致 | 确认没有把 FRP token 当成 API Key |
| 本地 API 正常、云端连接失败 | frpc/frps 日志、7000 端口、防火墙、token | 先确认隧道在线，再检查 18000 回环监听 |
| 云端本机访问 18000 失败 | frps 代理是否已注册、proxyBindAddr、远端端口配置 | 查看 frps/frpc 日志和监听端口 |
| 域名打不开 | DNS、Nginx 配置、证书、443 安全组 | `nginx -t`，确认 DNS 指向服务器 |
| 返回 502/504 | Nginx → `127.0.0.1:18000` → FRP → 本地 API 链路 | 分段 curl `/health/ready`，查看 Nginx 和 FRP 日志 |
| 外部能绕过域名直接访问 18000 | FRPS 代理绑定地址与服务器防火墙 | 应限制为 loopback 或严格防火墙限制，不能忽略 |
| 图片下载 404 | 任务结果中图片元数据、保存路径、清理策略 | 确保图片下载依赖数据库映射，不依赖已清空的 ComfyUI 历史 |
| 多个任务同时挤占 GPU | 是否运行多个 Uvicorn worker 或重复启动服务 | 使用 `--workers 1`，确保只有一个任务消费者 |

---

## 17. 安全基线（上线前逐条确认）

- [ ] ComfyUI 只供本机访问，不暴露 `8188`。
- [ ] FastAPI 只绑定 `127.0.0.1:8000`，由 FRPC 主动建立隧道。
- [ ] FRP 使用独立高强度 token，客户端与服务端完全一致。
- [ ] 云端 `18000` 只监听 `127.0.0.1` 或通过防火墙做到只有本机 Nginx 能访问。
- [ ] 公网使用 HTTPS；`7000` 仅用于 FRP 控制连接，按实际条件限制来源。
- [ ] 所有生图、任务查询、结果及图片下载接口要求 API Key。
- [ ] 不将密钥写入代码仓库、公开日志、URL 或移动 App 前端。
- [ ] 限制 prompt 长度、图片尺寸、最大像素、steps、队列长度及请求频率。
- [ ] 不允许外部调用方提交完整任意工作流 JSON。
- [ ] 公网生产环境关闭或保护 `/docs` 与 `/openapi.json`。
- [ ] 对任务表与图片目录设置磁盘使用量与自动清理策略。
- [ ] FRP 和 Nginx 配置更改后重新检查监听端口和安全组。

---

## 18. 建议的实施顺序

1. **阶段 A：本地 API** —— 导出 `workflow_api.json`，完成节点映射，启动 FastAPI，本机完成真实出图。
2. **阶段 B：可靠性** —— SQLite 任务表、单任务消费者、超时、错误处理、图片保存和下载、单元测试。
3. **阶段 C：FRP** —— 先用云端本机 `curl http://127.0.0.1:18000/health/ready` 测通隧道。
4. **阶段 D：公网 HTTPS** —— 配好 DNS、证书和 Nginx，检查 `https://img-api.example.com/health/ready`。
5. **阶段 E：调用方集成** —— Joy 或其他服务端使用 API Key 提交任务、轮询状态和下载图片。
6. **阶段 F：长期运行** —— Windows 任务计划程序、云端 systemd、日志轮转、图片清理和密钥轮换。

每个阶段通过后再继续下一阶段。出现问题时按链路从本地向公网逐层验证，不要同时改多个组件。

---

## 19. 官方参考资料

- ComfyUI 官方仓库与 API 集成说明：<https://github.com/Comfy-Org/ComfyUI>
- ComfyUI 官方文档：<https://docs.comfy.org/>
- FRP 官方仓库与配置示例：<https://github.com/fatedier/frp>
- FRP 官方 Releases：<https://github.com/fatedier/frp/releases>
- FastAPI HTTPS 部署说明：<https://fastapi.tiangolo.com/deployment/https/>

不同版本的 ComfyUI 节点结构、API 格式与 FRP 参数可能变化。实现时要以本机真实导出的工作流及所安装版本的官方配置为准。

---

## 20. Cursor 最终交付要求

Cursor 完成后，应在回复中列出：

1. 新增和修改的全部文件。
2. 当前真实工作流的节点映射结果，以及仍需用户手动确定的映射（如果没有工作流文件，必须说明）。
3. 安装依赖、配置 `.env`、本地启动 API、启动 FRPC 的准确命令。
4. 云服务器部署 `frps`、Nginx、HTTPS 的准确步骤与配置文件路径。
5. 所有自动化测试的结果；无法实际测试的内容要明确标注，不要声称已测试。
6. 一次真实 API 生图验收的完整命令流程。
7. 所有尚未完成的工作和安全风险。

**最终完成标准：从外网向 HTTPS API 提交请求，云端返回 `task_id`，本地 GPU 使用 ComfyUI 完成图片生成，外部调用方通过已鉴权的 API 下载图片。**
