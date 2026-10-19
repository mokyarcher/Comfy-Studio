# 计划：恢复 2026-10-16 丢失的前端与邮箱后端

> 状态：**计划中 / 尚未重写**  
> 背景：周五在家电脑改了官网与 Studio Web，并加了邮箱注册 / 绑定 / 找回密码。当天没有 commit / push。硬盘损坏后，本地源码与后端改动丢失。云端已部署的静态前端还在。  
> 仓库基线：`c99a30e`（周五计划文档为止）。**没有**邮箱字段、没有周五的页面改动。

---

## 1. 现在还能保住什么

| 内容 | 状态 |
|------|------|
| Git `main` 至 `c99a30e` | 在。不含周五当天改动 |
| 官网 `https://comfy-studio.sharex.team` | 服务器 `/var/www/comfy-studio/`，构建时间约 10月16日 09:16。无 source map |
| Studio Web `https://app.comfy-studio.sharex.team` | `/var/www/comfy-studio-app/`，当前入口 `assets/index-BlgVhmoE.js` + `index-QDmIVTlV.css`（约 10月16日 15:47）。无 source map。同目录还留着更早的几个 bundle，不要删 |
| 邮箱后端 | 本仓库与公司这台电脑上都没有。必须按线上前端的请求重新实现 |
| 本机备份 | `recover/cloud-backup/studio-app/` 仅本地，已加入 `.gitignore`，不要提交 |

压缩后的 Studio Web 脚本里读出的接口（以此为准，不要凭记忆改路径）：

| 方法 | 路径 | 请求 | 前端依赖的响应 |
|------|------|------|----------------|
| `POST` | `/v1/auth/register` | `{ username, password, display_name, email }` | `message`（缺省文案：「注册成功，等待审核」） |
| `POST` | `/v1/auth/login` | `{ username, password }` | 现有字段 + `email` |
| `GET` | `/v1/auth/profile` | Header `X-API-Key` | `email`、`username`、`name`、`user_id` |
| `POST` | `/v1/auth/email` | Header `X-API-Key`，`{ password, email }` | `message`（缺省：「邮箱已绑定」）、`email` |
| `POST` | `/v1/auth/password-reset/send` | `{ email }` | `message`（缺省：「验证码已发送」）、`cooldown_seconds` |
| `POST` | `/v1/auth/password-reset` | `{ email, code, new_password, confirm_password }` | `message`（缺省：「密码已重置」） |
| `POST` | `/v1/auth/change-password` | 已有 | 不变 |

发信通道（SMTP / 哪家邮件）从压缩包里看不出来，实现前要单独定。

页面文案与排版以线上站为准。截图用来对齐颜色、间距、官网版式，不必为了还原接口再截一套。建议补：官网首页与各内页、Studio Web 登录/注册、设置里的绑定邮箱、忘记密码。

---

## 2. 禁止事项

- 不要用当前 Git 里的 `web/` 或 `desktop/studio-web/` 执行 `npm run build` 再上传。那会用周五之前的旧页面盖掉云上已经改好的版本。
- 不要清理服务器上 `comfy-studio-app/assets/` 里未挂在 `index.html` 上的旧 js/css，直到源码重写并重新部署成功。
- 不要把 `recover/` 提交进仓库。

---

## 3. 恢复顺序

### Phase 0 — 再备份一份云端静态站（开工前）

在 VPS 上打包（示例）：

```bash
tar -C /var/www -czf /root/comfy-frontend-20261016.tgz comfy-studio comfy-studio-app
```

本机已有 Studio Web 最新包。官网整站若还没拉下来，开工前再 `scp` 一份。

### Phase 1 — 后端对齐线上前端（优先）

在现有 FastAPI / `user_store` 上补齐上表，使现在挂着的 Studio Web 重新可用：

1. 用户表增加邮箱（可空；已注册用户稍后绑定）。
2. 注册写入邮箱；同一邮箱不可重复占用。
3. `GET /v1/auth/profile`、登录响应带上邮箱。
4. `POST /v1/auth/email`：校验当前密码后绑定或更换。
5. 找回密码：向已绑定邮箱发验证码，冷却与校验后再改密码。未绑定邮箱的账号不能走这条。
6. 契约写入 `desktop/docs/api-contract.md`，`.env.example` 只放邮件相关变量名，不写真实密钥。
7. pytest 覆盖注册、绑定、错误密码、验证码重置。

发信实现方式开工时再定（自建 SMTP 或第三方）。在定下来之前，可用仅日志的调试开关在本机验证流程，生产必须真发信。

### Phase 2 — 重写页面源码（不能从 bundle 还原工程）

Astro / Vite 产物没有 source map，只能以线上页面为规格、以 Git 旧源码为底重做。

1. **官网** `web/`：对照 `https://comfy-studio.sharex.team` 与截图，改排版、颜色、玻璃/设计。逻辑与数据文件（`demo.json`、`workflows.json`）能复用就复用。
2. **Studio Web** `desktop/studio-web/`：在现有源码上补注册邮箱、设置页绑定邮箱、忘记密码，并按线上 CSS/截图把周五的视觉改回去。
3. 源码与线上对齐并在本地看过之后，才允许重新 build 并覆盖 `/var/www/comfy-studio` 与 `/var/www/comfy-studio-app`。

### Phase 3 — 验收

- [ ] 线上 Studio Web 注册带邮箱，待审流程仍在
- [ ] 已有账号可在页面绑定邮箱；错密码失败
- [ ] 已绑定邮箱可收验证码并重置密码；未绑定不能发码
- [ ] 官网视觉与 10月16日线上版一致（或你确认过的截图）
- [ ] 新构建部署后，旧 bundle 仍先留在服务器上，确认无问题再删

---

## 4. 相关路径

| 路径 | 说明 |
|------|------|
| `/var/www/comfy-studio/` | 官网静态产物 |
| `/var/www/comfy-studio-app/` | Studio Web 静态产物 |
| `desktop/studio-web/` | 待重写的 Studio Web 源码 |
| `web/` | 待重写的官网源码 |
| `app/user_store.py`、`app/main.py`、`app/schemas.py` | 邮箱后端落点 |
| `desktop/docs/api-contract.md` | 契约需同步 |
| `recover/cloud-backup/` | 本机备份，不入库 |
