# 计划：官网液态玻璃风格（仅方案，未实施）

> 状态：**计划中 / 先别做**  
> 范围：`web/`（Astro 官网 https://comfy-studio.sharex.team）  
> 参考实现：`desktop/studio-web` 的 glass CSS（`--glass-*`、`.glass-rim`、毛玻璃面板），**不是**照搬应用壳与设置项。

---

## 1. 结论：工作量大不大？

**中等偏小，不是重做官网。**

| 档位 | 内容 | 粗估（一人熟练） |
|------|------|------------------|
| **A. 轻量玻璃** | 保留现有绿强调色与版式；Header / 卡片 / CTA 换毛玻璃 + 亮边；背景略加强 | **0.5–1 天** |
| **B. 对齐 Studio Web 气质** | A + 可配置背景图/氛围层、统一 glass token、Hero/演示区重点打磨、动效 2–3 处 | **1.5–3 天** |
| **C. 全站重设计** | 换字体体系、重排信息架构、大改演示/下载页、强动效 | **1 周+**（不推荐作为第一步） |

建议默认走 **B**：视觉与 Web Studio 一家，又不把官网做成「又一个控制台」。

**不大的原因**

- 页面少：首页 / 演示 / 部署 / 下载 / 工作流 / about（约 6 页）
- 样式集中在 `web/src/styles/global.css` + 若干组件里的 `border-border bg-panel` Tailwind
- Studio Web 已有可抄的 glass token 与 rim 技法，官网可 **抽 CSS 子集**，不必迁 React `GlassTheme` / 用户可调透明度

**会变大的点**

- 营销页对 **LCP / 移动端 backdrop-filter** 更敏感；背景图一上就要压图、懒加载、降级
- `DemoPanel` / `ShowcaseWall` / `DownloadCards` 等交互面多，逐个替换 class 要回归
- 若坚持「和 Studio 同一套紫主色」会冲击现有 **绿色 brand accent**（见下节决策）

---

## 2. 现状 vs 目标

### 官网现状（`web/`）

- Astro + React 岛屿 + Tailwind v4（`@theme`）
- 深色底 + 微网格 + 绿色 accent（`#3ddc97`）+ Fraunces 标题
- 组件多为扁平 `bg-panel` / `border-border`；Header 已有轻度 `backdrop-blur`

### Studio Web 液态玻璃（参考）

- CSS 变量：`--glass-pct`、`--glass-filter`、`--glass-rim` 高光环
- 需要 **有内容可透** 的背景（照片 / 渐变），否则玻璃像脏灰板
- 应用内可调透明度/模糊；官网 **不必** 做设置面板

### 目标气质（建议）

- 一眼能感到「和 Studio 同一产品家族」：毛玻璃卡片、亮边、轻 specular
- **保留官网绿色 accent**（品牌差异：官网营销绿 / Studio 创作紫），避免整站换紫
- Hero：品牌名仍是第一视觉；玻璃用于导航、卡片、CTA，不把 Hero 做成仪表盘卡片墙
- 遵守已有前端偏好：少卡片堆砌、少紫白渐变套路；动效 2–3 处即可

---

## 3. 范围

### In scope

1. `global.css`：玻璃 token + `.glass-panel` / `.glass-nav` / `.glass-cta`（可从 studio-web 裁剪）
2. `BaseLayout` / `site-shell`：氛围背景（渐变 + 可选 1 张轻量 hero 背景；可复用 studio 背景或官网现有 `og`/demo 氛围）
3. `Header.astro` / `Footer.astro`：毛玻璃顶栏与底栏
4. 首页 `index.astro` + `Hero.tsx`：主 CTA、能力卡片玻璃化
5. 内页共性表面：`demo` / `download` / `deploy` / `workflows` / `about` 的卡片与区块容器
6. 关键 React 岛：`DemoPanel`、`DownloadCards`、`WorkflowCatalog`、`ShowcaseWall`、`ArchDiagram` — 换 class，逻辑不动
7. 文档：`web/README.md` 一句说明视觉与 studio-web 的关系；部署验收清单

### Out of scope（本计划不做）

- 改文案 / IA / 新页面
- 把 `liquid-glass-react` 或 WebGL 液态仿真引进官网
- 官网用户可调玻璃透明度（Studio Settings 那套）
- Electron 桌面端 / gateway-web 皮肤（已各有体系）
- 强行统一成 Studio 紫色主题

---

## 4. 技术策略

```text
studio-web/index.css（glass 子集）
        ↓ 手工摘取 / 微调色相贴合官网绿
web/src/styles/global.css  （token + utility）
        ↓
Astro 布局 + 页面 Tailwind class 替换
React 岛 className 替换
```

1. **Token 先行**：在 `@theme` / `:root` 增加 `--glass-*`，accent 仍用现有绿  
2. **背景层**：`site-shell` 增加一层低对比背景（静态图或渐变）；无图时玻璃降级为半透明实色（`@supports` 或降低 blur）  
3. **组件映射**（示例）  

   | 现状 | 目标 |
   |------|------|
   | `bg-panel/50 border-border` | `glass-panel glass-rim` |
   | Header `bg-bg/80 backdrop-blur-md` | `glass-nav` |
   | 主按钮实色绿 | 实色 CTA 保留一块「实心锚点」+ 次按钮玻璃描边 |

4. **性能**  
   - 少大面积同时 `backdrop-filter`（优先卡片与顶栏）  
   - `prefers-reduced-motion` 关掉装饰性动画  
   - 背景图 ≤ WebP/AVIF，宽度按 hero 裁切  

5. **不共享 npm 包（第一期）**：先复制 CSS，避免 Astro ↔ Vite 应用跨包耦合；稳定后再谈 `desktop/shared` 抽样式。

---

## 5. 分阶段实施（批准后再做）

### Phase 0 — 视觉钉板（0.5 天内）

- 定 2 张参考：官网现状截图 vs Studio Web 创作页玻璃  
- 拍板：绿 accent 保留、背景用渐变还是照片、Hero 是否全幅背景  

### Phase 1 — 设计系统落地（0.5–1 天）

- `global.css` glass token + 3–4 个 utility  
- `BaseLayout` / Header / Footer  
- 首页 Hero + 能力三卡  

### Phase 2 — 内页扫尾（0.5–1 天）

- demo / download / deploy / workflows / about  
- React 岛 class 对齐  

### Phase 3 — 抛光与验收（0.5 天）

- 移动端 Safari / Chrome；`prefers-reduced-motion`  
- Lighthouse 粗看 LCP（背景图勿拖垮）  
- 构建部署到现有官网 nginx（与今流程一致）  

---

## 6. 风险与决策点

| 项 | 风险 | 建议 |
|----|------|------|
| 无丰富背景时玻璃发闷 | 高 | 必须有氛围层；否则只做轻 blur + 亮边 |
| 移动端卡顿 | 中 | 小屏降低 blur 或关闭 backdrop |
| 与 Studio 紫不一致 | 低 | **有意保留绿**作官网识别 |
| 演示截图本身是旧 UI | 中 | 玻璃改外壳即可；截图可后期再换 |
| 设计规则「少卡片」 | 中 | 能力区可保留 3 卡（交互容器）；勿再加统计条/徽章墙 |

**需你拍板的两点（开工前）**

1. 档位：**A 轻量** 还是 **B 对齐 Studio**？  
2. 背景：纯渐变，还是用一张产品氛围图（可从 studio-web backgrounds 选）？

---

## 7. 验收标准（将来做完时）

- [ ] 顶栏、首页主卡片、下载卡呈毛玻璃 + 亮边，非扁平灰板  
- [ ] 品牌仍是绿色 accent + Comfy Studio 名；首屏不是仪表盘  
- [ ] 与 Studio Web 并排截图时「同一家族」可辨认  
- [ ] 手机可滚动、无严重掉帧；动效可关  
- [ ] `web` build 通过；文档一句说明已更新  

---

## 8. 相关路径速查

| 路径 | 说明 |
|------|------|
| `web/src/styles/global.css` | 官网全局样式入口 |
| `web/src/layouts/BaseLayout.astro` | 壳层 |
| `web/src/components/*` | Header / Hero / Demo 等 |
| `desktop/studio-web/src/index.css` | glass 参考实现 |
| `desktop/studio-web/src/lib/backgrounds.ts` | 可选背景素材索引 |

---

## 9. 下一步

本文档批准且档位（A/B）与背景策略选定后，再开实现 PR；**当前仓库不改 `web/` 业务代码。**
