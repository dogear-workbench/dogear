---
step: 3
title: 站点策略 + 工具层节奏预算
status: pending
---

## 目标

反风控约束从设计变成工具层硬实现：站点策略模块（小红书第一份）+ 随机延迟 + 单次会话预算 + 风控信号即停 + navigate 工具暴露 + 双链路引导。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-extension-tracking.md] navigate/代际/URL 跟踪已在扩展与 gateway 生效
- 当前关键文件状态：`extension-tools.ts`（293 行）四工具 + `ERROR_MESSAGES` 12+1 映射 + `emitAction`（source='extension'）；`browser-action-stream.ts`（94 行）动作账本；`settings-types.ts:258` 浏览器解析 Profile 描述
- 关键决策回顾：
  - 预算**单次会话级**（挂 conversationId，模块内 Map，无持久化无日级锁）；超限返回 `budget_exceeded` 语义文案（isError + 原因 + 已用量），用户可优化后继续（新会话或调参）
  - 风控信号即停：observe/read_text 返回内容匹配关键词 → `risk_signal_detected`（isError + 命中的信号词 + 「请人工检查浏览器页面」），**当次会话该域名后续命令全部前置拒绝**（内存标记，会话级）
  - 延迟参数保守取长（两份调研 2-5s vs ≥15s 不一致）：小红书默认操作间随机 15~45s、搜索间 30~90s、首次可加长
  - 站点策略不进 settings（代码级模块），默认值内置小红书；非配置域名走通用宽松策略（不延迟不预算，保持 P1 行为——受控浏览器场景不经过这里）

## 计划改动

- [ ] 新建 `electron/main/services/browser/site-policy.ts`：
  ```ts
  interface SitePolicy {
    matchOrigins: string[]            // 如 https://www.xiaohongshu.com
    delayMs: { min: number; max: number }        // 操作间
    searchDelayMs: { min: number; max: number }  // 搜索类导航前额外
    budget: { maxNotes: number; maxSearches: number }
    riskKeywords: string[]            // 滑块/验证码/频次异常/AI操作 初版清单
  }
  ```
  导出 `getSitePolicy(url): SitePolicy | null`；小红书策略内置
- [ ] `extension-tools.ts`：
  - 新工具 `dogear__extension__navigate`（参数 url；描述里写明「需目标域名已授权；小红书搜索可直达 `https://www.xiaohongshu.com/search_result?keyword=关键词`」）
  - 工具函数入口：命中 SitePolicy 的命令前注入随机延迟（`searchDelayMs` 对 navigate 到搜索 URL 生效）
  - 预算计数：navigate 计搜索数（搜索 URL 特征匹配）、read_text 计笔记数；超限返回结构化文案（含剩余额度与已用）
  - 风控检测：observe/read_text 结果文本过 `riskKeywords`；命中 → 会话级域名标记 + isError 返回
  - 双链路引导：四工具 + navigate 的描述各加一句「用户浏览器已连接且目标站需登录态时优先本工具组；公开网页读取用 dogear__browser__*」
- [ ] `browser-action-stream.ts`：action 记录加字段 `conversationId?`、`urlBefore?`、`urlAfter?`、`errorCode?`、`durationMs?`（预算与事后分析基础；emitAction 调用点补齐）
- [ ] `settings-types.ts` + 前端 `types/settings.ts`：浏览器解析 Profile 描述文案更新为「挂载扩展工具包在用户真实浏览器（登录态站点如小红书）执行只读调研，或用受控浏览器读取公开网页」——**只改默认描述字符串，normalize 对已有用户配置不覆盖**（实施时确认 normalize 逻辑只补缺省不覆写）
- [ ] 验证：node 直调工具函数（P1 step5 的 electron 假包 + loader hook 基建可复用）——延迟注入生效（耗时断言）、预算超限文案、风控关键词命中即停与后续拒绝、无策略域名行为不变

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
