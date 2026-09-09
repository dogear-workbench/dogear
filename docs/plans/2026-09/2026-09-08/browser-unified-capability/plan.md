# 浏览器能力统一实施计划

**目标**：建立宿主无关的浏览器能力协议层，内嵌 WebContentsView 成为主宿主，抓取管线（search/readArticle）迁移并降层为快捷档，扩展通道对齐协议，最终退役 Patchright。

**架构思路**：能力协议是本体（观察/操作/恢复原语 + 页面状态机 + Tab 模型），内嵌与扩展是协议的两个宿主 adapter。先建内嵌宿主骨架（Step 1-3），再把抓取迁移上去（Step 4），然后对齐扩展通道并修 NM 四件套（Step 5），最后做呈现交付与退役清理（Step 6）。结构化管线从「独立管线」降为「能力之上的快捷档」。

**涉及模块**：
- 新增 `electron/main/services/browser/embedded/`（内嵌宿主：view 管理 / CDP / AX 观察 / 协议层）
- 改造 `electron/main/services/browser/browser-search-service.ts`、`browser-article-service.ts`（换宿主 + 降级语义）
- 删除 `browser-manager.ts`（Patchright，Step 6）
- 改造 `extension/src/background.js`、`dom-actions.js`、popup（协议对齐 + NM 四件套）
- 改造 `electron/main/agents/tools/browser-tools.ts`（底层切换 + 新工具 find/scroll）
- UI：`components/companion/BrowserPanel.tsx`（呈现交付 + awaiting_human）

## 步骤索引

- [x] [Step 1: 内嵌宿主骨架](./step1-embedded-host.md) — WebContentsView 生命周期 + persistent partition + 诚实 UA + Tab 模型 + 后台/可见双模式
- [x] [Step 2: 观察能力](./step2-observation.md) — CDP AX Tree 接入 + observe/find 工具 + generation/ref 失效恢复
- [x] [Step 3: 操作能力](./step3-actions.md) — navigate/click/fill/scroll/press/wait_for/screenshot + 页面状态机 + site-policy 平移
- [x] [Step 4: 抓取迁移](./step4-fetch-migration.md) — searchWeb/readArticle 底层换内嵌 + parse_empty 降级探索语义
- [x] [Step 5: 扩展通道对齐 + NM 四件套](./step5-extension-alignment.md) — 扩展 observe 语义树改造 + 断开按钮 + gateway 退出收尾 + 安装器时序 + 心跳兜底
- [x] [Step 6: 呈现交付与退役](./step6-presentation-retire.md) — companion 挂 view + awaiting_human 状态机 UI + Patchright 删除

## 全局决策

- **工具命名**：内嵌宿主工具沿用 `dogear__browser__*` 前缀（底层从 Patchright 换到内嵌，agent 侧 Profile 描述不需要大改）；扩展通道保持 `dogear__extension__*`；两套工具语义对齐同一协议（同款参数与返回结构），新增 `find`、`scroll` 为 `dogear__browser__find` / `dogear__browser__scroll`
- **Tab 模型**：`{ tabId, source: 'agent-opened' | 'user-connected', url, title, generation, state }`，内嵌宿主全量实现；扩展通道 tab 以现有 gateway snapshot 映射进该模型
- **generation/ref**：ref 格式 `{backendNodeId}@{generation}`；导航、SPA 路由切换、CDP 重连均使 generation 递增；操作前校验，失效返回明确的 `ref_expired` + 引导重新 observe（不做静默自动重试，agent 显式重观察是探索循环的一部分）
- **页面状态机**：`loading / ready / login_required / verification_required / awaiting_human / rate_limited / changed_layout / crashed`；观察与操作工具的返回统一携带 `pageState` 字段；判定规则集中在协议层一处（URL 模式 + 页面特征关键词），不散落各服务
- **风控**：site-policy 的 policyGate（域名授权、节奏预算、随机延迟、风控关键词、guard_password/guard_submit）平移挂到内嵌宿主所有操作工具入口，规则不放松
- **UA 策略**：默认 UA 去 `Electron/x.x.x` 标记 + 追加 `Dogear/{version}`，不伪造其他浏览器
- **partition**：`persist:dogear-browser-<sha256(workspaceId).slice(32)>`，按 workspace 隔离
- **不写注释**、单文件 >300 行拆分，遵循项目硬约束
- 每步完成需 `bun run lint` 0 errors + `tsc` 通过 + `bun run build:electron` 通过
