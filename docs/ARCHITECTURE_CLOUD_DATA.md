# 云端数据面与 INSTANCE_ID 隔离

## 目标

- 提示词库、共享提示词、用户账号、统一作品记录、画廊、展馆：**权威数据落在云服务器**
- 共用云机 / FRP 隧道时，**不同业务系统（产品链）互不串库**
- GPU 本机只负责推理（ComfyUI + 生成队列）；可继续跑完整 FastAPI，或只跑生成面

## 隔离键：`INSTANCE_ID`

每个业务系统一个 ID（如 `qwen-image`、`wzx`）。相对路径 `data/...` 会落到：

```text
data/instances/{INSTANCE_ID}/
  users.db
  prompt_library.json
  shared_prompts.db
  works.db
  cloud_gallery.db + cloud_gallery/
  showcase.db + showcase/
  tasks.db + images/          # 仅生成面需要
  …
```

绝对路径（测试用 tmp、自定义盘符）不会被改写。

## 两种进程角色

| 角色 | `.env` | 职责 |
|------|--------|------|
| **Meta 数据面（云机）** | `ENABLE_GENERATION=false` + `INSTANCE_ID=…` | 鉴权、提示词、works、画廊、展馆 |
| **生成面（GPU 本机）** | `ENABLE_GENERATION=true`（默认） | `/v1/images/*`、`/v1/tasks/*`、ComfyUI |

云上 Meta 默认关闭 `HOST_SERVICES_*`（无本机 Comfy/FRP 可管）。

## 推荐生产拓扑（nginx 分流）

同一域名下：

- **数据类** → 云机本机 Meta（如 `127.0.0.1:8101`）
- **生成类** → FRP 转到台式机（如 `127.0.0.1:18000`）

见 [`deploy/comfy-studio-app.split.nginx.conf`](../deploy/comfy-studio-app.split.nginx.conf)。

多产品链：每个 `INSTANCE_ID` 一个 Meta 进程（不同端口）+ 独立 `server_name` 或独立 FRP `remotePort`，**禁止多个产品共用同一 `data/instances` 目录**。

## 迁移

本机已有旧版 `data/users.db` 等时：

```powershell
.\.venv\Scripts\python.exe scripts\migrate_data_to_instance.py --instance qwen-image
# 或先看计划
.\.venv\Scripts\python.exe scripts\migrate_data_to_instance.py --dry-run
```

然后在 `.env` 设 `INSTANCE_ID=qwen-image`。

## 客户端

- Web Studio：出图成功后后台写 `/v1/works`；若开「保存至云端」再传 `/v1/cloud-gallery`
- 浏览器 IndexedDB 仍可作本地缓存；**权威作品列表以云端 works / cloud-gallery 为准**

## 用户账号

`users.db` 按 instance 分开。生成面若仍校验本机 Key，需与 Meta **共用同一 users 库**（部署时把 GPU 的 `USERS_DB_PATH` 指到同步后的库，或后续做 Key 校验代理）。当前阶段优先：Studio 登录/画廊/提示词打到 Meta；生成请求走 FRP 时，生成面 `.env` 的 `API_KEY` / users 与 Meta 对齐（同一 bootstrap 或迁库）。
