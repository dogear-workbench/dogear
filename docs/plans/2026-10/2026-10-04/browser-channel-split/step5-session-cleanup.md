---
step: 5
title: 会话收尾自动清理
status: done
---

## 目标

agent 会话收尾时自动关闭 Dogear 组内「agent 持有且未移交」的 tab，移交用户的页面豁免。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step4-tab-adoption.md] 被动 tab 已自动入组（组内 tab = 会话全部痕迹），实施回填含焦点状态机结论
- 关键现状：
  - `electron/main/services/browser/extension-ownership.ts`：会话独占纯逻辑（同 owner 续期、空闲 10min 自动释放、busy 拒绝）；断连清零由 gateway 接线
  - `electron/main/services/browser/browser-gateway.ts`：close_tab 命令链路（pending map 生命周期）、ExtensionStatus 广播
  - 一键移交链路：`page_handoff` NM 帧 → gateway → 会话注入（design.md 数据流节）；移交中的 tab 目前无独立标记
  - extension-ownership 的会话粒度 = conversationId——清理范围天然按会话界定，但 tab 与会话的归属关系目前隐含在「组」上（多会话并发维持串行，一组）
- 关键决策回顾：简单版起步（组内全关 + 显式豁免清单）优于精确版（每 tab 移交标记）；design.md 未决问题 1/2 在本步拍板落地。

## 计划改动

- [x] 拍板「未移交」判定（实施时）：**已拍板——page_handoff 帧带 tabId 记入 gateway 内存豁免集合（上限 100 FIFO，跨扩展重连保留），组内非豁免 tab 全关（含焦点 tab）**。不采用「保留焦点 tab」变体：收尾时扩展侧焦点 = agent 工作 tab 而非用户正在看的页，保留它违背「整组消失」；Chrome 当前活动 tab 又可能根本不在组内，不可作为豁免依据。协议变更仅 page_handoff 帧加可选 tabId 字段（双侧同步），不 bump ProtocolVersion——旧版扩展发的帧无 tabId 自然不豁免，且旧扩展对 close_group_tabs 回 stale_protocol 后清理静默降级，重载扩展即自愈
- [x] 挂载点（实施时定位）：**已拍板——PiSessionManager._destroySession（会话销毁唯一收口，natural/forced 都触发；closeAll 应用退出路径不走本方法天然排除）**，在 session.close() 之后动态 import session-tab-cleanup fire-and-forget。门禁两层：扩展 connected + getChannelOwner() === conversationId（releaseChannel 现无调用方，owner 只在 acquire 成功换主或 resetChannel 变化，后者伴随 disconnected 被第一道门禁拦住，故任意时序下「多会话只清自己的、断连静默跳过」成立）
- [x] 清理实现：**新增批量 NM 命令 `close_group_tabs`（nm-protocol 双侧同步）**——扩展侧活查询组内 tab → 过滤豁免 → chrome.tabs.remove 批量关（try/catch 容错）→ 重查组算出真实 closedTabIds 回包；焦点 tab 被清则 clearFocusedTab（不做 fallback，会话已结束）。不用 close_tab 逐个关：逐个关会触发焦点回落抖动且 N 倍往返，批量一次往返语义干净
- [x] 动作流事件：BrowserActionType 新增 `cleanup`（BrowserPanel 图标 Eraser / 标签「清理」两个映射行），关数 > 0 时 emit（detail「收尾清理 N 个标签页」result 'closed'），0 关不发事件防噪音；断连/非归属者/协议过旧只落日志不进动作流
- [ ] 验证：真机——agent 开 tab 探索后会话结束，组内 tab 自动关闭；一键移交过的页面保留；扩展断连时会话结束不报错（无人值守环境以静态代码审查替代，见交付文档；真机步骤留主会话）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：①「未移交」判定选了豁免集合版而非「保留焦点 tab」版（理由见计划改动项结论）；②新增协议帧命令 close_group_tabs 而非复用 close_tab（焦点回落抖动 + N 倍往返，批量更干净，属双侧同步纪律允许范围）；③豁免集合不随断连清空（清空会导致重连后收尾误关已移交页，FIFO 限容 100 控制内存）；④应用退出（closeAll）不清理，遗留组由下次会话收尾自愈收割；⑤动作流类型新增 cleanup 而非复用 close_tab（账本可读，代价仅两个映射行，同 step3-read-state 先例）
- 改动文件清单：
  - `electron/main/services/browser/nm-protocol.ts`（CommandKind + CloseGroupTabsCommandParams + PageHandoffMessage.tabId）
  - `electron/main/services/browser/browser-gateway.ts`（豁免集合 + applyHandoff 记录 + applyCloseGroupTabsResult + 结果分支）
  - `electron/main/services/browser/extension-ownership.ts`（getChannelOwner）
  - `electron/main/services/browser/browser-action-stream.ts`（BrowserActionType + cleanup）
  - `electron/main/services/browser/session-tab-cleanup.ts`（新增：cleanupSessionTabs）
  - `electron/main/agents/pi-session/pi-session-manager.ts`（_destroySession 挂载）
  - `components/companion/BrowserPanel.tsx`（cleanup 图标/标签映射）
  - `extension/src/background.js`（page_handoff 帧带 tabId）
  - `extension/src/tab-commands.js`（closeGroupTabs + handleTabCommand 分支）

### 给下一步的接力棒
- 关键签名 / 数据结构：`cleanupSessionTabs(conversationId): void`（fire-and-forget，挂 _destroySession）；`getHandoffExemptTabIds(): number[]`（gateway 导出）；`getChannelOwner(): string | null`（ownership 导出）；NM 命令 `close_group_tabs { exemptTabIds? } → { closedTabIds }`；page_handoff 帧新增可选 tabId
- 下个 step 该从哪里继续：tab 生命周期闭环已完整（被动入组 → 上限 16 → 收尾清理），后续按 plan.md 顺序继续；若做扩展侧卸载/更新自愈或移交后 ungroup 优化，从豁免集合与 closeGroupTabs 入手
- 待办或已知限制：移交过的组内 tab 保留在组内（不 ungroup），下个会话 list_tabs 可见且计入 16 上限口径，agent close_tab 仍可关它（豁免只护自动清理）；应用退出不清组（自愈设计）；多会话串行共用一组，后继会话收尾会连前会话遗留一起收割（共享组模型的固有语义）
