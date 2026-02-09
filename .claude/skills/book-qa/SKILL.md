---
name: book-qa
description: Use when user asks questions about specific book content, requires evidence-based answers with citations, or mentions specific books/chapters/reading materials
---

# Book QA - 书籍问答助手

## Overview

**Core principle:** 永远基于书籍原文回答，绝不使用训练数据猜测。

Every answer must be backed by:
1. A tool search call first
2. A citation to the specific chapter
3. Explicit "not found" statement if absent

## Red Flags - 立即停止并搜索

在以下想法出现时，立即停止，调用 SearchBookContent：

| 你的想法 | 实际情况 |
|---------|---------|
| "这本书很著名，我知道答案" | 训练数据可能过时或错误 |
| "用户只是想要快速回答" | 错误答案比慢答案更糟糕 |
| "搜索可能找不到" | 找不到比编造好 |
| "这段很显然" | 显然≠准确，必须验证 |
| "我可以补充一点背景" | 用户问的是书中的内容，不是你的知识 |

**所有这些想法都意味着：立即搜索，不要"直接回答"。**

## When to Use

```
用户提到书籍/章节/阅读材料
    │
    ├─ 是 → 使用此技能
    │
    └─ 否 → 通用回答模式
```

## Rationalization Table

| 借口 | 真相 |
|------|------|
| "这本书是经典，内容众所周知" | 不同版本/译本内容不同 |
| "节省用户时间，直接回答" | 错误信息浪费时间更多 |
| "搜索结果可能不相关" | 搜索不到≠可以编造 |
| "用户只是想要大致了解" | 大致了解也需要基于原文 |
| "我可以标注这是我的补充" | 补充内容会混淆用户判断 |

## 必须遵守的规则

### Rule 1: 搜索优先原则

```
收到问题 → 搜索书籍 → 基于结果回答
     ↓
  绝不跳过搜索直接回答
```

### Rule 2: 诚实面对未知

```
搜索无结果
    ↓
明确说明"书中没有提到..."
    ↓
绝不用"可能"、"应该"等模糊词
```

### Rule 3: 引用必须准确

```
[章节标题] 或 [章节标题:位置范围]
    ↓
绝不使用"前面章节"、"某处"等模糊表述
```

## Tool Usage

### SearchBookContent（必需）

**何时使用：** 每次回答问题前

**参数：**
- `bookId`: 从上下文获取
- `query`: 从问题中提取 2-5 个关键词
- `searchMode`: "summary"（首选）或 "full"
- `maxResults`: 5

### GetCitationContext（可选）

**何时使用：** 需要查看完整原文时

**参数：**
- `bookId`: 书籍 ID
- `chapterId`: 从搜索结果获取
- `position`: 可选位置范围

### RequestMoreInfo（可选）

**何时使用：** 两次搜索都无结果时

**参数：**
- `reason`: 未找到的原因
- `searchedKeywords`: 已搜索的关键词
- `suggestions`: 建议用户提供的信息

## Quick Reference

| 问题类型 | 操作 |
|---------|------|
| "书中有讲X吗？" | SearchBookContent → 有/无明确说明 |
| "详细解释Y" | SearchBookContent → GetCitationContext → 详细回答 |
| "谁/在哪里/什么时候" | SearchBookContent → 直接答案+引用 |
| "这本书讲了什么" | GetBookInfo → 概述 |

## 回答格式

### 找到内容时

```markdown
基于书籍原文，[答案内容] [章节标题]。

[补充说明，如有] [其他章节]。
```

### 找不到内容时

```markdown
很抱歉，搜索了所有章节后，没有找到与"[主题]"相关的内容。

**已搜索关键词：** [关键词列表]

这本书主要讲述的是...[基于 GetBookInfo 的概述]
```

## Common Mistakes

| 错误 | 正确做法 |
|------|---------|
| 直接回答，不搜索 | 先调用 SearchBookContent |
| 说"可能"、"应该" | 明确说"书中提到"或"没有提到" |
| 用训练数据补充 | 只基于原文回答 |
| 模糊标注来源 | 精确到章节标题 |
| 找不到时猜测 | 明确说明未找到 |

## 详细文档

- [WORKFLOW.md](WORKFLOW.md) - 完整工作流程和决策树
- [CONSTRAINTS.md](CONSTRAINTS.md) - 约束规则详解
- [TEMPLATES.md](TEMPLATES.md) - 回答模板示例