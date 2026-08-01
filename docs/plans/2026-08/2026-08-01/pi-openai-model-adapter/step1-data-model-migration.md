---
step: 1
title: 数据模型 + 存量迁移
status: done
---

## 目标

`ModelProfile` 加 `piWireApi`/`piModels` 两个可选字段，`ModelSelection.tier` 类型放宽为 `string`；`isProfileComplete` 按 `apiFormat` 分支校验；启动时一次性把已经是 `apiFormat:'pi'` 但没有 `piModels` 的 Profile，用旧三档字段种一份初始清单。

## 依赖上下文（接力棒输入）

- **现状**：`types/settings.ts:17-33` 定义 `ModelProfile`（含 `apiFormat?: 'anthropic-sdk'|'pi'`，`haikuModel/sonnetModel/opusModel` 必填字符串）；`ModelSelection`（`types/settings.ts:3-6`）是 `{ profileId: string; tier: ModelTier }`；`ModelTier = 'haiku'|'sonnet'|'opus'`（`types/settings.ts:1`）。`electron/main/services/settings-types.ts` 是主进程侧镜像，两处结构必须一致（主进程不能 `import` `types/`）。
- **`isProfileComplete`**：`types/settings.ts:38-46`，当前检查 `apiKey && baseUrl && haikuModel && sonnetModel && opusModel`。
- **设计决策回顾**（完整理由见 design.md 第 1-2 节）：`ModelProfile` 不做判别联合，扁平加字段；`ModelSelection.tier` 不新增字段、不做判别联合，直接放宽类型为 `string`——pi 分支下 `tier` 存的是 `piModels` 里的某个模型 ID 原文。
- **新建 Profile 的默认值**：`app/settings/page.tsx:175-187` 的 `addNewProfile()`，新 Profile 默认 `apiFormat` 不设（等于 `'anthropic-sdk'`），`haikuModel/sonnetModel/opusModel` 为空字符串。Step 4 会改这里，本步不用动。

## 计划改动

- [ ] `types/settings.ts`：
  - `ModelProfile` 加 `piWireApi?: 'anthropic-messages' | 'openai-responses';` 和 `piModels?: string[];`（放在 `apiFormat` 字段之后，加注释说明"仅 apiFormat==='pi' 时生效"）
  - `ModelSelection.tier` 类型从 `ModelTier` 改为 `string`，加注释说明 anthropic-sdk 分支是三选一语义、pi 分支存模型 ID
  - `isProfileComplete()` 按 `profile.apiFormat` 分支：`'pi'` 时校验 `apiKey && baseUrl && (piModels?.length ?? 0) > 0`；其余（含 undefined）保持现有三档校验
- [ ] `electron/main/services/settings-types.ts`：镜像以上三处改动，保持与 `types/settings.ts` 完全一致
- [ ] `electron/main/services/settings-service.ts`：新增启动时一次性迁移逻辑
  - 遍历 `settings.profiles`，对 `profile.apiFormat === 'pi' && (!profile.piModels || profile.piModels.length === 0)` 的 Profile：把 `[profile.haikuModel, profile.sonnetModel, profile.opusModel]` 过滤空值 + 去重后写入 `piModels`
  - 参考项目里已有的一次性迁移写法（`electron/main/services/memory/migration-p3.ts`/`migration-p4.ts` 的模式：幂等、在 `loadSettings()` 或 `app.whenReady()` 之后跑一次，跑完写回磁盘）；不需要单独建迁移文件，加到 `settings-service.ts` 现有的加载流程里即可（改动小，不构成独立职责）
  - 如果迁移后确实发生了变化，需要保存回 `settings.json`（复用现有的 save 函数）
- [ ] **SDK 路径的类型收尾**（`ModelSelection.tier` 放宽为 `string` 后，以下 3 处 `Record<ModelTier, string>` 用 `string` 索引会编译报错，必须本步一并修掉，否则 `bun run build:electron` 直接红；这几处都是 anthropic-sdk 专属逻辑，pi 分支不会经过这里，加 `as ModelTier` 断言即可，不改业务逻辑）：
  - `electron/main/agents/agent-query-config.ts:156-169`（`resolveModelSelection`）：`tierMap[target.tier]` → `tierMap[target.tier as ModelTier]`（2 处），`return { ..., tier: target.tier, ... }` → `tier: target.tier as ModelTier`
  - `electron/main/agents/query-based-session.ts:2052-2058`（`setModel`）：`tierMap[selection.tier]` → `tierMap[selection.tier as ModelTier]`
  - `electron/main/agents/agent-worker.ts:590,740,844,1143`：四处 `let tier: ModelTier;` 声明——这几处后面会被 `resolvePiModel()` 的返回值赋值（Step 2 改造后 `PiModelResult.tier` 类型也会放宽为 `string`），本步先把这 4 处声明类型改成 `string`，避免赋值报错；Step 2/3 实施时如果发现赋值点还有别的类型摩擦，一并顺手处理

## 实施回填（做完后填）

### 实际改动
- `types/settings.ts`：`ModelSelection.tier` 改为 `string`（行 5-6）；`ModelProfile` 新增 `piWireApi?`（行 35）、`piModels?`（行 37）；`isProfileComplete()` 按 `apiFormat` 分支（行 43-49）
- `electron/main/services/settings-types.ts`：与上一致的三处镜像改动
- `electron/main/services/settings-service.ts`：新增私有函数 `migratePiProfiles(settings)`（行 63-80），`loadSettings()` 在 deepMerge 后调用（行 55-59），有变化才 `safeJsonWrite` 回写；幂等（`piModels` 已非空则跳过）
- SDK 路径类型收尾（`tier: string` 引发的编译摩擦）：`agent-query-config.ts`（`resolveModelSelection`）、`query-based-session.ts`（`setModel`）、`agent-worker.ts`（4 处 `let tier` 声明改 `string`，移除未用的 `ModelTier` import）均改为局部变量 `as ModelTier` 断言
- 额外修正（step 文档未列，build 红了必须一并处理）：`electron/main/agents/pi/provider.ts` 的 `resolvePiModels()` 里 `target.tier as ModelTier` 同样断言；`PiModelResult.tier` 字段类型本步未动，留给 Step 2
- `bun run build:electron`（tsc 无错）与 `bun run lint`（0 error）均通过，改动文件本身 0 warning

### 给下一步的接力棒
- Step 2 改造 `PiModelResult.tier` 为 `string` 后，`agent-worker.ts` 那 4 处 `let tier: string` 的临时收尾可以自然去掉痕迹（不强制，但顺手可清）
- `pi/provider.ts` 目前只是编译级断言修复，`resolvePiModel`/`buildPiModels` 的协议路由逻辑完全没动，Step 2 从零开始设计
