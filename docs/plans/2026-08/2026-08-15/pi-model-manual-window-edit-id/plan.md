# PI 模型手填上下文窗口与行内改 ID 实施计划

**目标**：模型清单条目支持手填上下文窗口（优先级：手填 > pi-ai 目录 > 200K 回落）+ 模型 ID 行内可编辑（替代删除重加）。

**架构思路**：`piModels` 条目扩展可选 `contextWindow` 字段，主进程 3 个读取点（provider 构造 / usage 快照 / usage 条目）统一感知手填值；设置页模型行 UI 改造（ID 格变输入框、窗口徽标点击编辑）。`services/usage/usage-extractor.ts`（SDK 历史导入，无 profile 上下文）保持纯查表不动。设计详见 `../pi-model-manual-window-edit-id-design.md`。

**涉及模块**：
- `electron/main/services/settings-types.ts` / `settings-service.ts`（类型 + 归一化放行）
- `electron/main/agents/pi/provider.ts`（buildPiModel 手填优先）
- `electron/main/agents/pi-session/usage-extractor.ts` / `pi-session.ts`（usage 提取感知手填）
- `lib/pi-model-catalog.ts`（渲染层解析 + K/M 输入解析辅助）
- `app/settings/page.tsx`（模型行 UI，建议抽 `PiModelRow` 行组件避免 page 膨胀）

## 步骤索引

- [x] [Step 1: 主进程数据层与窗口解析链路](./step1-main-process-window.md) — 类型扩展、normalizePiModels 放行、provider/usage 链路手填优先，补归一化测试
- [ ] [Step 2: 设置页模型行 UI](./step2-settings-ui.md) — 渲染层辅助函数 + ID 可编辑 + 窗口徽标可编辑

## 全局决策

- 窗口解析优先级一律：`entry.contextWindow ?? lookupContextWindow(id) ?? FALLBACK_CONTEXT_WINDOW(200_000)`
- normalizePiModels 只保留**正整数**（`Number.isInteger && > 0`）的 contextWindow，其余丢弃；去重（按 id）逻辑维持现状
- 改 id 后存量对话 `tier` 存旧 id → 发消息走现有 throw「模型不在清单里」，用户手动重选（已拍板，不做迁移、不做静默回落）
- 手填对目录已识别模型同样生效（可覆盖目录值）
- UI 输入支持 `1M` / `200K` / `1000000` 三种写法；清空 = 删除手填字段恢复查表；非法输入不生效
- 不写新测试文件，只在 `settings-normalize.test.ts` 补 normalizePiModels 用例；保证现有测试不破
