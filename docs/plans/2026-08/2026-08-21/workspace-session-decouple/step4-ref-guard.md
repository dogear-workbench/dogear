---
step: 4
title: 临时态文件引用校验
status: done
---

## 目标

临时态（浏览工作区 B、焦点会话属于 A）下，从右栏（WorkspaceExplorer / AdditionalFilesPanel）引用文件/文件夹进焦点会话会路径错乱（agent 按会话自身 workspacePath 解析）。在两个引用入口加校验：被引用项所属工作区 ≠ 焦点会话工作区时 toast 拒绝。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-focus-linkage.md] 焦点联动就位；[step3-cross-ws-reference.md] 会话引用已支持跨工作区（本步只拦文件引用，会话引用不拦——它有 workspaceId 透传）
- 关键现状签名：
  - `components/WorkspaceExplorer.tsx:413`（文件夹引用）：`addReferencedFile({ name: originalNode.name, path: originalNode.path, type: 'folder' })` + toast 成功
  - `components/WorkspaceExplorer.tsx:422`（文件引用）：同上无 type
  - `components/AdditionalFilesPanel.tsx:256 / :306`：附加路径面板的引用调用（同样 toast「已引用」）
  - 判定数据源：右栏被引用项所属 = 全局 `useWorkspaceStore.workspace.id`；焦点会话所属 = `useSessionStore.getState().getTab(activeTabId)?.workspaceId`（activeTabId 为 `HOME_TAB_ID` 哨兵时 getTab 返回 undefined）
- 关键决策回顾：校验提示文案统一 `该文件属于其他工作区，无法引用到当前会话`；HOME tab 时焦点无会话 → 不拦（与现状一致，发送时本来也无目标）

## 计划改动

- [ ] 抽公共判定（建议放 `lib/utils.ts` 或两文件各内联，执行时按重复度取舍）：
  ```ts
  // 返回 true = 允许引用（焦点无会话或同工作区）
  function canReferenceIntoFocus(): boolean {
    const active = useSessionStore.getState().activeTabId;
    const tab = useSessionStore.getState().getTab(active ?? '');
    if (!tab) return true;
    return tab.workspaceId === useWorkspaceStore.getState().workspace?.id;
  }
  ```
- [ ] `components/WorkspaceExplorer.tsx:413 / :422`：引用动作前校验，不通过则 `toast.warning('无法引用', { description: '该文件属于其他工作区，无法引用到当前会话' })` 并 return
- [ ] `components/AdditionalFilesPanel.tsx:256 / :306`：同样校验
- [ ] `bun run lint` + 手动验证

## 验收清单

- [ ] 常态（焦点会话与浏览同工作区）：右栏引用文件/文件夹/附加路径 → 芯片正常（回归）
- [ ] 临时态（浏览 B、焦点 A）：右栏引用 → toast 拒绝、无芯片
- [ ] 首页 tab 激活时引用：行为与现状一致（不拦）
- [ ] 全链路终验：按设计文档「验收路径」四条全过一遍（A 跑任务→切 B→回、临时态引用会话、点 B 会话左右同步、关 B 点 A 回同步）

## 实施回填（做完后填）

### 实际改动
- 与计划差异（三点，零实质偏离）：
  1. 公共函数落点新建 `lib/reference-guard.ts` 而非 `lib/utils.ts`——utils.ts 是纯样式工具（仅 cn），塞 store/client 依赖会打破「lib 不依赖 stores」分层；3 处调用 + 异步查名 + toast 重复度又需要抽公共，独立小文件是干净折中
  2. AdditionalFilesPanel 实际只有一处调用点（计划写两处）：引用链路已重构为单一 onReference 回调汇合点，单点拦截全覆盖
  3. toast 按全局决策 6 附焦点工作区名（异步 client.getAll() 查，失败降级主文案）
- 改动文件清单：`lib/reference-guard.ts`（新建）、`components/WorkspaceExplorer.tsx`（文件/文件夹右键引用两处前置）、`components/AdditionalFilesPanel.tsx`（onReference 单点前置）
- 路径错乱机制（验收理解用）：WorkspaceExplorer 的 node.path 是相对路径，agent 按会话自身 workspacePath 解析 → 临时态 B 相对路径在 A cwd 解析错乱；AdditionalFilesPanel 是绝对路径但 A agent 可访问边界按工作区隔离（updateWorkspacePaths），B 附加路径不在内 → 访问被拒。两链路拦截语义均成立
- 边界记录（设计未覆盖，未扩大）：**文章引用（WorkspaceExplorer toggleReferenceArticle，:361 附近）不在 step4 计划列表未拦**，临时态同样有跨工作区风险，补拦只需一行 guard 前置，待用户决策；拒绝 toast 在 await getAll 后弹（约几十 ms 无感知）；焦点工作区已删除 → 降级主文案拦截行为不变

### 给下一步的接力棒
- 关键签名 / 数据结构：`guardReferenceIntoFocus(): boolean`——放行 true（HOME 无 tab / 同工作区），拦截 false + toast（异步查名附「（当前会话属于「X」）」）；调用方式 `if (!guardReferenceIntoFocus()) return;` 前置于 addReferencedFile
- 下个 step 该从哪里继续：本计划四个 step 全部完成，无后续 step；全链路终验（设计文档「验收路径」四条 + 回归三条）需重启应用人工执行
- 待办或已知限制：文章引用临时态未拦（见边界记录）；引用芯片 UI 无工作区徽标（设计「未来扩展」）；话题面板 currentGroupId 跨工作区 tab 时为 null（同）；sessionRestartTrigger 全局广播为存量行为未动；lint 0 errors / tsc 无新增错误 / 纯前端无需 build:electron
