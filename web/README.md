# Comfy Studio 官网

Astro + React 岛屿 + Tailwind。介绍 / 演示 / 部署 / 下载。

## 开发

```powershell
cd web
npm install
npm run dev
```

## 构建

```powershell
npm run sync:releases   # 拉取 GitHub Releases → src/data/releases.json
npm run build           # 产物在 dist/（prebuild 会自动 sync）
npm run preview
```

可选环境变量：`GITHUB_TOKEN`、`GITHUB_REPO`（默认 `mokyarcher/Comfy-Studio`）。

## 素材

- Hero / OG：`public/og.svg`
- 演示录屏：`public/media/studio-tour.mp4`
- 样例墙：`src/data/showcase.json`

## 部署

- **GitHub Pages**：推送 `web/**` 到 `main` 后由 [`.github/workflows/web.yml`](../.github/workflows/web.yml) 构建并部署。仓库 Settings → Pages → Source 选 **GitHub Actions**。站点形如 `https://<owner>.github.io/<repo>/`。
- **Cloudflare Pages / Nginx**：本地或 CI 执行 `npm run build`（可不设 `BASE_PATH`），上传 `dist/`。自定义域名时设置 `SITE_URL`。
