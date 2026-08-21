---
step: 4
title: 临时态文件引用校验
status: pending
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
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
