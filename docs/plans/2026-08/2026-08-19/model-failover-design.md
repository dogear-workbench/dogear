# 模型故障转移（Failover）设计

**日期**：2026-08-19
**状态**：已拍板，待实施计划

## 背景

调度站（2026-08-18）已实现子会话 quota 错误沿 `subAgent.profiles` 降级，但存在两个缺口：

1. **主会话自身无保护**：主/子会话通常同供应商，quota（限流/余额）发生时子会话能自动降级复活，主会话却直接报错停摆——而主会话是决策层，它挂了子会话的终态通知、`dogear__ResumeSession`、重派决策全部无人执行，调度站闭环断裂。
2. **子会话降级链实际为空**：生产环境 `subAgent.profiles`（默认/探索/股票）全部指向 GLM，`findFallbackModel` 找不到异供应商，quota 直接走「无可降级」通知。用户实际配置了三家供应商（GLM / DeepSeek / proma），但链没有串起来。

用户需求（付款队列类比）：任何会话（主/子）出现费率类错误时，自动顺位切换到下一家供应商的模型继续跑，全程无人值守。

## 目标

- **quota 类错误全自动切换续跑**：主会话与子会话统一行为——检测到费率错误 → 沿用户配置的降级链顺位切换供应商 → 从断点继续（不重跑、不重复副作用）
- **设置页显式配置降级链**：以供应商为单位的有序列表，每家选一个代表模型；总开关控制自动切换
- **链耗尽才停**：整条链都试过仍 quota 才判定失败，主会话聊天流报错、子会话终态通知

## 架构

### 拍板决策

| 决策 | 内容 | 理由 |
|---|---|---|
| 交互形态 | 全自动续跑 + 聊天流系统提示告知切换 | 场景是全权交给 agent 无人值守；切换是会话级且透明，可手动改回 |
| 链数据源 | 设置页显式配置的全局 failover 链（主/子共用一套） | 用户拍板；顺带解决 subAgent.profiles 全同供应商顺不出去的问题 |
| 链粒度 | 每家供应商一条，选一个模型 | 「多个模型也没用，按照供应商来的」——费率是供应商账户级的 |
| 触发范围 | 仅 quota 类（429/rate limit/quota/insufficient/balance/余额/限流/额度） | transient 主会话自动重发有重复副作用风险且人通常在场，收益低 |
| 切换持久性 | 会话级 `modelSelection` 改后保持，**不自动切回** | quota 恢复探测复杂（YAGNI）；用户可在模型选择器手动改回 |
| 子会话旧链语义 | 废弃「subAgent.profiles 顺序即降级链」，quota 分支改走全局链 | 主子一套逻辑；subAgent profile 回归纯功能配置（工具/超时） |
| 续跑方式 | 断点续跑（fire-and-forget 续跑提示），复用 resumeChild 模式 | 已验证：updateModelSelection → detach 销毁旧 session → attach 以新模型重建（attach 复用分支不重读 modelSelection 的坑已绕开）→ 历史在 harness 续跑 |

### 排除的选项

- **主会话 transient 自动重试**：交互场景人通常在场；整轮重发有副作用风险
- **自动切回原供应商**：需要探测 quota 恢复，复杂度高收益存疑
- **主/子两套链**：配置割裂，两处维护
- **隐式按顶层 profiles 顺序降级**：不可见不可控，改为显式链配置

## 模块边界

### 设置层

- `electron/main/services/settings-types.ts`：`AppSettings.failover?: { enabled: boolean; chain: FailoverEntry[] }`，`FailoverEntry = { profileId: string; tier: string }`；normalize 纯函数
- `electron/main/services/settings-service.ts`：normalize 挂点——新增供应商追加链尾（tier 取该家 piModels 首个）、删除供应商移出链、tier 失效回退该家首个模型
- `types/settings.ts`：前端镜像类型同步

### Failover 核心逻辑（新模块，主子共用）

- 新 `electron/main/agents/model-failover.ts`：纯逻辑——链查找 `findNextFailover(chain, currentProfileId, tried)`（顺位下一个；当前不在链则链头进；tried 内跳过；空则耗尽）、续跑提示词构造

### 主会话路径

- 监听层：`electron/main/tipc/agent.ts` 的 broadcaster `complete` 分支（已统一拿到 sessionId + result + role 区分）或 pi-session-manager——具体挂点实施时定
- 编排：quota 且 `failover.enabled` 且链有下一个 → `updateModelSelection` → detach/attach 重建 session → 发续跑提示 → 广播系统提示给前端

### 子会话路径

- `electron/main/agents/delegation-bridge.ts` `decideResume`：quota 分支从 `findFallbackModel(subAgent.profiles, …)` 改为走全局链
- `electron/main/agents/delegation-resume.ts`：`findFallbackModel` 废弃或改造为薄封装
- `modelTried` 落盘机制保留（防回摆 + 通知文案「已降级尝试 A → B」数据源）

### 前端

- `app/settings/page.tsx`：「模型故障转移」区块——总开关 + 链列表（供应商名 + 模型下拉取 `piModels` + 排序）+ 链耗尽行为说明文案
- 聊天流：切换发生时插系统提示条（「GLM 费率受限，已自动切换 DeepSeek 继续」），样式复用现有系统消息机制，实施时定

## 数据流（主会话 quota 全链路）

1. PiSession turn failed，`error.message` 命中 quota 关键词（复用 `isQuotaErrorMessage`）
2. 校验：`failover.enabled` 且 role='main' 且非用户 cancelled
3. `findNextFailover(chain, 当前 profileId, failoverTried)` → 下一家 `{profileId, tier}`；无 → 报错停止
4. `conversationService.updateModelSelection` + detach 旧 attachment（refCount 归零销毁）→ attach 重建（新模型生效）
5. fire-and-forget `session.sendMessage(续跑提示)`（「你因供应商费率限制中断，模型已切换，请检查已完成部分继续」）
6. 广播前端系统提示条；`failoverTried` 累积当前供应商
7. 新模型再 quota → 回到 1；整链耗尽 → 聊天流报错停止

子会话同构，差异：走 `settleTerminal` → `resumeChild`（已有编排，仅换模型来源），耗尽走终态通知。

## 错误处理 / 边界

- **cancelled 不触发**（用户手动停止尊重原意）
- **WaitForMessage 挂起中的主会话**：turn 失败同样 failover；续跑提示发出后，queued 的子会话通知在下一轮收到，链路自然衔接
- **多会话同时 quota**：各自独立切换（会切到同一家，正常）
- **开关关闭**：回到现状（主会话报错停、子会话 quota 直接终态通知）
- **re-attach 竞态**：切换期间用户手动发消息/切模型——续跑提示发出前的窗口极小，消息进现有排队机制；实施时验证
- **failoverTried 生命周期**：per-conversation 内存级（主会话 turn 失败即处理，无跨重启需求）；子会话沿用 `modelTried` 落盘
- **链中只剩当前供应商一家**：等价耗尽（无可切换）

## 未决问题（实施时定）

- failover 监听挂点最终选型（broadcaster vs pi-session-manager vs runtime-service 编排归属）
- 系统提示条 UI 形态（复用 system message 样式或独立 banner 组件）
- 设置页排序控件（上移/下移按钮 vs 拖拽）
- quota 关键词表是否与 `QUOTA_ERROR_KEYWORDS` 完全共用（应共用，确认无遗漏）
