# Comfy Gateway

Windows 桌面控制台：管理本机 FastAPI ComfyUI API 与 FRP 客户端（Electron + React + TypeScript + Vite + Tailwind）。

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
| `npm run dist` | 打包 NSIS 安装包 → `release/Comfy-Gateway-Setup-*.exe` |
| `npm run preview` | 预览构建产物 |

## 首次配置

1. **服务管理 / 设置**：选择 API 项目目录（仓库根，含 `app/main.py`）
2. Python 留空时会自动尝试 `{apiProjectDir}\.venv\Scripts\python.exe`
3. 选择 `frpc.exe` 与 `config.toml`
4. 确认 ComfyUI 地址（默认 `http://127.0.0.1:8188`）与公网 Base URL
5. **运行总览** →「启动全部」

## 安全说明

- `contextIsolation: true`，`nodeIntegration: false`，preload 仅暴露白名单 IPC
- 日志对 `API_KEY` / token 等模式脱敏
- 关闭窗口时可选择：托盘 / 保持服务退出 / 停止本应用启动的服务后退出
- 仅停止由 Gateway 启动并记录的子进程，不会误杀外部进程

## 相关契约

见 `../docs/api-contract.md`。
