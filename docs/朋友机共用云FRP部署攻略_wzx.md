# 朋友机共用云 FRP 部署攻略（wzx）

> 目标：朋友本机（如 7900XT + 32G）跑 ComfyUI + FastAPI + frpc；你出云服务器上的 **frps + Nginx + 证书**；子域名已申请：
>
> **`qwen-image-2-1-wzx.sharex.team`**（A 记录指向与现网相同的云服务器公网 IP）
>
> 推理只在朋友 GPU 上完成；云端只做 HTTPS 入口与转发。**禁止**把 ComfyUI `8188` 暴露到公网。

---

## 0. 角色与端口规划

| 角色 | 机器 | 职责 |
|------|------|------|
| 你（管理员） | 云服务器 | DNS 已好；扩展 frps 允许新端口；Nginx + Let’s Encrypt；把 token / 域名告诉朋友 |
| 朋友（算力） | Windows 台式机 | ComfyUI、本仓库 API、Gateway/frpc、自有 `API_KEY` |
| 任意客户端 | Studio | Base URL 填朋友的 HTTPS 域名 + 朋友发的 API Key |

与现网隔离（避免和你自己的 `qwen-image-2-1` 抢隧道）：

| 项 | 你自己（现网） | 朋友 wzx（本攻略） |
|----|----------------|-------------------|
| 域名 | `qwen-image-2-1.sharex.team` | `qwen-image-2-1-wzx.sharex.team` |
| frps 本机端口（仅 127.0.0.1） | `18000` | **`18001`** |
| frpc `remotePort` | `18000` | **`18001`** |
| frpc 代理名 | `qwen-image-api` | `qwen-image-api-wzx` |
| API Key / 润色配额 | 你的 `.env` | **朋友单独一套**（不要共用） |
| FRP token | 与现网 **同一 token**（共用一台 frps） | 同左 |

公网安全组仍只需：`443`（HTTPS）、按需 `7000`（frpc）；**不要**对公网开放 `18000` / `18001`。

```text
Studio / 外网
  → https://qwen-image-2-1-wzx.sharex.team
  → 云 Nginx
  → 127.0.0.1:18001（frps）
  → FRP 隧道
  → 朋友机 FastAPI 127.0.0.1:8000
  → 朋友机 ComfyUI 127.0.0.1:8188
  → 7900XT
```

---

## 1. 你这边：云服务器（一次性）

以下在 **SSH 登录云机** 后操作。路径以现网习惯为准（`/etc/frp/`、`/etc/nginx/…`）；若实际路径不同，改成你机器上的真实路径。

### 1.1 确认 DNS

```bash
# 应解析到云服务器公网 IP（与 qwen-image-2-1 相同）
dig +short qwen-image-2-1-wzx.sharex.team A
```

未生效就等 TTL，或到 DNS 面板核对 A 记录。

### 1.2 扩展 frps：允许 `18001`

编辑 frps 配置（示例见仓库 `deploy/frps.server.toml`），在 `allowPorts` 中增加 `18001`：

```toml
proxyBindAddr = "127.0.0.1"
allowPorts = [
  { start = 11434, end = 11434 },
  { start = 18000, end = 18000 },
  { start = 18001, end = 18001 }
]
```

重启：

```bash
sudo systemctl restart frps
sudo systemctl status frps --no-pager
```

> token **不要改**；朋友 frpc 填与你现网相同的 token。

### 1.3 Nginx：先上 HTTP，再申请证书

仓库模板：

- `deploy/qwen-image-2-1-wzx.sharex.team.http.conf`（仅 80，给 ACME）
- `deploy/qwen-image-2-1-wzx.sharex.team.ssl.conf`（HTTPS → `127.0.0.1:18001`）

复制到站点目录（名称按你现网习惯）：

```bash
sudo cp deploy/qwen-image-2-1-wzx.sharex.team.http.conf \
  /etc/nginx/conf.d/qwen-image-2-1-wzx.sharex.team.conf
# 若你用 sites-available：
# sudo ln -sf /etc/nginx/sites-available/... /etc/nginx/sites-enabled/...

sudo nginx -t && sudo systemctl reload nginx
```

申请证书（任选其一，与现网一致即可）：

```bash
sudo certbot --nginx -d qwen-image-2-1-wzx.sharex.team
# 或：
# sudo certbot certonly --webroot -w /var/www/html -d qwen-image-2-1-wzx.sharex.team
```

证书好后，用 SSL 模板覆盖站点，并确认 `proxy_pass` 为 **`http://127.0.0.1:18001`**：

```bash
sudo cp deploy/qwen-image-2-1-wzx.sharex.team.ssl.conf \
  /etc/nginx/conf.d/qwen-image-2-1-wzx.sharex.team.conf
sudo nginx -t && sudo systemctl reload nginx
```

### 1.4 云端自检（朋友 frpc 连上之前）

```bash
# 443 证书与站点存在即可；18001 在朋友未连时可能还没有监听，属正常
curl -sS -o /dev/null -w "%{http_code}\n" https://qwen-image-2-1-wzx.sharex.team/health/live
# 朋友未连上时常为 502；连上且 API 起来后应变 200
```

朋友 frpc 连上后，在云上：

```bash
curl -sS http://127.0.0.1:18001/health/live
curl -sS http://127.0.0.1:18001/health/ready
```

### 1.5 私下交给朋友的信息（不要进 Git / 群聊明文长期留存）

- 域名：`https://qwen-image-2-1-wzx.sharex.team`
- 云机公网 IP（或已写在 frpc 模板的 `serverAddr`）
- frps 端口：`7000`
- **FRP token**（与现网相同）
- 约定：`remotePort = 18001`，代理名 `qwen-image-api-wzx`
- 提醒：他自己生成 **API_KEY**，并在 Gateway 里配置；润色若走网关，由你决定是否在他 `.env` 里配 `POLISH_*`（可共用上游 Key，但日配额按用户分开）

---

## 2. 朋友这边：Windows 台式机

### 2.1 环境清单

- 已装好并能在本机 UI 出图的 **ComfyUI**（含本项目 `llm_workflow` 所需模型与自定义节点）
- **Python 3.11+**
- 本仓库代码（clone / 拷贝均可）
- **Comfy Gateway** 打包版（推荐）或自备 `frpc.exe`（与云上 frps **同大版本**）
- （可选）**Comfy Studio** 给远程账号用

### 2.2 安装 API

```powershell
cd <仓库根目录>
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
copy .env.example .env
```

编辑 `.env`（至少）：

```env
HOST=127.0.0.1
PORT=8000
COMFYUI_URL=http://127.0.0.1:8188
API_KEY=<朋友自己生成的长随机串>
ENABLE_DOCS=false
MAX_STEPS=40
MAX_WIDTH=1024
MAX_HEIGHT=1024
# 若共用你的润色上游，由你协助填写 POLISH_*；否则可先 POLISH_ENABLED=false
```

本地验收：

```powershell
# 先启动 ComfyUI，再：
.\scripts\start_api.ps1
Invoke-RestMethod http://127.0.0.1:8000/health/ready
```

### 2.3 配置 frpc（或 Gateway）

仓库模板：`deploy/frpc.wzx.toml`

```toml
serverAddr = "111.229.166.216"   # 改成实际云 IP（若已变）
serverPort = 7000
auth.method = "token"
auth.token = "PASTE_SAME_TOKEN_AS_EXISTING_FRPS"

transport.tls.enable = true

[[proxies]]
name = "qwen-image-api-wzx"
type = "tcp"
localIP = "127.0.0.1"
localPort = 8000
remotePort = 18001
```

要点：

- `auth.token` = 云上 frps 现网 token（你发给他）
- `remotePort` 必须是 **`18001`**，不能写成 `18000`（会和你的线冲突或被拒）
- 先起 ComfyUI → FastAPI → 再起 frpc / Gateway「启动服务」

用官方客户端时：

```powershell
.\frpc.exe -c frpc.wzx.toml
```

日志里应出现 proxy 上线；你在云上 `curl 127.0.0.1:18001/health/ready` 应成功。

### 2.4 公网验收

在任意能上网的机器：

```powershell
Invoke-RestMethod https://qwen-image-2-1-wzx.sharex.team/health/live
Invoke-RestMethod https://qwen-image-2-1-wzx.sharex.team/health/ready
```

带 Key 提交（示例）：

```powershell
$headers = @{ "X-API-Key" = "<朋友的API_KEY>"; "Content-Type" = "application/json" }
$body = @{ prompt = "a red fox in snow"; width = 1024; height = 1024; steps = 25 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri https://qwen-image-2-1-wzx.sharex.team/v1/images/generate -Headers $headers -Body $body
```

### 2.5 Studio 登录

- Base URL：`https://qwen-image-2-1-wzx.sharex.team`（不要末尾 `/`）
- API Key：朋友 `.env` 里的值  
点「测试连接」应显示已连接；步数上限会跟服务端 `MAX_STEPS` 同步。

---

## 3. 日常使用顺序（朋友）

1. 开 ComfyUI（8188）
2. 开 Gateway → 启动 API + frpc（或脚本 / 手动）
3. 云端 / Studio `health/ready` 正常即可创作  
关机或断网后，仅 **wzx** 子域 502，不影响你自己的域名。

---

## 4. 排障速查

| 现象 | 先查 |
|------|------|
| DNS 不对 | `dig` / 面板 A 记录是否指到云 IP |
| HTTPS 证书失败 | 80 是否通、`server_name`、ACME location |
| 一直 502 | 朋友 frpc 是否在线、`remotePort=18001`、云上 `curl 127.0.0.1:18001/health/live` |
| frpc 连不上 | token、7000 安全组、TLS、frps/frpc 版本 |
| ready 503 | 朋友本机 ComfyUI 未开或 `COMFYUI_URL` 错 |
| 401 | Studio Key 与朋友 `.env` 的 `API_KEY` 不一致 |
| 与你抢线 / 冲突 | 误用了 `18000` 或同名 proxy |
| 出图慢 / 超时 | 家宽上行、云带宽；改图/视频超时看 `COMFYUI_JOB_TIMEOUT_SECONDS` |

安全再强调：

- 不把 `8188`、`8000` 映射到公网路由器
- 不把真实 token / API Key 提交进 Git
- 生产 `ENABLE_DOCS=false`

---

## 5. 你与朋友的检查清单

**你（云）**

- [ ] A 记录 `qwen-image-2-1-wzx` 已生效  
- [ ] frps `allowPorts` 含 `18001` 并已重启  
- [ ] Nginx HTTP → 证书 → SSL 反代 `127.0.0.1:18001`  
- [ ] token / 域名 / 端口约定已私发朋友  

**朋友（本机）**

- [ ] ComfyUI 本机可出图  
- [ ] `.env` 独立 `API_KEY`，API `health/ready` 本机 OK  
- [ ] frpc `remotePort=18001`、token 正确并在线  
- [ ] `https://qwen-image-2-1-wzx.sharex.team/health/ready` 公网 OK  
- [ ] Studio 测连成功  

---

## 6. 相关仓库文件

| 文件 | 用途 |
|------|------|
| `deploy/frpc.wzx.toml` | 朋友机 frpc 模板 |
| `deploy/qwen-image-2-1-wzx.sharex.team.http.conf` | 云 Nginx HTTP / ACME |
| `deploy/qwen-image-2-1-wzx.sharex.team.ssl.conf` | 云 Nginx HTTPS → 18001 |
| `docs/DEPLOY_FRP_NGINX.md` | 单机版 FRP 总说明 |
| `deploy/frps.server.toml` | frps 示例（部署时记得扩 18001） |
