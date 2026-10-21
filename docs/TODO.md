# 待办事项

按优先级大致排序。做完一项请勾选并补一行「完成说明」。

---

## 进行中 / 下一步

（暂无）

---

## 备忘（低优先级 / 可选）

- [ ] 文生图第二套真实工作流资产（如 Flux）：Comfy 调通 → 放入 `llm_workflow/txt2img/<id>/` → 重启 FastAPI；Studio 有多套时自动出现下拉
- [ ] 画廊 / 展馆 / works 可选持久化 `workflow_id`（任务 payload 已写入）
- [ ] Electron Studio 透传 `workflow_id`（Web 已支持）

---

## 已完成（近期，便于对照）

- [x] 文生图多工作流可选（`workflow_id`）
  - 完成说明：`WorkflowRegistry` 支持 mode→多 id；`GET /v1/workflows`；生成请求可选 `workflow_id`；`llm_workflow/txt2img/qwen-default/`；nginx `/v1/workflows` → GPU；Studio Web 多套时显示下拉
- [x] 云 Meta + `INSTANCE_ID` 数据隔离（用户 / 画廊 / 展馆 / works）
- [x] 展馆点赞 / 收藏 / 评论（云 `showcase.db`）
- [x] Web Studio 验收以云端为准（见 `.cursor/rules/test-on-cloud.mdc`）
- [x] Electron Studio 展馆同步点赞 / 收藏 / 评论 UI
- [x] `deploy_cloud_meta.ps1` 合并远端 `.env`（不整文件覆盖密钥）
