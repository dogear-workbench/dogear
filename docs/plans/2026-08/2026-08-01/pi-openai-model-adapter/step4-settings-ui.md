---
step: 4
title: 设置页 UI + 模型选择组件适配
status: done
---

## 目标

设置页 Profile 编辑表单在 `apiFormat==='pi'` 时显示"上游协议"下拉框 + 模型清单 CRUD（替代三个固定 haiku/sonnet/opus 输入框）；`ModelSelector`/`dedupeProfileTiers` 能正确枚举/展示 pi Profile 的自由模型清单。

## 依赖上下文（接力棒输入）

- **Step 1 产出**：`ModelProfile.piWireApi?: 'anthropic-messages'|'openai-responses'`、`piModels?: string[]`；`ModelSelection.tier: string`。
- **`app/settings/page.tsx` 现状**：
  - `addNewProfile()`（175-187 行）新建 Profile 默认 `haikuModel/sonnetModel/opusModel: ''`，不设 `apiFormat`（等于 `'anthropic-sdk'`）
  - `updateProfileField(profileId, updates: Partial<ModelProfile>)`（189 行起）是唯一的字段写入入口，浅合并进 `local.profiles[profileId]`
  - "运行时格式"下拉框在 620-636 行；紧接着 638-651 行是三个固定模型输入框的 `.map` 渲染（用 `(['haikuModel','sonnetModel','opusModel'] as const).map(field => ...)`）
- **`lib/model-selection.ts` 现状**（全文 22 行）：`dedupeProfileTiers(profile)` 遍历固定的 `TIER_PRIORITY = ['opus','sonnet','haiku']`，查 `profile[\`${tier}Model\`]`，返回 `{tier: ModelTier, modelId}[]`；`sameSelection` 比较 `profileId`+`tier`
- **`components/ModelSelector.tsx` 现状**（全文 109 行）：`tierToModelKey(tier)` 把 `ModelTier` 转成字段名去查 `profile[xxxModel]`；`currentLabel` 用它算当前选中模型的展示文本（39 行）；下拉菜单渲染部分（77-99 行）调 `dedupeProfileTiers(profile)` 拿 `{tier, modelId}[]` 直接渲染，不关心 tier 具体语义
- **设计决策回顾**：`piModels` 是纯字符串数组，模型 ID 本身既是显示名也是选择键，不需要单独的 label 字段；`dedupeProfileTiers` 按 `profile.apiFormat` 分支后返回值形状不变（`{tier, modelId}[]`），下游 `ModelSelector.tsx` 的渲染逻辑因此不用改

## 计划改动

- [ ] `lib/model-selection.ts`：
  - `dedupeProfileTiers(profile)` 开头分支：`profile.apiFormat === 'pi'` 时，遍历 `profile.piModels ?? []`，对每个 `id` 推入 `{ tier: id, modelId: id }`（不需要 `TIER_PRIORITY`/去重键逻辑，`piModels` 本身列表管理时已经保证不重复——见下面 UI 改动的去重处理）；否则走现有三档逻辑
  - 返回类型 `Array<{ tier: string; modelId: string }>`（`tier` 从 `ModelTier` 放宽为 `string`，与 `ModelSelection.tier` 一致）
- [ ] `components/ModelSelector.tsx`：
  - `tierToModelKey` 相关的查表逻辑只在 anthropic-sdk 分支使用；`currentLabel` 计算处按 `profile.apiFormat` 分支：`'pi'` 时直接用 `value.tier` 本身当展示文本，查不到（Profile 被删或模型被移出清单）时保留现有"已删除的模型"兜底
  - 下拉菜单渲染部分（`items.map`）不用改
- [ ] `app/settings/page.tsx`：
  - `addNewProfile()` 不用改（新 Profile 默认 anthropic-sdk，用户手动切到 pi 后再配置模型清单）
  - "运行时格式"下拉框（620-636 行）之后：`profile.apiFormat === 'pi'` 时渲染新的一块："上游协议"下拉框（`piWireApi`，选项 `anthropic-messages`（默认）/ `openai-responses`）+ "模型清单"区域（已添加模型的列表，每条带删除按钮；一个文本输入框 + "添加"按钮，添加时: 去空格、拒绝空字符串、`Set` 去重后 push 进 `piModels`，走 `updateProfileField(id, { piModels: [...] })`）
  - 原来的三个固定模型输入框（638-651 行）改成条件渲染：只在 `apiFormat !== 'pi'`（即 anthropic-sdk 或未设置）时显示
- [ ] 手测验收：
  - 新建 Profile，切到 pi + openai-responses，添加几个模型 ID（如 `gpt-5`、`gpt-5-mini`），保存后重新打开设置页确认清单还在
  - 用这个 Profile 在某个对话的 `ModelSelector` 下拉里能看到刚添加的模型，选中后 `currentLabel` 显示正确
  - 删除清单里正在被某个对话选中的模型后，回到该对话确认 `ModelSelector` 显示"已删除的模型"而不是崩溃

## 实施回填（做完后填）

### 实际改动
- `lib/model-selection.ts`：`dedupeProfileTiers` 按 `apiFormat` 分支，pi 路径遍历 `piModels` 推 `{tier:id, modelId:id}`；返回类型放宽为 `Array<{tier:string; modelId:string}>`
- `components/ModelSelector.tsx`：抽 `resolveCurrentLabel(settings, value)` 函数，pi 路径直接用 `value.tier` 当展示文本，查不到统一走"已删除的模型"兜底；下拉菜单渲染逻辑未改
- `app/settings/page.tsx`：636 行后插入 `apiFormat==='pi'` 条件块（上游协议下拉 + 模型清单 CRUD：列表+删除按钮+输入框+Enter/添加按钮提交，去空格+`Array.includes`去重）；原三档 `.map` 包一层 `apiFormat!=='pi'` 条件；新增 `piModelDrafts` state 管理各 Profile 的输入框草稿；**622-627 行原有的运行时格式描述文字（与本任务无关的既存未提交改动）全程未被触碰**
- 验证：`bun run lint` 0 error；`bunx tsc --noEmit` 改动三文件 0 类型错误（项目其他位置的预存错误与本次无关）；手测因子会话无 GUI 能力，通过静态代码推演覆盖三条验收路径（新建 pi Profile 配置持久化、ModelSelector 枚举选中、删除被引用模型触发兜底文案），逻辑均正确；主会话确认代码符合设计且未跑真实 GUI 交互（后续如遇 UI 层问题走 systematic-debugging 单独排查）

### 给下一步的接力棒
- pi Profile 三件套配置入口（`apiFormat`/`piWireApi`/`piModels`）已在设置页可用，`ModelSelector` 已支持 pi 分支枚举/兜底
- Step 5 建议真实启动 `bun run dev`，端到端跑一次：建 pi Profile → 配置 openai-responses + 真实模型 ID → 某对话选中该模型 → 发消息观察请求实际走的 wire api 是否正确
- 非 bug 观察（不需处理）：删除 `piModels` 里被选中的模型不做级联清理，靠 `resolveCurrentLabel` 兜底文案展示，与 anthropic-sdk 分支清空三档字段的既有行为一致
