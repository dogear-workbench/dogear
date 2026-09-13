---
step: 1
title: 价目表类型 + 设置 UI
status: pending
---

## 目标
`piModels` 模型条目支持 `pricing`（元/百万 tokens），模型目录提供已知模型默认价，设置页 PiModelRow 可编辑覆盖。

## 依赖上下文（接力棒输入）
- 设计文档：`../../usage-context-composition-and-pricing-design.md` §2 价目表
- 现状：`types/settings.ts:22` `piModels?: Array<{ id: string; label?: string; contextWindow?: number }>`；`app/settings/pi-model-row.tsx:7` 有重复的本地 `PiModelEntry` 接口（两处都要加字段）
- 目录查表现状：`lib/pi-model-catalog.ts`（前端用，`lookupContextWindow` 等）；主进程另有一份 `electron/main/agents/pi/model-catalog.ts`（本步只改前端那份，主进程不算费用不动）

## 计划改动
- [ ] `types/settings.ts:22` piModels 条目类型加 `pricing?: { input: number; output: number; cacheRead: number }`
- [ ] `lib/pi-model-catalog.ts` 加 `lookupPricing(modelId): Pricing | undefined`，覆盖 glm-5.3 / glm-5.3-flash / deepseek-flash（别名 deepseek-v4.1-flash）/ deepseek-v4-pro（别名 deepseek-v4-pro-0813），id 匹配规则与现有 `lookupContextWindow` 一致（大小写/别名对齐现有条目，实施时核对）
- [ ] `app/settings/pi-model-row.tsx`：PiModelEntry 加 pricing；行内加三个窄输入框（输入/输出/缓存命中），placeholder 显示目录默认价或「—」，非法输入不写入；空 = 清除手填（回落目录价）
- [ ] `app/settings/page.tsx` 模型清单说明文案补一句「可填价格（元/百万 tokens）用于费用估算」

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
