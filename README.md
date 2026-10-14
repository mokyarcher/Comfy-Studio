# ComfyUI 本地文生图 API

将本机 ComfyUI（Qwen Image 2.1 工作流）封装为带 API Key 的异步 HTTP API，再经 FRP + 云服务器 Nginx HTTPS 对外提供服务。

**推理始终在本地 GPU 完成；云端只做入口与转发。**

官网：https://comfy-studio.sharex.team （源码 [`web/`](web/)，本地预览 `cd web && npm run dev`）

## 架构

```text
外网 HTTPS + API Key
  → 云 Nginx
  → frps (127.0.0.1:18000)
  → FRP 隧道
  → 本地 FastAPI (127.0.0.1:8000)
  → ComfyUI (127.0.0.1:8188)
  → 本地 GPU
```

## 快速开始（Windows）

### 1. 准备

- ComfyUI 已能用该工作流正常出图
- Python 3.11+
- 项目内已有（均在 `llm_workflow/`）：
  - `workflow_api.json`（API Format，已从 UI 工作流展平）
  - `workflow_mapping.json`
  - `workflow_ui.json`（原始 UI 导出，仅备份）

### 2. 安装与启动

```powershell
cd d:\GitCode\myproject-d\comfyUI-api
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
copy .env.example .env
# 编辑 .env，至少修改 API_KEY
.\scripts\start_api.ps1
```

### 3. 本地调用

```powershell
# 健康检查（无需 Key）
Invoke-RestMethod http://127.0.0.1:8000/health/ready

# 提交任务
$headers = @{ "X-API-Key" = "你的API_KEY"; "Content-Type" = "application/json" }
$body = @{ prompt = "a red fox in snow"; width = 1024; height = 1024; steps = 25 } | ConvertTo-Json
$resp = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/v1/images/generate -Headers $headers -Body $body
$taskId = $resp.task_id

# 轮询状态（建议 1–3 秒）
Invoke-RestMethod -Uri "http://127.0.0.1:8000/v1/tasks/$taskId" -Headers $headers

# 成功后查看结果并下载
Invoke-RestMethod -Uri "http://127.0.0.1:8000/v1/tasks/$taskId/result" -Headers $headers
Invoke-WebRequest -Uri "http://127.0.0.1:8000/v1/tasks/$taskId/images/0" -Headers $headers -OutFile out.png
```

## API 一览

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/health/live` | 否 | 进程存活 |
| GET | `/health/ready` | 否 | ComfyUI 可连，否则 503 |
| POST | `/v1/images/generate` | `X-API-Key` | 202 + `task_id` |
| GET | `/v1/prompt/polish/status` | `X-API-Key` | 网关 AI 润色状态与配额 |
| POST | `/v1/prompt/polish` | `X-API-Key` | 服务端代理 AI 润色（上游 Key 不进客户端） |
| GET | `/v1/tasks/{id}` | 是 | queued/running/succeeded/failed |
| GET | `/v1/tasks/{id}/result` | 是 | 图片元数据 |
| GET | `/v1/tasks/{id}/images/{index}` | 是 | 图片二进制 |

### 提交字段

- `prompt`（必填）
- `negative_prompt`（可选；当前 Qwen 官方路径 cfg=1 时通常无效）
- `width` / `height`（可选，需为 8 的倍数，默认沿用工作流）
- `steps` / `seed`（可选；缺省 seed 由服务端随机）

## 工作流说明

原始文件是 **UI 工作流**（含子图 `Text to Image (Qwen Image 2.1)`），不能直接给 `/prompt`。

已处理为：

1. 保留原文件为 `workflow_ui.json`
2. 展平子图为 API Format → `llm_workflow/workflow_api.json`
3. 映射：

| 字段 | 节点 | input |
|------|------|-------|
| positive_prompt | 452 `TextEncodeQwenImage21` | prompt |
| negative_prompt | 452 | negative_prompt |
| width / height | 456 `EmptyLatentImage` | width / height |
| steps / seed | 458 `KSampler` | steps / seed |

辅助查看节点：

```powershell
.\.venv\Scripts\python.exe scripts\inspect_workflow.py
```

若你之后在 ComfyUI 里改了图，请重新 **Export (API)**，覆盖 `llm_workflow/workflow_api.json`，并按需改 `llm_workflow/workflow_mapping.json`。

> 依赖自定义节点：`TextEncodeQwenImage21`、`SaveImageAdvanced`、以及对应 Qwen 模型文件。若 `/prompt` 报节点不存在，先在 ComfyUI UI 里确认同一工作流可出图。

## 测试

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

## 公网部署

见 [docs/DEPLOY_FRP_NGINX.md](./docs/DEPLOY_FRP_NGINX.md)。

开发 / Agent 约定见 [AGENTS.md](./AGENTS.md)。

安全硬约束：

- 不暴露 ComfyUI `8188`
- FastAPI 只绑 `127.0.0.1:8000`
- 云端 `18000` 仅本机回环
- 公网必须 HTTPS + API Key
- 生产环境将 `ENABLE_DOCS=false`

## 桌面端（Gateway / Studio）

两款独立 Electron 应用，**不改动**本仓库 FastAPI 服务：

- **Comfy Gateway**：台式机上图形化启动 API + frpc、查状态/日志/密钥  
- **Comfy Studio**：任意电脑远程出图、任务队列、本地画廊  

详见 [`desktop/README.md`](./desktop/README.md)。

```powershell
cd desktop\gateway
npm install
npm run dev

cd ..\studio
npm install
npm run dev
```

## 项目结构

```text
app/                 FastAPI 应用
scripts/             启动与检查脚本
tests/               单元测试
desktop/             Comfy Gateway + Comfy Studio 桌面端
data/                SQLite 与图片（gitignore）
docs/                设计与部署文档
llm_workflow/        ComfyUI 工作流与节点映射
other/               杂项（本地润色库等）
```
