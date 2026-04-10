---
paths:
  - "components/agent-chat/**/*.tsx"
  - "stores/reference-store.ts"
---

# 消息引用和历史对话引用规则

## 支持的引用类型

### 1. 文章引用（网络文章）
- XML 格式：`<referenced_articles><article title="..." articleId="..." site="..." /></referenced_articles>`
- 来源：ArticlePreview 选中文字浮动按钮
- 输入框芯片颜色：灰色/中性
- 使用场景：引用网络文章内容进行讨论

### 2. 历史对话引用
- XML 格式：`<referenced_articles><article title="..." articleId="..." source_type="session" /></referenced_articles>`
- 关键字段：`source_type="session"` 标记为历史对话
- 来源：AgentChat hover/右键菜单，旧对话悬浮预览或直接引用
- 输入框芯片颜色：紫色（视觉区分）
- 使用场景：引用之前的对话上下文

### 3. 段落/片段引用
- XML 格式：`<quoted_snippet source="来源标题">引用文本</quoted_snippet>`
- 支持多个片段（可重复使用该标签）
- 来源：ArticlePreview 选中文字
- 使用场景：精确引用文章中的文本片段

## 消息构建规范

### 单内容块（纯文本）
```typescript
{
  type: "text",
  text: "用户输入的文本"
}
```

### 多内容块（含引用）
```typescript
[
  {
    type: "text",
    text: '<referenced_articles><article title="对话标题" articleId="conv-uuid" source_type="session" /></referenced_articles>'
  },
  {
    type: "text",
    text: '<quoted_snippet source="标题">引用的文本片段</quoted_snippet>'
  },
  {
    type: "text",
    text: "用户实际输入的内容"
  }
]
```

**重要**：用户输入必须放在最后一个 block，前面的 block 是各类引用标签。

## 前端处理流程

1. **引用采集**（reference-store.ts）
   - 用户在 ArticlePreview 中选中文字或在聊天中右键历史消息
   - store 收集 articleId/title/site 等元信息

2. **输入框显示**（ChatInputArea）
   - 引用显示为可交互芯片（chip）
   - 点击可移除引用
   - 紫色芯片 = 历史对话
   - 灰色芯片 = 文章

3. **消息发送**（useSendMessage.ts）
   - 遍历 reference-store 中的引用列表
   - 构建 XML 标签
   - 加入 content blocks
   - 最后拼接用户输入

4. **消息渲染**（MessageItem / ContentBlockItem）
   - 解析 XML 标签（通过正则或 XML parser）
   - 引用文本不可编辑
   - 编辑重发时保留引用标签

## 后端兼容性

- SDK query() 接受 content blocks 数组
- 每个 block 独立传输，SDK 合并处理
- 引用标签以纯文本形式发送到 Claude API
- Claude 上下文中显示完整的引用信息

## 常见坑点

1. **chip 移除后要同步 store**
   - 需要调用 reference-store 的 remove/clear action

2. **编辑重发时引用丢失**
   - 使用 useSendMessage 的 editMessage 而非重新输入
   - 旧消息的引用标签应从历史记录恢复

3. **多个相同类型引用**
   - 使用多个 `<article>` 标签或多个 `<quoted_snippet>` 标签
   - 不要试图合并成一个标签

4. **source_type 字段**
   - 仅用于历史对话引用标记
   - 网络文章不需要此字段
   - 助力后端区分来源类型