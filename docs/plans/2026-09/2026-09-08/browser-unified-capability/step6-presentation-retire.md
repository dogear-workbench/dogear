---
step: 6
title: 呈现交付与退役
status: pending
---

## 目标

agent→用户的页面呈现（companion 面板挂 WebContentsView）、awaiting_human 状态机产品化（登录/验证暂停-恢复闭环）、Patchright 彻底退役删除。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1] attach/detach 接口、[step3] page-state 判定、[step5] NM 收尾已完成，签名从前置回填
- 现状代码：`components/companion/BrowserPanel.tsx`（动作流展示，`browser-action-stream.ts`）、companion 窗口管理（执行时定位）、`browser-manager.ts`（364 行，Patchright，待删）
- 关键决策回顾：呈现是「agent→用户的交付」——页面本身就是产物；awaiting_human 不是错误是可交互任务状态；activeTabId（用户看的）/ agentTabId（agent 操作的）分离在此步落地

## 计划改动

- [ ] 呈现层：embedded-browser-manager 的 attach 能力接到 companion 窗口——BrowserPanel 增加「页面视图」区（tab 列表 + 当前呈现 tab 的 WebContentsView attach/detach 切换）；用户切走 tab 视图不干扰 agent 操作目标（activeTabId/agentTabId 分离生效）
- [ ] awaiting_human 产品化：pageState=login_required/verification_required 或 guard_submit 触发时，动作流中产生「等待人工」卡片（原因 + 当前页面 + 「完成后继续」按钮）；恢复路径：用户点击或 wait_for 检测到状态变化 → agent 继续当前任务；数据结构 `HumanInterventionRequest { id, tabId, reason, message, createdAt }` 存内存即可（不持久化）
- [ ] agent→用户交付工具：`dogear__browser__present`（参数 tabId 或 url）——把页面 attach 到 companion 前台呈现，作为任务交付物的一种（页面即产物）
- [ ] Patchright 退役：删除 `browser-manager.ts` 及其调用链（playwright/patchright 依赖从 package.json 移除）；确认无残留 import；受控浏览器窗口相关 UI 入口清理
- [ ] 浏览器 Profile 文档更新：agent 浏览器工具描述按新协议统一重写（快档 + 原子工具 + 探索循环 + awaiting_human 语义），站点档案方法论保留衔接
- [ ] `docs/codebase-map.md` 同步（doc-sync）
- [ ] 全链路验收清单：内嵌搜索（成功/parse_empty 降级/验证页暂停恢复）、扩展连接 tab 操作、readArticle、present 呈现、Patchright 删除后全工具回归

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
