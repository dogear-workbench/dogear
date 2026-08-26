---
step: 1
title: 引用解析修复
status: pending
---

## 目标

修复会话引用/文件夹引用不可见、共享文件引用 XML 裸露、跨工作区提示残留四个渲染 bug，只动解析端，旧消息向后兼容。

## 依赖上下文（接力棒输入）

- 发送端注入格式（`components/agent-chat/hooks/useSendMessage.ts`，**本步不改它**）：
  - 会话引用 :244-262：`<referenced_conversations><conversation title="..." conversationId="..." sessionId="..." workspaceId="..." /></referenced_conversations>`（workspaceId 可能不存在于旧消息；跨工作区时标签块后另起一段中文提示文本 :256-261）
  - 文件引用 :233-241：`<referenced_files><file name="..." path="..." />` 或 `<file name="..." path="..." type="folder" />`
  - 共享文件 :265-273：`<referenced_shared_files><shared_file group_id="..." rel_path="..." abs_path="..." /></referenced_shared_files>`
- 解析端现状（`components/agent-chat/utils.ts` `parseUserMessageReferences` :17-142）：
  - :70 conversation 正则只认 title/conversationId/sessionId → 带 workspaceId 的消息 0 匹配
  - :52 file 正则不认 type 属性
  - 无 shared_files 处理（外层 XML 也不剥，裸露正文）
  - 外层 `<referenced_conversations>` 等块在函数内被无条件 replace 剥掉（找到对应位置）
- 消费端：`MessageItem.tsx` :182-187 hasRefs、:203-241 芯片区（article/snippet/file/conversation 四类已存在，sharedFile 需新增；fileRefs 芯片按 type 显示文件夹图标）；`types.ts` :135-160 ParsedUserMessage。

## 计划改动

- [ ] `utils.ts`：conversation 正则加可选 `workspaceId` 捕获组；file 正则加可选 `type` 捕获组；新增 sharedFileRefs 解析（外层标签剥离 + 内层属性提取，属性全必填，缺属性跳过该条不剥外层防误伤）；识别跨工作区提示文本固定模式并剥离（参考 useSendMessage.ts:256-261 的生成文案，注意取稳定前缀做匹配，别整句硬编码）
- [ ] `types.ts`：ParsedUserMessage 加 `sharedFileRefs: Array<{groupId: string; relPath: string; absPath: string}>`；fileRefs 元素加 `type?: 'file' | 'folder'`；conversationRefs 元素加 `workspaceId?: string`
- [ ] `MessageItem.tsx`：hasRefs 加 sharedFileRefs；芯片区新增「共享文件 · relPath」只读芯片（无点击打开）；file 芯片 type==='folder' 时换 Folder 图标；conversation 芯片 workspaceId 存在且 ≠ 当前工作区时可加小徽标（可选，工作量小就做）

## 验证

1. 发一条带「引用会话 + 引用文件夹 + 引用普通文件 + 引用共享文件」的消息：四类芯片全部显示、正文无 XML 残留、无跨工作区提示文本
2. 翻历史旧消息：原本文件引用正常的仍正常；此前坏掉的会话引用消息刷新后芯片恢复
3. 跨工作区引用会话：芯片显示 + 正文干净

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
