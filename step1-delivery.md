# step 1: 主进程数据层与窗口解析链路

## 实际改动清单（文件 + 关键签名）

### `electron/main/services/settings-types.ts`
- `ModelProfile.piModels` 类型扩展：
  ```ts
  piModels?: Array<{ id: string; label?: string; contextWindow?: number }>;
  ```
  字段注释说明「contextWindow 为手填生效窗口，优先于目录查表」。

### `electron/main/services/settings-service.ts`
- `normalizePiModels(raw: unknown): Array<{ id: string; label?: string; contextWindow?: number }>`
  - 对象分支解析 `contextWindow`：仅 `typeof === 'number' && Number.isInteger && > 0` 才保留（0 / 负数 / 小数 / 字符串 / NaN / null 一律丢弃）
  - push 时按需组装字段（label / contextWindow 为 undefined 时不写入 key，JSON 保持干净）
  - 按 id 去重保首现顺序逻辑维持现状；文档注释同步更新

### `electron/main/agents/pi/provider.ts`
- `buildPiModel(profile: ModelProfile, entry: { id: string; label?: string; contextWindow?: number }): Model<Api>`
  - 签名由 `(profile, modelId, tierOrLabel)` 改为直接接收条目对象；`name: ${profile.name} / ${entry.label ?? entry.id}`
  - `contextWindow: entry.contextWindow ?? catalogEntry?.contextWindow ?? FALLBACK_CONTEXT_WINDOW`（全局决策的统一优先级）
- 调用点同步：
  - `resolvePiModel` 内 `buildPiModel(profile, matched)`（matched.id === target.tier，行为等价）
  - `buildPiModels` 内 `.map((m) => buildPiModel(profile, m))`
- 自动压缩阈值经 `pi-session.ts` 现有 `currentContextWindow = model.contextWindow` 自然继承，无需额外改动

### `electron/main/agents/pi-session/usage-extractor.ts`
- `extractPiContextSnapshot(message, turnIndex, resolveWindow?: (modelId: string) => number)`
- `extractPiUsageEntry(accum, turnMessages, turnIndex, fallbackModelId?, resolveWindow?: (modelId: string) => number)`
  - 两函数内部共 3 处 `lookupContextWindow(x) ?? 0` 改为经 `resolve = resolveWindow ?? ((id) => lookupContextWindow(id) ?? 0)` 调用
  - 未传 resolver 时行为与现状完全一致（SDK 历史导入 `services/usage/usage-extractor.ts` 不受影响，保持纯查表）

### `electron/main/agents/pi-session/pi-session.ts`
- 新增成员 `private manualWindows: Map<string, number>`（start() 时从 `profile.piModels` 提取，仅收 `typeof === 'number' && > 0` 的手填值）
- 新增私有方法：
  ```ts
  private resolveModelWindow(modelId: string): number {
    return this.manualWindows.get(modelId) ?? lookupContextWindow(modelId) ?? 0;
  }
  ```
- `start()` 内赋值 manualWindows；`handleAgentEvent` 的 `extractPiContextSnapshot` 调用（pi-session.ts:617）和 `emitUsageEntry` 的 `extractPiUsageEntry` 调用（pi-session.ts:729）均传 `(id) => this.resolveModelWindow(id)`

### `electron/main/services/settings-normalize.test.ts`
- 补 4 个 normalizePiModels 用例：
  - 正整数 contextWindow 保留
  - 0 / 负数 / 小数 / 字符串 / NaN / null 的 contextWindow 丢弃（条目本身保留）
  - label 与 contextWindow 共存；未手填时字段不写入
  - 按 id 去重时首现条目的 contextWindow 生效

## 与计划的差异

- 无实质差异。两处等价实现选择：
  1. `resolvePiModel` 原传 `(target.tier, matched.label ?? target.tier)`，因 `matched.id === target.tier`，改为直接传 `matched` 条目（计划给出的备选方案）
  2. usage-extractor 内 resolver 落地为函数顶部单次 `const resolve = ...` 而非三处内联 `(resolveWindow ?? (...))(x)`，语义相同、更可读

## 验证命令输出摘要

| 命令 | 结果 |
|------|------|
| `bun run build:electron` | ✅ tsc 0 error |
| `bun test electron/main/services/settings-normalize.test.ts` | ✅ 32 pass / 0 fail（含新增 4 例） |
| `bun test electron/main/agents` | ✅ 21 pass / 0 fail（现有测试不破） |
| `bun run lint` | ✅ 0 error（74 warning 全部位于存量 `types/` 文件；`electron/**` 在 eslint globalIgnores 中属存量配置） |

## 遗留问题

- 无本 step 遗留。下游注意点：
  - 渲染层 `types/settings.ts` 的 piModels 类型尚未同步加 `contextWindow`（属 step 2 渲染层 UI 范围）
  - 改 id 后存量对话 tier 存旧 id → 发消息走现有 throw「模型不在清单里」由用户重选（已拍板，无迁移）

## 给下一步的接力棒

- 关键签名：piModels 条目现为 `{ id: string; label?: string; contextWindow?: number }`（正整数才会在主进程读设置时保留）；`buildPiModel(profile, entry)` 接收整个条目对象
- step 2 从 `app/settings/page.tsx` 模型行 UI（ID 输入框 + 窗口徽标编辑）和 `lib/pi-model-catalog.ts` 的 `resolveModelWindow` / `parseContextInput` 继续，见 `step2-settings-ui.md`
- 主进程侧已就绪：手填值落 settings.json 后，provider 构造、usage 快照、usage 条目三处读取点均按「手填 > 目录 > 200K」解析
