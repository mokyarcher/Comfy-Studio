# 待办事项

按优先级大致排序。做完一项请勾选并补一行「完成说明」。

---

## 进行中 / 下一步

### [ ] 文生图多工作流可选（`workflow_id`）

**目标**：用户选「文生图」后，可再选不同文生图工作流（不是新 mode）。

**概念拆分**：

| 概念 | 含义 |
|------|------|
| `mode` | 能力类型：`txt2img` / `image_edit` / `image_to_video` |
| `workflow_id` | 该 mode 下的具体管线，如 `qwen-default`、`flux-fast` |

**建议实现**（中等偏易，约 1～2 天）：

1. **本机 GPU**：`llm_workflow/txt2img/<id>/` 下放多套 `workflow_api.json` + `*_mapping.json`；启动扫描注册
2. **API**：`GenerateImageRequest` 增加可选 `workflow_id`（默认现有那一套）；`GET /v1/workflows?mode=txt2img` 返回可选列表（id、显示名、简介）
3. **Studio Web / Electron**：文生图面板增加工作流选择（下拉或卡片）
4. **约束**：各套 mapping 仍走现有字段（prompt / 尺寸 / steps / seed）；不要把需要参考图的能力塞进 `txt2img`
5. **部署注意**：清单来自生成面（GPU FRP），Meta 不跑生成；画廊 / 展馆是否持久化 `workflow_id` 一并定

**现状锚点**：`app/workflow.py` 的 `WorkflowRegistry` 目前是 **mode → 唯一 bundle**；`.env` 的 `WORKFLOW_*` 只配一套。

**不做**（本项范围外）：按用户动态上传任意工作流；跨 mode 混用同一选择器。

---

## 备忘（低优先级 / 可选）

- [ ] Electron Studio 展馆页是否同步 Web 的点赞 / 收藏 / 评论 UI（数据已在云 Meta）
- [ ] `scripts/deploy_cloud_meta.ps1` 部署时勿覆盖云端已有 `POLISH_*` 等密钥配置（合并 `.env` 而非整文件覆盖）

---

## 已完成（近期，便于对照）

- [x] 云 Meta + `INSTANCE_ID` 数据隔离（用户 / 画廊 / 展馆 / works）
- [x] 展馆点赞 / 收藏 / 评论（云 `showcase.db`）
- [x] Web Studio 验收以云端为准（见 `.cursor/rules/test-on-cloud.mdc`）
