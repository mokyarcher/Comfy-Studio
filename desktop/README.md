# Comfy 双桌面端

在**不改动**现有 FastAPI / ComfyUI / FRP 链路的前提下，提供两款独立 Windows 桌面应用：

| 应用 | 目录 | 用途 |
|------|------|------|
| **Comfy Gateway** | `desktop/gateway` | 服务端控制台：启动/停止 API 与 frpc、健康检查、密钥、日志 |
| **Comfy Studio** | `desktop/studio` | 远程生图客户端：提示词、出图、任务队列、画廊 |

API 契约见 [`docs/api-contract.md`](./docs/api-contract.md)。

## 开发启动

```powershell
# 服务端控制台（装在有 GPU / ComfyUI 的电脑）
cd desktop\gateway
npm install
npm run dev

# 远程生图客户端（任意可访问 API 的电脑）
cd desktop\studio
npm install
npm run dev
```

## 常用脚本

两项目均支持：

- `npm run dev` — 开发模式
- `npm run typecheck` — TypeScript 检查
- `npm run build` — 生产前端/主进程构建
- `npm run dist` — 打包为解压目录（输出到各自 `release/win-unpacked/`）

Studio 另有：`npm test`

> 说明：当前环境无法在线拉取 NSIS 工具，故默认产出为 **解压即用** 的 `win-unpacked`，可直接双击其中的 `.exe`。网络恢复后可自行改回 `nsis`/`portable` 目标。

## 首次配置摘要

### Gateway（台式机）

1. 设置 → API 项目目录指向仓库根（含 `app/main.py`）
2. Python 可留空（自动用 `.venv\Scripts\python.exe`）
3. 选择 `frpc.exe` 与含 `qwen-image-api` 的 TOML
4. 公网 Base URL 示例：`http://111.229.166.216:8080/qwen-image`
5. 运行总览 →「启动全部」

### Studio（调用方）

1. API 连接 → Base URL：`http://111.229.166.216:8080/qwen-image`
2. API Key：**必须与台式机 `.env` 中 `API_KEY` 一致**
3. 测试连接 → 开始创作 → 生成图片

## 安全

- `contextIsolation` + preload 白名单 IPC
- 密钥掩码显示；Studio 使用 `safeStorage` 加密保存
- 日志对 API Key / token 脱敏
- Gateway 关闭窗口时可选择保持服务或仅停止本应用启动的进程

## 已知限制

- 公网域名若未备案，请使用 `http://IP:8080/qwen-image`（与当前部署一致）
- Windows PowerShell 5 的 `Invoke-RestMethod` 可能因 TLS 失败；桌面端使用自身 HTTP 客户端
- 安装包图标若未放置自定义 `.ico`，将使用 Electron 默认图标
