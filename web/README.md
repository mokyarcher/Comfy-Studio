# Comfy Studio 官网

Astro + React 岛屿 + Tailwind。介绍 / 演示 / 部署 / 下载 / 工作流。

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
- **工作流 / 模型清单**：`src/data/workflows.json`（维护用，勿把维护说明写进 `intro`）

### 工作流清单格式（`workflows.json`）— 仅开发维护

页面路由：`/workflows`（旧 `/models` 会 301 跳转）。结构：**工作流 → models[] → links[]**。

```json
{
  "projectVersion": "1.0.0",
  "updatedAt": "2026-10-14",
  "intro": "面向访客的一句说明即可",
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
  "workflows": [
    {
      "id": "txt2img",
      "name": "文生图",
      "mode": "txt2img",
      "summary": "Qwen 文生图主工作流",
      "required": true,
      "models": [
        {
          "id": "qwen-image",
          "name": "Qwen-Image",
          "role": "主生成权重",
          "sizeHint": "约 20 GB",
          "savePath": "ComfyUI/models/diffusion_models/xxx.safetensors",
          "links": [
            { "label": "魔搭", "url": "https://…", "mirror": "modelscope" },
            { "label": "HF Mirror", "url": "https://…", "mirror": "hf-mirror" }
          ]
        }
      ]
    }
  ]
}
```

`links[].url` 为空则不显示该按钮；有 `https://` 才出下载入口。改完后 `npm run build` 并 scp 到服务器。

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
