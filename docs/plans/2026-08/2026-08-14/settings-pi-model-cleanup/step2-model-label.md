---
step: 2
title: 模型改名
status: pending
---

## 目标

`piModels` 从 `string[]` 改为 `Array<{ id: string; label?: string }>`，设置页支持行内改名，所有显示处统一 `label ?? id`。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-sdk-cleanup.md] SDK 分支已删，pi 编辑区恒显示；`piModels` 消费点已收敛到 provider.ts / ModelSelector.tsx / model-selection.ts / SubAgentTab.tsx / settings 页
- 关键决策：`ModelSelection.tier` 恒存模型 ID，label 纯显示，**对话数据零改动**
- 数据迁移放 `settings-service.ts` 的 profile 迁移逻辑里（Step 1 已无条件化），string 逐条转 `{ id }`

## 计划改动

- [ ] 类型双份：`types/settings.ts` 与 `electron/main/services/settings-types.ts` 的 `piModels?: string[]` → `piModels?: Array<{ id: string; label?: string }>`，注释同步（label 为显示名，缺省显示 id）
- [ ] `electron/main/services/settings-service.ts`：profile 迁移函数内加形状迁移——元素为 string 的转 `{ id: 原值 }`；对象元素的 `id` 非空 string 保留、`label` 仅在非空 string 时保留；按 `id` 去重保首现顺序；发生变化返回 true
- [ ] `app/settings/page.tsx` 模型清单区（Step 1 后恒显示区）：
  - 每行改为：模型 ID（mono 只读）+ 显示名输入框（placeholder = id，常驻可编辑，输入即 `updateProfileField` 写 `label`，清空写 `undefined`）+ 删除按钮（按 id 过滤）
  - 添加输入框校验保持「同 id 不可重复」（includes 判断改 `some(m => m.id === raw)`）
- [ ] `electron/main/agents/pi/provider.ts`：`resolvePiModel` 的 includes 校验（:77）改 `piModels.some(m => m.id === target.tier)`；`buildPiModels`（:107）遍历对象数组，`buildPiModel(profile, m.id, m.label ?? m.id)`
- [ ] `lib/model-selection.ts`：`dedupeProfileTiers` 返回值加 label——`{ tier: m.id, modelId: m.label ?? m.id }`（modelId 字段即显示文案，被 ModelSelector 直接渲染）
- [ ] `components/ModelSelector.tsx`：`resolveCurrentLabel` 改为按 id 匹配后返回 `label ?? id`；`ModelTier` 类型引用若 Step 1 已删则此处 import 清理
- [ ] `app/settings/SubAgentTab.tsx` :52-53：includes 改按 id 匹配，显示 `label ?? tier`

## 验收

- `bun run build` + `bun run lint` 通过
- 存量 settings.json 的 `piModels: ["gpt-5", ...]` 启动后迁移为 `[{id:"gpt-5"}, ...]`
- 设置页：添加模型 → 输入显示名 → ModelSelector 下拉与当前徽章显示显示名；清空显示名回退显示 ID
- 发消息正常（请求体 model 字段仍是 ID）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
