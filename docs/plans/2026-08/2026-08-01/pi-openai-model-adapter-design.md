# pi 运行时接入 OpenAI 格式模型 —— 设计

**背景**：pi 主会话迁移（`docs/plans/2026-07/2026-07-30/pi-main-session-migration-design.md`）和四条后台任务迁移已完成，`ModelProfile.apiFormat: 'anthropic-sdk' | 'pi'` 目前只负责"走哪个运行时"，跑在 pi 上的 Profile 目前硬编码只讲 Anthropic Messages 协议（`electron/main/agents/pi/provider.ts` 写死 `anthropicMessagesApi()`）。现在要让 pi 上的 Profile 也能对接官方 OpenAI（含 GPT-5 系列推理模型），协议走 `pi-ai` 内置的 `openai-responses` 模块（官方推荐给 GPT-5，非 legacy 的 `openai-completions`）。

讨论中发现 pi 场景下"三档模型（haiku/sonnet/opus）"这套心智不适用——用户希望在 pi Profile 下自由添加任意数量的模型，选中哪个就用哪个，不分档位。这个诉求只影响 pi 路径，anthropic-sdk 路径的三档模型（对应 Claude Agent SDK 的三个环境变量）保持不变。

**目标**：
1. pi Profile 支持"上游协议"选择（`anthropic-messages` / `openai-responses`），能配置官方 OpenAI Base URL + Key 跑 GPT-5 系列。
2. pi Profile 的模型选择从固定三档改为自由清单（添加/删除任意数量模型 ID）。
3. pi 运行时（主会话 + 四条后台任务）补上推理强度（`ai.effort`）透传，此前 pi 全线缺失这个能力，GPT-5 系列作为推理模型必须有它才有意义。

## 架构

### 1. 数据模型：`ModelProfile` 新增字段，按 `apiFormat` 分支解读

```ts
interface ModelProfile {
  id: string; name: string; apiKey: string; baseUrl: string;
  apiTimeoutMs: number; disableNonessentialTraffic: boolean; autoCompactWindow?: number;
  apiFormat?: 'anthropic-sdk' | 'pi';

  // apiFormat === 'anthropic-sdk' 专用（不变）
  haikuModel: string; sonnetModel: string; opusModel: string;

  // apiFormat === 'pi' 专用（新增，可选）
  piWireApi?: 'anthropic-messages' | 'openai-responses'; // 缺省 'anthropic-messages'
  piModels?: string[]; // 用户添加的模型 ID 清单；ID 本身即显示名/选择键，不需要单独 label
}
```

`isProfileComplete()` 按 `apiFormat` 分支：`anthropic-sdk` 保持现有三档非空校验；`pi` 改为校验 `piModels.length > 0`。

**排除的选项**：不把 `ModelProfile` 拆成按 `apiFormat` 判别的联合类型（虽然更"诚实"），因为现有代码大量地方是"先建一个 profile 对象再逐步填字段"的可变写法（设置页表单），判别联合会让这些地方到处要做类型收窄。保持扁平接口、靠运行时分支解读，是当前项目里 `apiFormat` 字段已经在用的模式，保持一致。

### 2. `ModelSelection.tier` 类型放宽为 `string`，字段名/结构不变

现状 `ModelSelection { profileId: string; tier: ModelTier }` 中 `tier` 只有三个字面量值。pi 场景下不存在"档位"，选择的就是一个具体模型 ID。

**决策**：不新增字段、不做判别联合，直接把 `tier` 的类型从 `ModelTier` 放宽为 `string`。对 `anthropic-sdk` Profile，`tier` 依旧是三选一；对 `pi` Profile，`tier` 直接存模型 ID（等于 `piModels` 里的某一项）。`ModelTier` 类型保留，专供 anthropic-sdk 分支使用。

这个选择让 `conversation.modelSelection`、`subAgent.modelSelection`、`digestModelSelection`、`reviewModelSelection`、`categorizeModelSelection` 等所有既有字段的存储结构、序列化、大部分调用点字面量都不用动——这些地方本来就要查 Profile 才能使用 `ModelSelection`，只是"怎么解读 tier"这一步要按 Profile 的 `apiFormat` 分支。

**排除的选项**：`{ tier } | { modelId }` 判别联合。类型上更安全，但要求改遍所有构造 `ModelSelection` 字面量的位置（十几处），且这些位置本就要先查 Profile 才能决定走哪条运行时，判别标签带来的收益有限，性价比不如直接放宽类型。

### 3. `pi/provider.ts`：按 `piWireApi` 路由协议 + 按模型 ID 查内置能力目录

- `resolvePiModel()`：pi 分支不再走 `tierMap[target.tier]` 固定映射，改为校验 `target.tier`（模型 ID）在 `profile.piModels` 中存在，直接取用作为 `modelId`。
- `buildPiModel()`：按 `profile.piWireApi` 决定 `Model.api` 是 `'anthropic-messages'` 还是 `'openai-responses'`；**按 `modelId` 查 pi-ai 内置模型目录**（`@earendil-works/pi-ai/providers/anthropic.models` 导出的 `ANTHROPIC_MODELS`、`.../openai.models` 导出的 `OPENAI_MODELS`）借用 `reasoning`/`thinkingLevelMap`/`contextWindow`/`maxTokens`——目录里 GPT-5 全系列已经带好推理能力元数据（如 `gpt-5: {thinkingLevelMap: {minimal,low,medium,high}}`），不用我们手工维护。查不到（自定义/第三方模型 ID，如 GLM 场景）回退现有硬编码保守值（`reasoning:false, contextWindow:200_000, maxTokens:8192`），完全兼容现状。
- `buildPiModels()`：按 `piWireApi` 选 `anthropicMessagesApi()` 或 `openAIResponsesApi()`（均为 pi-ai 提供的 `.lazy` 懒加载函数），`auth`/`baseUrl` 逻辑不变——两种协议的 Bearer Key 鉴权走同一套 `{ apiKey: { resolve } }` 形状。
- `resolvePiModel()` 返回值新增 `thinkingLevel: ThinkingLevel`，见下节。

### 4. 推理强度（`ai.effort`）透传进 pi 运行时

`AppSettings.ai.effort: 'low'|'medium'|'high'|'xhigh'|'max'|null` 与 pi 的 `ThinkingLevel: 'off'|'minimal'|'low'|'medium'|'high'|'xhigh'|'max'` 是子集关系，映射就是 `appSettings.ai.effort ?? 'off'`，不需要转换表。

- `resolvePiModel()` 内部算好 `thinkingLevel` 一并返回。
- `pi-session.ts`（主会话）：`Agent` 构造的 `initialState` 加 `thinkingLevel` 字段。
- `pi/run-once.ts`（后台任务）：`runOnce()` 新增可选参数 `thinkingLevel`（默认 `'off'`），塞进 `Agent` 的 `initialState`；四条后台任务 handler（`agent-worker.ts`）透传 `resolvePiModel(...).thinkingLevel`。
- 某档位是否对当前模型生效由 `Model.thinkingLevelMap` 决定（上一节查目录得到）；未命中目录的自定义模型 `reasoning:false`，thinkingLevel 预期被 pi 内部忽略（具体表现留到实施阶段手测确认）。
- 中途切模型（`setModel`）不需要重新计算 `thinkingLevel`——它是全局偏好，不随模型变化。

### 5. 设置页 UI（`app/settings/page.tsx`）

- "运行时格式"选 `pi` 时，原三个固定模型输入框替换为：上游协议下拉框（anthropic-messages / openai-responses）+ 模型清单管理区（已添加列表 + 删除按钮 + 添加输入框/按钮）。
- 选 `anthropic-sdk` 时界面不变。

### 6. `lib/model-selection.ts` + `components/ModelSelector.tsx`

- `dedupeProfileTiers()` 按 `profile.apiFormat` 分支：`pi` 遍历 `piModels ?? []`，每项 `{ tier: modelId, modelId }`（自映射，不做去重键计算）；`anthropic-sdk` 保持现有三档逻辑。函数签名不变，调用方无感。
- `ModelSelector.tsx` 的 `tierToModelKey`/`currentLabel` 按 `apiFormat` 分支：pi 路径直接用 `value.tier` 本身当显示文本（它就是模型 ID），不用查表；下拉菜单渲染部分因为 `dedupeProfileTiers` 已屏蔽差异，不用改。

## 模块边界

| 文件 | 改动 |
|---|---|
| `types/settings.ts` / `electron/main/services/settings-types.ts` | `ModelProfile` 加 `piWireApi`/`piModels`；`ModelSelection.tier` 类型放宽为 `string`；`isProfileComplete` 分支 |
| `electron/main/agents/pi/provider.ts` | `resolvePiModel`/`buildPiModel`/`buildPiModels` 按上述改造，新增目录查询辅助函数 |
| `electron/main/agents/pi-session/pi-session.ts` | `Agent` 初始化加 `thinkingLevel` |
| `electron/main/agents/pi/run-once.ts` | `runOnce()` 新增 `thinkingLevel` 参数 |
| `electron/main/agents/agent-worker.ts` | 四条后台任务调 `runOnce` 处透传 `thinkingLevel` |
| `app/settings/page.tsx` | Profile 编辑表单：pi 分支的上游协议下拉框 + 模型清单 CRUD |
| `lib/model-selection.ts` | `dedupeProfileTiers` 按 apiFormat 分支 |
| `components/ModelSelector.tsx` | `tierToModelKey`/`currentLabel` 按 apiFormat 分支 |
| `electron/main/services/settings-service.ts`（或同级新文件） | 启动时一次性迁移：`apiFormat==='pi' && !piModels?.length` 的 Profile，用旧 `haikuModel/sonnetModel/opusModel` 去重后种入 `piModels` |

## 数据流

设置页选择 pi Profile 的上游协议与模型清单 → 存入 `settings.json` → 会话/后台任务发起时按 `conversation.modelSelection`（或对应的 digest/review/categorize/subAgent modelSelection）查到 Profile → `resolvePiModel()` 按 `apiFormat`/`piWireApi` 解析出 `{ model, profile, thinkingLevel }` → `buildPiModels()` 建 pi Provider（协议 + baseUrl + apiKey）→ `Agent` 用该 model + thinkingLevel 跑起来，流式结果走现有 `ExtendedSessionMessage` 契约不变。

## 错误处理 / 边界情况

- **存量数据迁移**：已经把某 Profile 设过 `apiFormat: 'pi'` 但没有 `piModels` 的（哪怕当时没在用），启动时一次性把旧三档模型去重种进 `piModels`，避免这个 Profile 突然不可用。
- **`ModelSelection` 存量数据**：Profile 从 pi 切换协议/清单后，某个 `tier` 值可能不再存在于新的 `piModels` 里——沿用 `ModelSelector.tsx` 现有的"已删除的模型"兜底文案逻辑，不需要新写。
- **SDK 路径的 `tierMap` 查找**：`ModelSelection.tier` 类型放宽为 `string` 后，`agent-query-config.ts` 里 `tierMap[target.tier]`（`Record<ModelTier, string>`）的索引会有类型不匹配，需要按需做一次 `as ModelTier` 断言或运行时校验（理论上前端只会给 anthropic-sdk Profile 产出三档值，这里是类型层面的收尾，不是新增业务逻辑）。
- **推理档位 clamp**：某模型 `thinkingLevelMap` 里某档是 `null`（不支持）时 pi 内部如何处理（报错/静默降级），留到实施阶段手测验证，不阻塞设计。
- **`openai-completions`（legacy Chat Completions）**：本次不做，后续如果需要接入非 Responses API 的 OpenAI 兼容端点（如某些国产中转）再单独评估，`piWireApi` 的联合类型届时加一个值即可，是纯增量。

## 未决问题

- `thinkingLevelMap` 未覆盖档位时 pi-agent-core 的实际报错/降级行为，需要实施阶段用真实 GPT-5 Key 手测确认。
- 模型清单 UI 是否需要防重复添加同一模型 ID 的校验——倾向留给实施阶段按最小成本处理（`Set` 去重即可），不单独设计。
