# 书籍问答 Skill 实现计划

## 概述

使用 Claude Agent SDK 的 **Skill 机制** 创建一个严格的书籍问答助手，实现：
- 基于原文证据回答（减少幻觉）
- 标注引用来源（章节、位置）
- 找不到时诚实说明（请求用户提供更多信息）

## 架构设计

### 分层协作

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户问题                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Skill 层（指导与约束）                                            │
│  - 第1级：YAML frontmatter（始终加载，~100 tokens）              │
│  - 第2级：SKILL.md 主体（触发时加载，~5k tokens）                 │
│  - 第3级：辅助文档和脚本（按需通过 bash 加载）                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  MCP 工具层（执行能力）                                            │
│  - SearchBookContent：智能搜索书籍内容                            │
│  - GetCitationContext：获取引用上下文                             │
│  - RequestMoreInfo：请求更多信息（安全出口）                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  数据层                                                            │
│  - 数据库：章节内容                                               │
│  - 文件系统：.dogear/（分析结果、章节摘要）                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 实现步骤

### 步骤 1：创建 Skill 目录结构

**根据官网说明，Skill 需要放在 `.claude/skills/` 目录下：**

```
.claude/
└── skills/
    └── book-qa/
        ├── SKILL.md                      # 主入口（YAML + 核心指令）
        ├── WORKFLOW.md                   # 工作流程详解
        ├── CONSTRAINTS.md                # 约束规则详解
        ├── TEMPLATES.md                  # 回答模板示例
        └── scripts/
            ├── semantic-search.js        # 关键词搜索工具（Node.js）
            ├── extract-citation.js       # 引用提取工具（Node.js）
            └── package.json              # 脚本依赖
```

**YAML Frontmatter 设计：**

```yaml
---
name: book-qa
description: 严格的书籍问答助手。基于原文证据回答，标注引用来源，找不到时诚实说明。当用户询问书籍内容时使用。
argumentHint: "<bookId>"
---
```

**启用 Skill 方式：**

```typescript
// 在 allowedTools 中包含 "Skill" 工具
allowedTools: ['Read', 'Glob', 'Grep', 'Skill'],
```

---

### 步骤 2：编写 SKILL.md 主文件

**结构：**

```markdown
# 书籍问答助手 (book-qa)

## 核心约束（强制执行）

### ✅ 必须做的事
1. 所有回答必须基于原文证据
2. 标注引用来源 [章节:位置]
3. 使用工具搜索后再回答

### ❌ 禁止的事
1. 禁止编造内容
2. 禁止用训练数据"补充"答案
3. 禁止模糊回答（如"书中可能提到"）

## 快速工作流程

1. 调用 SearchBookContent 工具
2. 如果无结果 → 调用 RequestMoreInfo
3. 如果有结果 → 调用 GetCitationContext
4. 基于原文回答，标注引用

## 辅助脚本

```bash
# 语义搜索
scripts/semantic-search.js --mode summary --query "问题"

# 提取引用
scripts/extract-citation.js --chapter <id> --range <start-end>
```

详细说明请参阅 [WORKFLOW.md](WORKFLOW.md)
```

---

### 步骤 3：编写辅助文档

#### WORKFLOW.md
- 完整的工作流程图
- 工具调用顺序
- 决策树（何时调用哪个工具）

#### CONSTRAINTS.md
- 详细的约束规则
- 正确/错误示例对比
- 边界情况处理

#### TEMPLATES.md
- 标准回答格式
- 引用标注格式
- "找不到"时的回复模板

---

### 步骤 4：创建 MCP 工具

**文件路径：** `electron/main/agents/tools/book-qa-tools.ts`

#### 4.1 SearchBookContent

```typescript
tool('SearchBookContent',
  '搜索书籍中与用户问题相关的内容。\n' +
  '工作流程：\n' +
  '1. 先搜索章节摘要（快速、低 token）\n' +
  '2. 如果摘要不够，再搜索章节全文\n' +
  '3. 返回按相关度排序的结果，包含章节信息和相关度分数',
  {
    bookId: z.string(),
    query: z.string().describe('搜索查询（提取问题的关键概念）'),
    searchMode: z.enum(['summary', 'full', 'auto']).default('auto'),
    maxResults: z.number().default(5),
  },
  async (args, extra) => { /* 实现 */ }
)
```

#### 4.2 GetCitationContext

```typescript
tool('GetCitationContext',
  '获取指定位置的原文内容和上下文。\n' +
  '用于在回答时提供准确的引用。',
  {
    bookId: z.string(),
    chapterId: z.string(),
    position: z.object({
      start: z.number(),
      end: z.number(),
    }).optional(),
    contextLines: z.number().default(3).describe('前后文行数'),
  },
  async (args, extra) => { /* 实现 */ }
)
```

#### 4.3 RequestMoreInfo

```typescript
tool('RequestMoreInfo',
  '当搜索后仍无法找到相关内容时，调用此工具请求用户提供更多信息。\n' +
  '**重要**：不要编造答案，必须调用此工具。',
  {
    reason: z.string().describe('为什么找不到'),
    suggestions: z.array(z.string()).describe('建议用户提供的信息'),
    searchedChapters: z.array(z.string()).describe('已搜索的章节'),
  },
  async (args, extra) => { /* 实现 */ }
)
```

---

### 步骤 5：更新会话配置

**文件：** `electron/main/agents/main-process-session.ts`

#### 5.1 添加 Skill 目录配置

```typescript
export interface MainProcessSessionConfig {
  model?: string;
  allowedTools?: string[];
  mcpServers?: Record<string, any>;
  systemPrompt?: string;
  context?: SessionContext;
  workspacePath?: string;
  // 新增：Skill 配置
  enableSkills?: boolean;          // 是否启用 Skill
  skillsCwd?: string;              // Skill 工作目录（.claude/skills 所在路径）
}
```

#### 5.2 修改会话创建逻辑

```typescript
async start(): Promise<void> {
  // ...

  // 构建系统提示词
  const systemPrompt = this.buildSystemPrompt();

  // 创建 SDK 会话
  this.sdkSession = unstable_v2_createSession({
    model: this.config.model || 'claude-sonnet-4-5-20250929',
    // 关键：包含 "Skill" 工具以启用 Skill 功能
    allowedTools: this.config.enableSkills
      ? ['Read', 'Glob', 'Grep', 'Skill', ...this.config.bookQATools]
      : this.config.allowedTools,
  });

  // ...
}
```

**说明：**
- `settingSources` 不需要显式设置，SDK 会自动发现 `.claude/skills/` 中的 Skills
- 关键是在 `allowedTools` 中包含 `'Skill'` 工具

---

### 步骤 6：创建辅助脚本

#### 6.1 semantic-search.js（关键词搜索）

```javascript
#!/usr/bin/env node
/**
 * 书籍内容搜索脚本（简单版 - 关键词匹配）
 * 用于通过 bash 工具调用，不消耗上下文 token
 *
 * 使用方式：
 *   node semantic-search.js --bookId <id> --query "关键词" --mode summary|full
 */

import fs from 'fs/promises';
import path from 'path';

// 简单的关键词提取（中文分词）
function extractKeywords(text) {
  // 移除标点符号，保留中文、英文、数字
  const cleaned = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, ' ');
  // 简单分词（按空格和中文边界）
  const words = cleaned.match(/[\u4e00-\u9fa5]+|[a-zA-Z0-9]+/g) || [];
  return [...new Set(words)]; // 去重
}

// 计算文本相关度分数
function calculateRelevance(text, keywords) {
  let score = 0;
  const lowerText = text.toLowerCase();

  for (const keyword of keywords) {
    const lowerKeyword = keyword.toLowerCase();
    const count = (lowerText.match(new RegExp(lowerKeyword, 'g')) || []).length;
    score += count * 10; // 每个匹配加分
  }

  return score;
}

// 搜索章节摘要
async function searchSummaries(workspacePath, bookId, keywords, maxResults) {
  const summaryPath = path.join(workspacePath, bookId, '.dogear/chapters');
  // 读取所有章节摘要
  // 计算相关度
  // 返回排序后的结果
}

// 搜索全文
async function searchFullContent(workspacePath, bookId, keywords, maxResults) {
  // 从数据库读取章节内容
  // 计算相关度
  // 返回排序后的结果
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  const params = Object.fromEntries(
    args.filter((_, i) => i % 2 === 0).map((key, i) => [key.replace('--', ''), args[i * 2 + 1]])
  );

  const { bookId, query, mode = 'auto', maxResults = 5 } = params;

  if (!bookId || !query) {
    console.error('Usage: node semantic-search.js --bookId <id> --query "<keywords>"');
    process.exit(1);
  }

  const keywords = extractKeywords(query);

  // 执行搜索...
  const results = await searchSummaries(/* ... */);

  console.log(JSON.stringify(results, null, 2));
}

main();
```

#### 6.2 extract-citation.js

```javascript
#!/usr/bin/env node
/**
 * 引用提取脚本
 * 用于提取指定位置的原文和上下文
 *
 * 使用方式：
 *   node extract-citation.js --bookId <id> --chapterId <id> --position <start-end>
 */

import fs from 'fs/promises';
import path from 'path';

// 从数据库或文件获取章节内容
async function getChapterContent(bookId, chapterId) {
  // 调用现有服务模块获取内容
}

// 提取指定位置的文本和上下文
function extractContext(content, position, contextLines = 3) {
  const lines = content.split('\n');
  const { start, end } = position;

  // 简化实现：按字符位置提取
  const before = Math.max(0, start - 100);
  const after = Math.min(content.length, end + 100);

  return {
    before: content.substring(before, start),
    target: content.substring(start, end),
    after: content.substring(end, after),
  };
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  // 解析参数、执行提取、输出结果
}

main();
```

---

### 步骤 7：前端集成

**文件：** `components/AgentChat.tsx`

#### 7.1 扩展消息类型

```typescript
interface Citation {
  chapterId: string;
  chapterTitle: string;
  position: { start: number; end: number };
  text: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
  isStreaming?: boolean;
  subMessages?: ExtendedSessionMessage[];
  // 新增：引用信息
  citations?: Citation[];
}
```

#### 7.2 引用渲染组件（支持点击跳转）

```tsx
interface CitationBadgeProps {
  citation: Citation;
  onJumpToChapter: (chapterId: string, position: { start: number; end: number }) => void;
}

function CitationBadge({ citation, onJumpToChapter }: CitationBadgeProps) {
  return (
    <button
      onClick={() => onJumpToChapter(citation.chapterId, citation.position)}
      className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 hover:bg-blue-100
                 rounded text-xs text-blue-700 cursor-pointer transition-colors"
      title="点击跳转到原文位置"
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
      <span>{citation.chapterTitle}</span>
      <span className="text-gray-400">:</span>
      <span>{citation.position.start}-{citation.position.end}</span>
    </button>
  );
}
```

#### 7.3 IPC 通信（跳转到阅读器）

```typescript
// types/electron-api.ts
interface ElectronAPI {
  // ...
  bookReader: {
    jumpToPosition: (chapterId: string, position: { start: number; end: number }) => Promise<void>;
  };
}

// preload/index.ts
contextBridge.exposeInMainWorld('electronAPI', {
  bookReader: {
    jumpToPosition: (chapterId, position) =>
      ipcRenderer.invoke('book-reader:jump-to-position', chapterId, position),
  },
});
```

---

## 验证计划

### 测试场景

1. **场景 A：有明确答案**
   - 用户："书中主角是谁？"
   - 预期：AI 调用 SearchBookContent → 找到 → 返回答案 + 引用

2. **场景 B：无相关内容**
   - 用户："书中有没有提到机器学习？"
   - 预期：AI 调用 SearchBookContent → 无结果 → 调用 RequestMoreInfo

3. **场景 C：模糊查询**
   - 用户："那个关于...的章节在哪里？"
   - 预期：AI 调用 RequestMoreInfo 请求更具体的信息

4. **场景 D：幻觉测试**
   - 用户："书中第100章讲了什么？"（实际只有50章）
   - 预期：AI 诚实说明只有50章，不编造内容

---

## 文件清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `electron/main/agents/skills/book-qa/SKILL.md` | Skill 主入口 |
| `electron/main/agents/skills/book-qa/WORKFLOW.md` | 工作流程详解 |
| `electron/main/agents/skills/book-qa/CONSTRAINTS.md` | 约束规则 |
| `electron/main/agents/skills/book-qa/TEMPLATES.md` | 回答模板 |
| `electron/main/agents/skills/book-qa/scripts/semantic-search.js` | 搜索脚本 |
| `electron/main/agents/skills/book-qa/scripts/extract-citation.js` | 引用脚本 |
| `electron/main/agents/tools/book-qa-tools.ts` | MCP 工具 |

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `electron/main/agents/main-process-session.ts` | 添加 Skill 配置支持 |
| `components/AgentChat.tsx` | 添加引用显示 |
| `types/electron-api.ts` | 扩展消息类型 |

---

## 已确认决策

### 1. Skill 加载方式 ✅

**确认：使用 `.claude/skills/` 目录 + `allowedTools` 包含 `'Skill'`**

根据官网说明：
- 在 `.claude/skills/` 中创建包含 SKILL.md 的目录
- 在 `allowedTools` 配置中包含 `'Skill'` 工具
- SDK 运行时会自动发现 Skills

---

### 2. 搜索实现方式 ✅

**确认：先实现简单版（关键词匹配）**

简单版实现：
- 基于关键词的全文搜索
- 使用现有的 `Grep` 工具或自定义关键词匹配
- 计算相关度分数（基于关键词出现频率和位置）

未来可升级到高级版：
- 向量搜索（embeddings）
- 语义相似度匹配
- 需要额外的向量数据库

---

### 3. 脚本语言选择 ✅

**确认：使用 Node.js**

#### 分析对比

| 方面 | Node.js | Python |
|------|---------|--------|
| **技术栈一致性** | ✅ 与项目一致 | ❌ 需要额外运行时 |
| **数据库访问** | ✅ 可直接导入现有模块 | ❌ 需要通过进程间通信 |
| **Electron 集成** | ✅ 原生支持 | ❌ 需要额外配置 |
| **中文分词** | ⚠️ 可用 nodejieba | ✅ jieba 原生支持 |
| **文本处理** | ⚠️ 基础功能够用 | ✅ 更丰富的 NLP 库 |
| **部署复杂度** | ✅ 无额外依赖 | ❌ 需要 Python 环境 |

#### 结论：Node.js 更合适

**理由：**
1. 项目已使用 Node.js/TypeScript，脚本可复用现有 service 模块
2. 可直接调用 `workspaceService` 和数据库模块
3. 对于简单关键词匹配，Node.js 完全够用
4. 不需要引入额外的 Python 运行时

**关键词匹配实现方案：**
```javascript
// 使用简单的中文分词和关键词提取
import { segment } from 'nodejieba';

// 或使用正则表达式匹配中文词汇
const chineseWords = text.match(/[\u4e00-\u9fa5]+/g) || [];
```

---

### 4. 前端交互方式 ✅

**确认：需要支持点击引用跳转到原文位置**

**实现方式：**
1. 引用徽章显示为可点击按钮
2. 点击后通过 IPC 调用主进程的跳转方法
3. 主进程通知阅读器组件跳转到指定位置
4. 阅读器高亮显示相关文本