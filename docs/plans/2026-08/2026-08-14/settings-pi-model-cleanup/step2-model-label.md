---
step: 2
title: 模型改名
status: done
---

## 目标

`piModels` 从 `string[]` 改为 `Array<{ id: string; label?: string }>`，设置页支持行内改名，所有显示处统一 `label ?? id`。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-sdk-cleanup.md] SDK 分支已删，pi 编辑区恒显示；`piModels` 消费点已收敛到 provider.ts / ModelSelector.tsx / model-selection.ts / SubAgentTab.tsx / settings 页
- 关键决策：`ModelSelection.tier` 恒存模型 ID，label 纯显示，**对话数据零改动**
- 数据迁移放 `settings-service.ts` 的 profile 迁移逻辑里（Step 1 已无条件化），string 逐条转 `{ id }`

## 计划改动

- [x] 类型双份：`types/settings.ts` 与 `electron/main/services/settings-types.ts` 的 `piModels?: string[]` → `piModels?: Array<{ id: string; label?: string }>`，注释同步（label 为显示名，缺省显示 id）
- [x] `electron/main/services/settings-service.ts`：profile 迁移函数内加形状迁移——元素为 string 的转 `{ id: 原值 }`；对象元素的 `id` 非空 string 保留、`label` 仅在非空 string 时保留；按 `id` 去重保首现顺序；发生变化返回 true
- [x] `app/settings/page.tsx` 模型清单区（Step 1 后恒显示区）：
  - 每行改为：模型 ID（mono 只读）+ 显示名输入框（placeholder = id，常驻可编辑，输入即 `updateProfileField` 写 `label`，清空写 `undefined`）+ 删除按钮（按 id 过滤）
  - 添加输入框校验保持「同 id 不可重复」（includes 判断改 `some(m => m.id === raw)`）
- [x] `electron/main/agents/pi/provider.ts`：`resolvePiModel` 的 includes 校验（:77）改 `piModels.some(m => m.id === target.tier)`；`buildPiModels`（:107）遍历对象数组，`buildPiModel(profile, m.id, m.label ?? m.id)`
- [x] `lib/model-selection.ts`：`dedupeProfileTiers` 返回值加 label——`{ tier: m.id, modelId: m.label ?? m.id }`（modelId 字段即显示文案，被 ModelSelector 直接渲染）
- [x] `components/ModelSelector.tsx`：`resolveCurrentLabel` 改为按 id 匹配后返回 `label ?? id`；`ModelTier` 类型引用若 Step 1 已删则此处 import 清理
- [x] `app/settings/SubAgentTab.tsx` :52-53：includes 改按 id 匹配，显示 `label ?? tier`

## 验收

- `bun run build` + `bun run lint` 通过
- 存量 settings.json 的 `piModels: ["gpt-5", ...]` 启动后迁移为 `[{id:"gpt-5"}, ...]`
- 设置页：添加模型 → 输入显示名 → ModelSelector 下拉与当前徽章显示显示名；清空显示名回退显示 ID
- 发消息正常（请求体 model 字段仍是 ID）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 迁移函数拆为可导出的纯函数 `normalizePiModels(raw: unknown)`（归一化 + 去重）+ `migratePiProfiles` 内联调用比较落盘，便于直接单测；`migratePiProfiles` 从私有改为导出
  - 种子填充仍写 string[]，形状统一交给 `normalizePiModels`，避免种子逻辑重复处理对象形状
  - `resolvePiModel` 同步改为 `find` 匹配后 `buildPiModel(profile, target.tier, matched.label ?? target.tier)`（计划只写了 buildPiModels 一处，但 name 字段同为显示链，按全局决策统一）
  - 设置页 label 输入清空时构造 `{ id }`（不用 `{ ...m, label: undefined }`），避免 deepEqual/structuredClone 下 label 键残留导致 dirty 误判
- 改动文件清单：
  - `types/settings.ts`、`electron/main/services/settings-types.ts`：piModels 改形 + 注释
  - `electron/main/services/settings-service.ts`：normalizePiModels + migratePiProfiles 形状迁移
  - `electron/main/agents/pi/provider.ts`：find by id + label 透传
  - `app/settings/page.tsx`：行内改名 + 按id增删
  - `lib/model-selection.ts`、`components/ModelSelector.tsx`、`app/settings/SubAgentTab.tsx`：label ?? id 显示链
  - `electron/main/services/settings-normalize.test.ts`：补 9 个用例（26 全过）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `piModels?: Array<{ id: string; label?: string }>`；`ModelSelection.tier` 恒存 id，对话数据零改动
  - `normalizePiModels(raw: unknown): Array<{ id: string; label?: string }>`（导出，纯函数）；`migratePiProfiles(settings): boolean`（已导出）
- 下个 step 该从哪里继续：Step 3（上下文目录），见 step3-context-catalog.md
- 待办或已知限制：手改 JSON 出现的乱序键（label 在 id 前）首次迁移会重写一次落盘，之后幂等；无其他已知限制
