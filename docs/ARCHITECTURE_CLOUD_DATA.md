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

## 云 Meta 部署脚本

`scripts/deploy_cloud_meta.ps1`：上传 Meta 代码并重启 systemd。  
**`.env` 策略**：远端已有 `.env` 时只**补缺键**，不整文件覆盖（保留 `API_KEY` / `POLISH_*` / 邮件与 Admin 密钥）。仅首次无 `.env` 时才用本地 `-ApiKey` 引导写入。

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

`users.db` 按 instance 分开。**批准后的 API Key 权威在 Meta**；生图/GPU 状态打到本机时，本机 `users.db` 往往还没有新用户 → `401 登录或密钥无效`。

正确做法（已实现）：

1. Meta 提供 `POST /v1/internal/auth/resolve`（头 `X-Meta-Sync-Key`，默认等于 `API_KEY` / `META_SYNC_SECRET`）
2. GPU `.env` 设 `META_AUTH_BASE_URL=https://app.comfy-studio.sharex.team`（与 Meta 同 `API_KEY`）
3. 生成面 `resolve_user` 本地未命中时向 Meta 拉用户并 upsert 到本机 `users.db`

禁止只迁一次库就不管：每次 Gateway 批准新用户后，**第一次**生图请求会自动同步；两边 `API_KEY` 必须一致。

### 权威库与审用户（必读，反复踩过）

| 动作 | 必须打到 |
|------|----------|
| Studio **注册申请** / 登录 / 改密 | **云 Meta** `data/instances/{INSTANCE_ID}/users.db`（表 `api_users`） |
| Gateway Admin **待审 / 批准 / 禁用 / 注销** | **同一套 Meta** `users.db` |
| Gateway **本机启停 Comfy/FRP、local-hold、GPU 传感器** | **GPU 生成面**（FRP，如 `18000`） |

**禁止**：Gateway Admin 的 `/v1/admin/users*`、`/v1/auth/admin/*`、`/v1/admin/stats`（用户相关统计）仍整站反代到 GPU。那样会读本机空库，云端已有 `pending` 也永远「暂无待审」。

正确分流见：

- Studio：`deploy/comfy-studio-app.split.nginx.conf`（数据 → Meta，生成 → GPU）
- Gateway Admin：`deploy/comfy-gateway-admin.nginx.conf`（用户/登录/stats → Meta；`host-services` / `local-hold` / `system` → GPU）
- Electron Gateway：设置「云 Meta API」`metaApiBaseUrl`（默认 `https://app.comfy-studio.sharex.team`），用户管理走 Meta；本机 API 只管服务启停

**`/v1/admin/stats` 在 Meta 上**：用户/待审/今日用量来自 Meta；排队/运行中在 Meta 恒为 `0`（任务库只在 GPU）。`admin_stats` **必须**在 `ENABLE_GENERATION=false`（`state.db is None`）时跳过任务查询，否则总览整页 `Internal Server Error`。真实排队看 GPU；本机占用开关走 `/v1/admin/local-hold`（已指 GPU）。

**Admin 会话跨面（`Admin login required`）**：登录 cookie 由 Meta 签发；`local-hold` / `host-services` 打到 GPU。会话令牌须用共享密钥签名（`ADMIN_SESSION_SECRET`，空则回退同一 `API_KEY`），两边 `.env` 一致。只存 Meta 本机 SQLite、GPU 无法校验时，总览会报 `Admin login required`、统计全 `—`（前端应把 hold 与 stats 解耦）。改密钥或升级后请重新登录，并重启 GPU FastAPI。

### Meta 上的 Admin 登录密钥（必读，反复踩过）

Gateway Admin Web 登录（`ADMIN_LOGIN_MODE=totp`）在分流到 Meta 之后，校验的是 **Meta 进程**读到的：

- `ADMIN_PASSWORD`
- `ADMIN_TOTP_SECRET`
- （以及 `ADMIN_LOGIN_MODE=totp`）

**本机 GPU `.env` 里配齐了不够。** Meta 的 `/opt/comfy-studio-meta/.env` 若这两项为空，登录会报：

`未配置 ADMIN_PASSWORD / ADMIN_TOTP_SECRET`

改 nginx 把管理台指到 Meta 之前 / 之后必须核对：

1. Meta `.env` 中上述键 **非空**，且与运维日常用的密码 + Authenticator **一致**（通常从本机 GPU `.env` 拷贝，只补缺、不整文件覆盖）
2. `systemctl restart comfy-meta-qwen-image`（或当前 instance 对应 unit）后再测登录
3. `deploy_cloud_meta.ps1` **不得**用空的本地 Admin 键覆盖远端已有密钥；远端空则从本机有值的键补齐

自检（在云机，勿把密钥打进日志）：

```bash
# 键是否非空（只看长度）
python3 -c "import pathlib; d=dict(l.strip().split('=',1) for l in open('/opt/comfy-studio-meta/.env') if l.strip() and not l.startswith('#') and '=' in l);
print({k: (bool((d.get(k) or '').strip()), len((d.get(k) or '').strip())) for k in ['ADMIN_LOGIN_MODE','ADMIN_PASSWORD','ADMIN_TOTP_SECRET']})"

# 待审是否在 Meta
python3 -c "import sqlite3; c=sqlite3.connect('/opt/comfy-studio-meta/data/instances/qwen-image/users.db');
print(list(c.execute(\"select username,status from api_users where status='pending'\")))"
```
