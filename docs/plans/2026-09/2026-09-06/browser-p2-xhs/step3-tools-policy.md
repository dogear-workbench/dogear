---
step: 3
title: 站点策略 + 工具层节奏预算
status: done
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

- [x] 新建 `electron/main/services/browser/site-policy.ts`：
  ```ts
  interface SitePolicy {
    matchOrigins: string[]            // 如 https://www.xiaohongshu.com
    delayMs: { min: number; max: number }        // 操作间
    searchDelayMs: { min: number; max: number }  // 搜索类导航前额外
    budget: { maxNotes: number; maxSearches: number }
    riskKeywords: string[]            // 滑块/验证码/频次异常/AI操作 初版清单
  }
  ```
  导出 `getSitePolicy(url): SitePolicy | null`；小红书策略内置（另加 searchUrlIncludes 搜索特征字段，供「navigate 计搜索数」与测试注入使用）
- [x] `extension-tools.ts`：
  - 新工具 `dogear__extension__navigate`（参数 url；描述里写明「需目标域名已授权；小红书搜索可直达 `https://www.xiaohongshu.com/search_result?keyword=关键词`」）
  - 工具函数入口：命中 SitePolicy 的命令前注入随机延迟（`searchDelayMs` 对 navigate 到搜索 URL 生效，替代 delayMs 而非叠加）
  - 预算计数：navigate 计搜索数（搜索 URL 特征匹配）、read_text 计笔记数（无 ref 计 1 篇，带 ref 分次读取不计）；超限返回结构化文案（含剩余额度与已用）
  - 风控检测：observe/read_text 结果文本过 `riskKeywords`；命中 → 会话级域名标记 + isError 返回
  - 双链路引导：SHARED_SCOPE_NOTE 加引导句（五工具共用）
- [x] `browser-action-stream.ts`：action 记录加字段 `conversationId?`、`urlBefore?`、`urlAfter?`、`errorCode?`、`durationMs?`（emitAction 调用点补齐；observe/read_text 的 emit 移到命令完成后统一记账）
- [x] `settings-types.ts` + 前端 `types/settings.ts`：浏览器解析 Profile 描述文案更新为「挂载扩展工具包在用户真实浏览器（登录态站点如小红书）执行只读调研，或用受控浏览器读取公开网页」——已确认 normalize 只在 id=browser-parse 缺失时 push 副本，已有用户配置不覆盖
- [x] 验证：node 直调工具函数（electron 假包 + loader hook 基建复用，另加「临时 dist 拷贝树 + pipe 常量替换 + 进程内假扩展端」实现协议半真链路）——延迟注入生效（耗时断言，registerSitePolicy 注入缩小测试策略）、预算超限文案、风控关键词命中即停与后续拒绝、无策略域名行为不变。详见共享区 step3-delivery.md

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - SitePolicy 接口比计划多一个 `searchUrlIncludes` 字段（搜索 URL 子串特征）：「navigate 计搜索数=搜索 URL 特征匹配」需要特征可配置，测试策略注入也依赖它
  - 搜索导航延迟为替代而非叠加（搜索用 searchDelayMs，不叠加 delayMs），避免 30~90s+15~45s 双重等待
  - read_text 笔记计数口径：无 ref（读正文容器）计 1 篇，带 ref 分次读取不计（长文分片不重复扣预算）
  - 计划中「延迟做在工具函数入口」落地为 policyGate / navigateGate 两个门控函数（风控前置拒绝 → 预算检查 → 延迟 → 命令）；失败/拒绝动作也全部记账，durationMs 只含命令耗时
  - 顺带修复 step1 caveat（navigation_blocked 非授权类 detail 走「无法导航：{detail}」）与 step2 接力棒（navigated_away / ref_expired 拼接 err.currentUrl）——均在计划授权范围内
- 改动文件清单：新增 electron/main/services/browser/site-policy.ts（131 行）、resources/browser-eval/site-policy-smoke.mjs（验证脚本）；修改 electron/main/agents/tools/extension-tools.ts（293→557 行）、electron/main/services/browser/browser-action-stream.ts（94→110 行）、electron/main/services/settings-types.ts、types/settings.ts。extension/ 与协议层零改动

### 给下一步的接力棒
- 关键签名 / 数据结构：见共享区 step3-delivery.md「关键签名 / 数据结构」段（SitePolicy 六字段、门控顺序、预算/风控 Map 结构、动作流 result 语义枚举）
- 下个 step 该从哪里继续：step4 真机验证。工具层逻辑已被 35 项脚本断言覆盖（含协议半真链路），真机重点：小红书域名 navigate→observe→read_text 实链路、延迟体感与预算文案、风控关键词对真实页面文案的误报排查、动作流字段在 UI 侧表现
- 待办或已知限制：预算值（20 笔记/5 搜索）与 riskKeywords 为初版拍板未真机调参；风控扫描受结果文本截断窗口限制（80 字/8000 字）；预算计数无去重（保守方向）；同机器发现非本会话的 `dogear-step3-*` 临时目录残留，step4 临时目录建议用更独特前缀
