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

- **生产站**：https://comfy-studio.sharex.team（云机 Nginx，根目录 `/var/www/comfy-studio`）
- 配置模板：[`deploy/comfy-studio.sharex.team.http.conf`](../deploy/comfy-studio.sharex.team.http.conf) / [`ssl.conf`](../deploy/comfy-studio.sharex.team.ssl.conf)
- 发版更新静态站：

```powershell
cd web
$env:SITE_URL = 'https://comfy-studio.sharex.team'
npm run build
scp -r dist/* root@111.229.166.216:/var/www/comfy-studio/
```

- **GitHub Pages**（可选备用）：[`.github/workflows/web.yml`](../.github/workflows/web.yml)
