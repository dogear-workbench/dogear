---
step: 5
title: 会话收尾自动清理
status: pending
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

- [ ] 拍板「未移交」判定（实施时）：倾向——handoff 已发送过 page_handoff 的 tabId 记入豁免集合（内存态，随 gateway 生命周期）；或更简版：会话收尾直接关组内全部 tab（当前移交场景多为「用户正在看的页面=活动 tab」，收尾不动 focusedTab，仅关非焦点 tab）——按真机行为选简单且不误伤的方案，结论写回本节
- [ ] 挂载点（实施时定位）：PiSession close 链 / extension-ownership 释放链（releaseChannel 时机）/ gateway 断连——多会话并发下只清自己的，且扩展断连时静默跳过（无通道可清）
- [ ] 清理实现：新增 NM 命令或复用 close_tab 逐个关（list_tabs → 过滤豁免 → close）；批量原子命令 `close_group_tabs` 更干净则走 nm-protocol 双侧同步（帧协议双侧同步纪律）
- [ ] 动作流事件：清理动作 emit browser-action（面板可见「收尾清理 N 个标签页」），不静默
- [ ] 验证：真机——agent 开 tab 探索后会话结束，组内 tab 自动关闭；一键移交过的页面保留；扩展断连时会话结束不报错

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
