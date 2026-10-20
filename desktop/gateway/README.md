# Comfy Gateway

Windows 桌面控制台：管理本机 **ComfyUI**、FastAPI 与 FRP 客户端（Electron + React + TypeScript + Vite + Tailwind）。可勾选开机自启三项服务。

外网管理（审用户 / 远程启停）见 [`../gateway-web/README.md`](../gateway-web/README.md)。

## 开发启动

```bash
cd desktop/gateway
npm install
npm run dev
```

## 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发模式 |
| `npm run typecheck` | TypeScript 检查 |
| `npm run build` | 生产构建（含 typecheck） |
| `npm run dist:dir` | 解压即用 → `release/win-unpacked/Comfy Gateway.exe` |
| `npm run dist` | 打包 NSIS（需在线工具） |
| `npm run preview` | 预览构建产物 |

## 首次配置

1. **服务管理 / 设置**：选择 API 项目目录（仓库根，含 `app/main.py`）
2. Python 留空时会自动尝试 `{apiProjectDir}\.venv\Scripts\python.exe`
3. **ComfyUI 目录** + 启动命令：桌面版选含 `main.py` 的目录，默认 `.venv\Scripts\python.exe main.py --listen 127.0.0.1 --port 8188`；便携版可选 `ComfyUI_windows_portable`（或外层安装夹），会自动改用 `python_embeded`（勿用系统 Python）
4. 选择 `frpc.exe` 与 `config.toml`
5. 确认 ComfyUI URL（默认 `http://127.0.0.1:8188`）与公网 Base URL
6. 可选：勾选「启动时自动拉起」ComfyUI / API / FRP
7. **运行总览** →「启动全部」（按勾选顺序拉起）

## 安全说明

- `contextIsolation: true`，`nodeIntegration: false`，preload 仅暴露白名单 IPC
- 日志对 `API_KEY` / token 等模式脱敏
- 关闭窗口时可选择：托盘 / 保持服务退出 / 停止本应用启动的服务后退出
- 仅停止由 Gateway 启动并记录的子进程，不会误杀外部进程

## 相关契约

见 `../docs/api-contract.md`。
