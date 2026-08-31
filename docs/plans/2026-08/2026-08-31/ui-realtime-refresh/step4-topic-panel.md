---
step: 4
title: TopicPanel 写点广播
status: pending
---

## 目标

agent 写共享区文件 / 话题背景 / 组卡提炼完成后 TopicPanel 自动刷新；前端删 refreshKey 本地机制统一事件回环。

## 依赖上下文（接力棒输入）

- 设计决策：见 [../ui-realtime-refresh-design.md](../ui-realtime-refresh-design.md) 决策 3
- 现状（盘点报告总表 3/4 行）：TopicPanel.tsx:61-88 单 useEffect 依赖 `[workspaceId, groupId, refreshKey]` 拉 listSharedFiles / readGroupBackground / readGroupDigest 三份数据；refreshKey 仅 handleDeleteFile 成功后 +1（TopicPanel.tsx:131）；无事件无轮询
- 三个写点全是「前端 tipc 路由 + agent 工具」双调用方，写点广播天然全覆盖
- 面板纯只读展示，无编辑态；共享文件浮窗（MarkdownFileDialog）打开时重拉列表不影响浮窗内容——刷新零风险

## 计划改动

- [ ] `electron/main/tipc/renderer-handlers.ts` 加 `groupDataChanged` 事件类型，负载 `{ workspaceId, groupId }`
- [ ] 三个写点接线（每个 store 内加小 helper 或直接内联广播，跟随 Step 1 的 conversation-broadcast 风格）：
  - `group-shared-service.ts` writeNativeFile（:73）/ deleteNativeFile（:80）——覆盖 agent dogear__SaveSharedNote（group-tools.ts:70）与前端 tipc/group.ts:161/174
  - `memory/background-store.ts` saveGroupBackground（:84）
  - `memory/group-digest-store.ts` writeGroupDigest（:217）——覆盖组卡提炼完成（agent dogear__SaveGroupDigest）与数据中心单组重跑
- [ ] `components/TopicPanel.tsx`：
  - 订阅 groupDataChanged，`workspaceId === 当前 && groupId === 当前组` 时重拉三份数据（复用现有 useEffect 的加载函数，refreshKey 从依赖里去掉或置常量）
  - 删 refreshKey state 与 handleDeleteFile 里的 +1 逻辑（删除成功走事件回环刷新）
- [ ] `bun run build:electron` + `bun run lint`

## 验证

- 主会话（焦点组 == TopicPanel 当前展示组）让 agent 调 dogear__SaveSharedNote 写文件：面板共享文件列表自动出现新条目，滚动位置不跳
- TopicPanel 打开某组，数据中心对该组「重新提炼」完成：组卡预览自动更新（不再只弹 toast）
- 前端删除共享文件：列表自动移除（原 refreshKey 路径退役）
- 展示 A 组时 B 组后台写入：面板不刷新（负载过滤生效）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- groupDataChanged 广播出口位置与签名：
- 下个 step 该从哪里继续：
- 待办或已知限制：
