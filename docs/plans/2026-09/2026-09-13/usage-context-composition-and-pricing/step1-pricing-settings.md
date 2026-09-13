---
step: 1
title: 价目表类型 + 设置 UI
status: done
---

## 目标
`piModels` 模型条目支持 `pricing`（元/百万 tokens），模型目录提供已知模型默认价，设置页 PiModelRow 可编辑覆盖。

## 依赖上下文（接力棒输入）
- 设计文档：`../../usage-context-composition-and-pricing-design.md` §2 价目表
- 现状：`types/settings.ts:22` `piModels?: Array<{ id: string; label?: string; contextWindow?: number }>`；`app/settings/pi-model-row.tsx:7` 有重复的本地 `PiModelEntry` 接口（两处都要加字段）
- 目录查表现状：`lib/pi-model-catalog.ts`（前端用，`lookupContextWindow` 等）；主进程另有一份 `electron/main/agents/pi/model-catalog.ts`（本步只改前端那份，主进程不算费用不动）

## 计划改动
- [x] `types/settings.ts:22` piModels 条目类型加 `pricing?: { input: number; output: number; cacheRead: number }`
- [x] `lib/pi-model-catalog.ts` 加 `lookupPricing(modelId): Pricing | undefined`，覆盖 glm-5.3 / glm-5.3-flash / deepseek-flash（别名 deepseek-v4.1-flash）/ deepseek-v4-pro（别名 deepseek-v4-pro-0813），id 匹配规则与现有 `lookupContextWindow` 一致（大小写/别名对齐现有条目，实施时核对）
- [x] `app/settings/pi-model-row.tsx`：PiModelEntry 加 pricing；行内加三个窄输入框（输入/输出/缓存命中），placeholder 显示目录默认价或「—」，非法输入不写入；空 = 清除手填（回落目录价）
- [x] `app/settings/page.tsx` 模型清单说明文案补一句「可填价格（元/百万 tokens）用于费用估算」

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. `lookupPricing` 匹配规则未照搬 `lookupContextWindow` 的纯精确匹配：实施核对发现 pi-ai 目录里没有 glm-5.3/glm-5.3-flash/deepseek-flash 条目（这些是用户手填 id），且用户 settings 实际存在 `deepseek-v4-flash`、`deepseek-v4-pro[1m]`（上下文变体后缀）。故采用小写归一 + 剥尾部 `[...]` 变体段 + 别名表（含计划外的 `deepseek-v4-flash` 别名，用户实际 id）；
  2. 越界必要配套：主进程 `settings-normalize`（settings-service.ts normalizePiModels）做字段白名单清洗，不保留 pricing 则设置页写入保存即丢，故同步改 `electron/main/services/settings-types.ts`（ModelPricing + piModels 条目）与 `settings-service.ts`（normalizePiModels 保留合法 pricing）并补 2 个测试用例（settings-normalize.test.ts）；
  3. 价格 UI 采用「徽标展示 + 点击展开三框编辑」模式（与既有窗口徽标交互一致），未用常驻输入框；部分填写时空字段自动填入目录价凑齐完整 pricing，目录也无该价时整体不写入回弹。
- 改动文件清单：
  - `types/settings.ts`：导出 `ModelPricing`；piModels 条目加 `pricing?`
  - `lib/pi-model-catalog.ts`：`MODEL_PRICING` 默认价表、`PRICING_ALIASES` 别名表、`canonicalPricingId()`（私有）、`lookupPricing(modelId)`
  - `app/settings/pi-model-row.tsx`：`PiModelEntry` 加 `pricing?`；`buildEntry` 加第 4 参；价格徽标 + 三框编辑态（draft/commit/Escape 取消，组内焦点切换不触发 commit）
  - `app/settings/page.tsx`：模型清单说明文案补价格说明
  - `electron/main/services/settings-types.ts` / `settings-service.ts`：主进程侧同步类型与 normalize 白名单
  - `electron/main/services/settings-normalize.test.ts`：补 pricing 保留/清洗用例

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `type ModelPricing = { input: number; output: number; cacheRead: number }`（元/百万 tokens），前端 `types/settings.ts` 与主进程 `settings-types.ts` 各一份（tsconfig 隔离）
  - `lookupPricing(modelId: string): ModelPricing | undefined`（lib/pi-model-catalog.ts）：小写 + 剥 `[...]` 后缀 + 别名表；`entry.pricing ?? lookupPricing(id)` 即生效价
  - settings 链路已通：前端写入 → normalizePiModels 保留合法 pricing → 落盘
- 下个 step 该从哪里继续：step 2/3 费用计算直接用 `entry.pricing ?? lookupPricing(modelId)`；需新建 `formatCost`（≥100 取整、≥1 两位小数、<1 三位小数、¥ 前缀），建议放 pricing-utils 或 usage-utils
- 待办或已知限制：
  - settings-normalize.test.ts 有 1 个与本次无关的既有失败：「缺失内置浏览器解析 Profile 时自动补齐」（期望 browser-parse enabledAbilities 不含 article，代码已含 article: true，测试未同步），stash 验证过非本次引入
  - 主进程 `electron/main/agents/pi/model-catalog.ts` 未加 pricing（主进程不算费用，按 step 计划不动）
