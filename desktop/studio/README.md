# Comfy Studio

远程创作桌面客户端（Electron + React + TypeScript + Vite + Tailwind）。经 FastAPI 异步任务出图；账号 / 展馆等数据可走云 Meta（与 Web Studio 同一契约）。

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
| `npm run dist:dir` | 打包 Windows 解压目录 → `release/win-unpacked/` |

## 首次使用（账号）

1. 配置 **Base URL**（公网 Studio/API 入口，无末尾斜杠；可含路径前缀）
2. **注册 / 登录**（用户名+密码；登录亦可用已绑定邮箱——与 Web 一致，取决于服务端是否已开邮箱能力）
3. 等待管理员审核通过后即可创作
4. 「测试连接」走健康检查；登录成功后的个人 Key 由主进程 `safeStorage` 保管，勿在渲染进程明文落盘

> 旧「只填管理员 API_KEY」仍可用于运维自测；普通玩家请走注册审核。

## 展馆

- 从画廊分享到展馆 / 下架
- 点赞、收藏、评论（API：`/v1/showcase/{id}/like|favorite|comments`，与 Web Studio 相同）
- 契约见 [`../docs/api-contract.md`](../docs/api-contract.md)

## Base URL 说明（路径前缀）

若公网经 Nginx 挂在子路径下，Base URL 必须包含该前缀，例如：

```text
https://app.comfy-studio.sharex.team
```

或带前缀的自建入口。客户端会拼接 `/health/ready`、`/v1/images/generate`、`/v1/tasks/...` 等。

## API 契约（生成）

- 生图 Header：`X-API-Key`（登录会话带上）
- 请求体：`prompt`、`negative_prompt?`、`width?`、`height?`、`steps?`、`seed?`、模式相关字段
- **不发送** cfg / sampler / batch
- `202` 返回 `task_id` 后轮询，直至 `succeeded` / `failed`
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

1. 先登录并配好 Base URL（会话已有个人 Key）
2. 服务端 / 云 Meta `.env` 开启润色代理（见仓库根 `.env.example` 的 `POLISH_*`）
3. **设置 → AI 智能润色 → 测试网关润色**
4. 创作页选 **AI 智能润色（网关）** → 润色

上游 DeepSeek/商汤 Key **只在服务器**，客户端拿不到；服务端可按用户做日限额与每分钟限流。

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
