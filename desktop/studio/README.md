# Comfy Studio

远程文生图桌面客户端（Electron + React + TypeScript + Vite + Tailwind）。通过现有 FastAPI 异步任务接口生成图片。

## 开发

```bash
cd desktop/studio
npm install
npm run dev
```

## 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发模式 |
| `npm run typecheck` | TypeScript 检查 |
| `npm run build` | 生产构建 |
| `npm run dist` | 打包 Windows NSIS + Portable → `release/` |

## 首次使用

1. 打开 **API 连接**
2. 新建配置，填写：
   - **Base URL**（不要末尾斜杠；可含路径前缀），例如 `http://111.229.166.216:8080/qwen-image`
   - **API Key**（与服务端 `.env` 中的 `API_KEY` 一致）
   - **超时**（默认 900 秒）
3. 点击 **测试连接**（`GET {base}/health/ready`，无需 Key）
4. 保存并设为默认后，到 **开始创作** 生图

## Base URL 说明（路径前缀）

若公网经 Nginx 挂在子路径下，Base URL 必须包含该前缀，例如：

```text
http://111.229.166.216:8080/qwen-image
```

客户端会拼接为：

- `GET {base}/health/ready`
- `POST {base}/v1/images/generate`
- `GET {base}/v1/tasks/{id}`
- `GET {base}/v1/tasks/{id}/images/0`

## API 契约

- 生图 Header：`X-API-Key`
- 请求体仅：`prompt`、`negative_prompt?`、`width?`、`height?`、`steps?`、`seed?`
- **不发送** cfg / sampler / batch
- `202` 返回 `task_id` 后每 **2 秒** 轮询，直至 `succeeded` / `failed`
- 超时可配置，默认 **900 秒**
- 主进程串行队列，默认并发 **1**

## 智能提示词润色

创作页内置「智能润色」面板：润色结果直接写入上方「正向提示词」框，再用底部「开始生成」提交。解释区只说明改了什么，不会额外提交看不见的关键词。

### 本地润色库（默认，真正离线）

- 资源文件：`resources/prompt-library/ComfyUI本地提示词润色库_v1.json`
- 使用关键词命中 + 分类片段 + 模型档案 + 去重/长度控制，**不发起任何网络请求**
- 找不到或损坏词库时会提示错误，但不阻止直接生图

### AI 智能润色（推荐：网关代理）

本地规则润色偏公式化。默认走 **网关代理**（方案 B）：

1. 先在 **API 连接** 配好 Base URL + 与服务端一致的 `API_KEY`
2. 服务端 `.env` 开启润色代理（见仓库根 `.env.example` 的 `POLISH_*`）
3. **设置 → AI 智能润色 → 测试网关润色**
4. 创作页选 **AI 智能润色（网关）** → 润色

上游 DeepSeek/商汤 Key **只在服务器**，客户端拿不到；服务端可按 Key 指纹做日限额与每分钟限流。

高级选项里仍可「自备 Key 直连」（不推荐）。

### 质量边界

提示词润色只能降低一部分常见结构风险，**不能保证**图像绝对无变形、无常识错误。复杂姿态/文字/多视图一致性仍需参考图、ControlNet 等能力。

### 模型档案

可在润色面板选择 `FLUX / SDXL / SD1.5 / SD3 / 未知`。FLUX / 未知默认不自动拼接传统负面词；已有负面提示词不会被覆盖。

### 常见故障

| 现象 | 处理 |
|------|------|
| 本地润色报找不到词库 | 确认 `resources/prompt-library/` 存在；打包版检查 `extraResources` |
| AI 401 / 超时 | 检查 Key、Base URL、超时秒数；或改用本地润色 |
| AI 返回非法 JSON | 换模型或点「改用本地润色」 |
| 有冲突不能生图 | 阅读警告并勾选确认，或先编辑结果 |

## 应用信息

- productName: `Comfy Studio`
- appId: `com.sharex.comfy.studio`
- 窗口：1400×900（最小 1180×760）
