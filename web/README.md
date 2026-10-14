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
- **模型清单**：`src/data/models.json`（见下）

### 模型清单格式（`models.json`）

部署者页面：`/models`。只改 JSON 即可更新，无需改组件。

```json
{
  "projectVersion": "1.0.0",
  "updatedAt": "2026-10-14",
  "intro": "可选说明",
  "mirrors": [
    {
      "id": "modelscope",
      "name": "魔搭 ModelScope",
      "priority": 1,
      "url": "https://www.modelscope.cn/home",
      "note": "国内首选"
    },
    {
      "id": "hf-mirror",
      "name": "HF Mirror",
      "priority": 2,
      "url": "https://hf-mirror.com",
      "note": "备选"
    }
  ],
  "models": [
    {
      "id": "qwen-image",
      "name": "显示名称",
      "role": "用途一句话",
      "mode": "txt2img",
      "sizeHint": "约 20 GB",
      "savePath": "ComfyUI/models/diffusion_models/xxx",
      "required": true,
      "links": [
        { "label": "魔搭直链", "url": "https://…", "mirror": "modelscope" },
        { "label": "HF Mirror 直链", "url": "https://…", "mirror": "hf-mirror" }
      ],
      "note": "可选备注"
    }
  ]
}
```

`links[].url` 为空时页面显示「直链待补充」；填入 `https://` 地址后会出现下载按钮。

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
