---
step: 1
title: 主进程数据层与窗口解析链路
status: done
---

## 目标

piModels 条目支持手填 contextWindow 并穿透到主进程全部窗口读取点：provider 构造的 Model（自动压缩阈值来源）、usage 快照、usage 条目。

## 依赖上下文（接力棒输入）

- 设计文档：`docs/plans/2026-08/2026-08-15/pi-model-manual-window-edit-id-design.md`
- 当前关键文件状态：
  - `electron/main/services/settings-types.ts:29` — `piModels?: Array<{ id: string; label?: string }>`
  - `electron/main/services/settings-service.ts:77` — `normalizePiModels(raw)` 白名单只留 id/label，**必须放行 contextWindow 否则每次启动读设置时手填值被洗掉**
  - `electron/main/agents/pi/provider.ts:44` — `buildPiModel(profile, modelId, tierOrLabel)`，:52 `contextWindow: catalogEntry?.contextWindow ?? FALLBACK_CONTEXT_WINDOW`；调用点 `resolvePiModel`（:73 find 出 matched 后 :79 传 `target.tier, matched.label ?? target.tier`）和 `buildPiModels`（:90 `map((m) => buildPiModel(profile, m.id, m.label ?? m.id))`）
  - `electron/main/agents/pi-session/usage-extractor.ts` — 窗口语义调用点三处：`extractPiContextSnapshot`（:71，ContextSnapshot.maxTokens 实为窗口值，进度百分比用）、`extractPiUsageEntry` 的 :154 和 :167（modelUsage 条目 contextWindow）
  - `electron/main/agents/pi-session/pi-session.ts` — profile 是 `initialize()` 局部变量（:323 resolvePiModel 解构），**不长期持有**；`emitUsageEntry`（:703）调 `extractPiUsageEntry`；`extractPiContextSnapshot` 的调用点在本文件内 grep 定位
- 关键决策回顾：usage 提取加可选 resolver 参数而非全局注册——默认行为与现状完全一致，SDK 历史导入（`services/usage/usage-extractor.ts`）无 profile 上下文保持纯查表

## 计划改动

- [x] `electron/main/services/settings-types.ts:29` — piModels 条目类型加 `contextWindow?: number`，注释说明「手填生效窗口，优先于目录查表」
- [x] `electron/main/services/settings-service.ts` normalizePiModels — 对象分支解析 `contextWindow`：正整数（`Number.isInteger(v) && v > 0`）才保留；push 时组装 `{ id, label?, contextWindow? }`（undefined 字段不写入，保持 JSON 干净）
- [x] `electron/main/agents/pi/provider.ts` — `buildPiModel` 签名改为 `(profile, entry: { id: string; label?: string; contextWindow?: number }, tierOrLabel?)`（或直接用条目替代 label 参数，name 字段用 `entry.label ?? entry.id`）；contextWindow 改 `entry.contextWindow ?? catalogEntry?.contextWindow ?? FALLBACK_CONTEXT_WINDOW`；resolvePiModel/buildPiModels 两处调用同步
- [x] `electron/main/agents/pi-session/usage-extractor.ts` — `extractPiContextSnapshot` 与 `extractPiUsageEntry` 各加末位可选参数 `resolveWindow?: (modelId: string) => number`，内部三处 `lookupContextWindow(x) ?? 0` 换成 `(resolveWindow ?? ((id) => lookupContextWindow(id) ?? 0))(x)`
- [x] `electron/main/agents/pi-session/pi-session.ts` — initialize 时从 profile.piModels 建手填窗口 `Map<string, number>` 存成员（如 `this.manualWindows`）；emitUsageEntry 及 extractPiContextSnapshot 调用点传 resolver `(id) => this.manualWindows.get(id) ?? lookupContextWindow(id) ?? 0`
- [x] `electron/main/services/settings-normalize.test.ts` — 补 normalizePiModels 用例：正整数保留；0 / 负数 / 小数 / 字符串 / NaN 丢弃；label 与 contextWindow 共存；去重时首现条目的 contextWindow 生效

## 验证

- `bun run build:electron` 0 error
- `bun test electron/main/services/settings-normalize.test.ts` 全过
- `bun test electron/main/agents` 现有测试不破（usage-extractor 无独立测试文件，靠 build + 引用点编译验证）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无实质差异。两处等价实现：resolvePiModel 直接传 `matched` 条目（matched.id === target.tier）；resolver 落地为函数顶部 `const resolve = ...` 而非三处内联。详见 `step1-delivery.md`
- 改动文件清单：settings-types.ts / settings-service.ts / pi/provider.ts / pi-session/usage-extractor.ts / pi-session/pi-session.ts / settings-normalize.test.ts

### 给下一步的接力棒
- 关键签名 / 数据结构：piModels 条目 `{ id, label?, contextWindow? }`；`buildPiModel(profile, entry)`；`extractPiContextSnapshot(msg, turn, resolveWindow?)` / `extractPiUsageEntry(accum, msgs, turn, fallback?, resolveWindow?)`
- 下个 step 该从哪里继续：`app/settings/page.tsx` 模型行 UI + `lib/pi-model-catalog.ts` 的 resolveModelWindow/parseContextInput（见 step2-settings-ui.md）
- 待办或已知限制：渲染层 types/settings.ts 的 piModels 类型未同步（属 step 2）；改 id 后存量对话 tier 存旧 id 走现有 throw 由用户重选（已拍板）
