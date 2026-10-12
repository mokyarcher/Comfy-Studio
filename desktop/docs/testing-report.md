# 桌面端测试报告

日期：2026-10-11

## 自动化

| 项目 | 命令 | 结果 |
|------|------|------|
| Gateway typecheck | `npm run typecheck` | 通过 |
| Gateway build | `npm run build` | 通过 |
| Gateway dist (dir) | `electron-builder --win dir` | 通过 → `desktop/gateway/release/win-unpacked/Comfy Gateway.exe` |
| Studio typecheck | `npm run typecheck` | 通过 |
| Studio unit tests | `npm test`（url 工具） | 7 passed |
| Studio build | `npm run build` | 通过 |
| Studio dist (dir) | `electron-builder --win dir` | 通过 → `desktop/studio/release/win-unpacked/Comfy Studio.exe` |
| NSIS / portable | `electron-builder --win nsis/portable` | **失败**（无法下载 app-builder NSIS 工具；网络受限） |

## 修复记录（构建期）

- 删除 Gateway 残留冲突文件：`apiKeyStore` / `configStore` / `logBuffer` / `probes` / `statusHelpers` / 旧 Layout·Onboarding·store
- 补齐 Gateway `npm install`（缺 zod）
- Studio `gallery.ts` Buffer 类型兼容
- Tailwind `@apply` 中不支持 `color/opacity` 的写法改为 `color-mix`

## 待人工验收（安装版 / 真机）

- [ ] Gateway：配置项目目录后启动 API + frpc，本机 `/health/ready` 成功
- [ ] Studio：用同一 API Key 远程出图并写入画廊
- [ ] Gateway：关闭窗口「保持服务」后 API 仍可访问
- [ ] `npm run dist` 生成安装包并在干净环境启动

## 联调基址（当前环境）

```text
http://111.229.166.216:8080/qwen-image
```
