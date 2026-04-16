# 自进化文章解析系统设计

> 日期：2026-04-16
> 状态：设计阶段

## 目标

将文章导入从纯固定代码解析升级为**固定解析 + AI 质量检查 + AI 介入解析 + 规则自进化**的智能系统。

核心原则：
- 固定解析成功且质量好 → 最短路径，零 AI 成本
- 固定解析失败或质量差 → AI 后台介入，不占用用户会话
- AI 学到的解析经验回写到 Skill 规则文件，系统越用越强

---

## 核心流程

```
用户导入 URL
    │
    ▼
① 固定解析（当前 Readability + WeChat 逻辑，保持不变）
    │
    ├─ 成功 ──► ② AI 质量检查（后台 Agent）
    │              ├─ 通过 ──► 保存文章 ✓ （记录日志）
    │              └─ 不通过 ──► ③ AI 重新解析
    │                              ├─ 成功 ──► 覆盖保存 + 更新 Skill 规则 ✓
    │                              └─ 失败 ──► 保留固定解析结果 + 标记质量问题 ✗
    │
    └─ 失败 ──► ③ AI 直接解析（读 raw.html + Skill 规则）
                   ├─ 成功 ──► 保存文章 + 更新 Skill 规则 ✓
                   └─ 失败 ──► 保存错误记录，通知用户 ✗
```

### 流程细节

**① 固定解析**（现有逻辑，不变）：
- HTTP 获取 → linkedom 解析 DOM → 预处理（隐藏元素/懒加载） → Readability 提取 → Turndown 转 Markdown
- 微信公众号走 WeChat 特殊路径
- 结果保存为 `meta.json` + `content.md` + `raw.html`

**② AI 质量检查**（新增，后台）：
- 固定解析成功后，异步提交 `PARSE_ARTICLE` 任务到 Agent Worker
- Agent 快速扫描：标题是否合理、正文是否完整（字数/段落数）、图片是否正确提取、是否有明显垃圾内容
- 通过 → 记录日志，结束
- 不通过 → 进入 AI 重新解析流程

**③ AI 重新解析**（新增，后台）：
- Agent 读取 `raw.html` + 对应的 Skill 规则文件
- 尝试用规则中的策略提取内容
- 如果规则不适用，Agent 自行分析 HTML 结构，找到正文
- 成功后覆盖 `content.md` 和 `meta.json`
- 将新发现的解析模式回写到 Skill 规则文件

---

## 架构设计

### 前置：抽取共享 Query 配置层（agent-query-config.ts）

**问题发现**：代码审查发现，当前 `QueryBasedSession`（主进程用户会话）和 `agent-worker.ts`（Worker 后台任务）有两套**完全独立**的 `query()` 配置：

| | QueryBasedSession | Agent Worker |
|---|---|---|
| API Key | ✅ 从 settings.json Profile 读取 | ❌ 仅依赖系统 env |
| 模型映射 | ✅ haikuModel/sonnetModel/opusModel | ❌ 缺失 |
| thinking/effort | ✅ 从 settings 读取 | ❌ 缺失 |
| pathToClaudeCodeExecutable | ✅ 打包环境处理 | ❌ 缺失（打包后会找不到 CLI） |
| env 构建 | ✅ 完整 ANTHROPIC_* 环境变量 | ❌ 只传了 DOGEAR_CONFIG_DIR |

Worker 里的 `query()` 完全依赖系统环境变量，如果用户只通过 UI 设置了 API Key（存在 settings.json 里），Worker 的后台任务实际上**无法正常工作**。

**解决方案**：新建 `electron/main/agents/agent-query-config.ts`，抽取共享配置构建逻辑：

```typescript
// electron/main/agents/agent-query-config.ts

import { loadSettings, getActiveProfile, isProfileComplete } from '../services/settings-service.js';
import { getClaudeConfigDir } from '../tipc/agent.js';
import { app } from 'electron';
import path from 'path';

/**
 * 构建 query() 所需的通用配置
 * QueryBasedSession 和 Agent Worker 共享此逻辑
 */
export interface QueryBaseConfig {
  env: Record<string, string>;                 // 包含 API Key、模型映射等
  thinking: { type: string; budget_tokens?: number };
  effort: string;
  permissionMode: string;
  pathToClaudeCodeExecutable?: string;         // 打包环境需要
  permissionRules?: { allow?: string[]; deny?: string[] };
}

/**
 * 从 settings.json 加载并构建 query 配置
 * 所有使用 query() 的地方都应调用此函数
 */
export async function buildQueryBaseConfig(): Promise<QueryBaseConfig> {
  const appSettings = await loadSettings();
  const activeProfile = getActiveProfile(appSettings);

  if (!isProfileComplete(activeProfile)) {
    throw new Error(`模型方案 "${activeProfile.name}" 配置不完整`);
  }

  const claudeConfigDir = getClaudeConfigDir();

  // 构建 env（合并系统环境变量 + Profile 配置）
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    ANTHROPIC_AUTH_TOKEN: activeProfile.apiKey,
    ANTHROPIC_BASE_URL: activeProfile.baseUrl,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: activeProfile.haikuModel,
    ANTHROPIC_DEFAULT_SONNET_MODEL: activeProfile.sonnetModel,
    ANTHROPIC_DEFAULT_OPUS_MODEL: activeProfile.opusModel,
    API_TIMEOUT_MS: String(activeProfile.apiTimeoutMs),
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: activeProfile.disableNonessentialTraffic ? '1' : '0',
    CLAUDE_CONFIG_DIR: claudeConfigDir,
  };

  // 打包环境：显式指定 CLI 路径
  let pathToClaudeCodeExecutable: string | undefined;
  if (app.isPackaged) {
    pathToClaudeCodeExecutable = path.join(
      path.dirname(app.getAppPath()),
      'app.asar.unpacked',
      'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js'
    );
  }

  return {
    env,
    thinking: appSettings.ai.thinking,
    effort: appSettings.ai.effort,
    permissionMode: appSettings.ai.permissionMode || 'default',
    pathToClaudeCodeExecutable,
    permissionRules: appSettings.permissionRules,
  };
}
```

**改造范围**：

1. `QueryBasedSession.start()` — 替换内联的配置加载逻辑，改为调用 `buildQueryBaseConfig()`
2. `agent-worker.ts` — Worker 初始化时由主进程调用 `buildQueryBaseConfig()` 序列化后传入，或 Worker 内部直接调用（因为 `loadSettings()` 用 fs 读文件，Worker 线程可以直接访问）
3. 新的 `handleParseArticleTask()` — 直接调用 `buildQueryBaseConfig()` 获取配置

**注意**：Worker 线程无法访问 `electron.app`，所以 `app.isPackaged` 和 `app.getAppPath()` 需要在主进程初始化时传入 Worker。当前的 `createWorker()` 已经通过 init config 传递了部分信息，需要扩展 `AgentWorkerConfig` 增加 `isPackaged` 和 `cliPath` 字段。

---

### 新增 TaskType

```typescript
// electron/main/agents/task-types.ts
export enum TaskType {
  // ... 现有类型
  PARSE_ARTICLE = 'parse_article'
}

export interface ParseArticlePayload {
  articleId: string           // 文章 UUID
  articleDir: string          // 文章目录路径
  url: string                 // 原始 URL
  fixedParseSuccess: boolean  // 固定解析是否成功
  skillsDir: string           // Skill 规则目录路径
}
```

### Agent 工具（MCP Server）

在 `electron/main/agents/tools/article-parse-tools.ts` 中定义：

| 工具名 | 输入 | 输出 | 作用 |
|--------|------|------|------|
| `ReadRawHtml` | `articleId` | HTML 文本 | 读取保存的原始 HTML |
| `ReadCurrentContent` | `articleId` | Markdown 文本 + 元数据 | 读取当前已解析的内容（用于质量检查） |
| `ReadParserRules` | `platform?` | 规则文本 | 读取通用规则 + 匹配的平台规则 |
| `SaveParsedArticle` | `title, author, content, ...` | success/fail | 覆盖保存解析结果 |
| `UpdateParserRule` | `type: 'common'|'platform', platform?, content` | success/fail | 创建或更新规则文件 |

### Agent Worker 处理

复用现有 `agent-worker.ts` 的模式（参照 `handleAnalyzeBookTask`）：

```typescript
// agent-worker.ts 新增 handler
private async handleParseArticleTask(task: AgentTask, taskLogger: any) {
  const payload = task.data as ParseArticlePayload
  
  // 1. 创建 MCP Server（自定义工具）
  const mcpServer = createArticleParseMcpServer(payload)
  
  // 2. 加载 Skill 规则作为 systemPrompt 的一部分
  const commonRules = await readSkillFile(payload.skillsDir, 'common.md')
  const platformRules = await matchPlatformRules(payload.skillsDir, payload.url)
  
  // 3. 构建 prompt
  const prompt = payload.fixedParseSuccess
    ? buildQualityCheckPrompt(commonRules, platformRules)   // 质量检查模式
    : buildFullParsePrompt(commonRules, platformRules)       // 完整解析模式
  
  // 4. 执行 query()
  const agentQuery = query({
    prompt,
    options: {
      permissionMode: 'bypassPermissions',
      mcpServers: { 'article-parser': mcpServer },
      hooks: {
        PostToolUse: [{ hooks: [async (result) => {
          // 发送进度到主进程
          this.sendMessage({ type: 'parseProgress', articleId: payload.articleId, ... })
          return { continue: true }
        }]}],
        Stop: [{ hooks: [async () => {
          // 记录解析历史
          await appendHistory(payload.skillsDir, { ... })
          return { stop: true }
        }]}]
      }
    }
  })
  
  // 5. 迭代结果
  for await (const message of agentQuery) {
    if (message.type === 'result') {
      this.sendTaskUpdate(task.id, TaskStatus.COMPLETED, message)
    }
  }
}
```

### 触发时机

在 `electron/main/tipc/article.ts` 的 `parseArticle` handler 中：

```typescript
// 现有逻辑：固定解析
const result = await articleService.fetchAndParseArticle(url)

// 新增：异步提交 AI 任务（不阻塞返回）
agentManager.submitTask({
  type: TaskType.PARSE_ARTICLE,
  data: {
    articleId: result.meta.id,
    articleDir: articleDir,
    url: url,
    fixedParseSuccess: true,  // 或 false（如果固定解析失败也要走这条路）
    skillsDir: getSkillsDir()
  }
}, (update) => {
  // 通过 renderer-handlers 事件通知前端
  mainWindow.webContents.send('article-parse-progress', update)
})

// 立即返回固定解析结果（AI 在后台工作）
return { article: result.meta }
```

**固定解析失败时**：
```typescript
try {
  const result = await articleService.fetchAndParseArticle(url)
  // ... 上面的正常流程
} catch (error) {
  // 固定解析失败，但仍然保存 raw.html
  const rawHtml = await fetchRawHtml(url)
  await saveRawHtml(articleDir, rawHtml)
  
  // 提交 AI 完整解析任务
  agentManager.submitTask({
    type: TaskType.PARSE_ARTICLE,
    data: {
      articleId, articleDir, url,
      fixedParseSuccess: false,
      skillsDir: getSkillsDir()
    }
  }, callback)
  
  return { article: partialMeta, status: 'ai_parsing' }
}
```

---

## Skill 规则存储

### 目录结构

```
.dogear/skills/article-parser/
  ├── common.md              # 通用解析规则
  ├── platforms/
  │   ├── wechat.md          # 微信公众号（从代码迁移）
  │   └── (AI 自动创建新平台文件)
  └── history.jsonl          # 解析日志
```

### common.md 初始内容（从代码迁移）

```markdown
# 通用文章解析规则

## 预处理步骤

### 1. 隐藏元素清理
移除以下 inline style 的元素内容：
- `visibility: hidden`
- `opacity: 0`
- `display: none`
原因：许多平台通过 JS 控制可见性，静态解析时这些元素可能包含干扰内容。

### 2. 图片懒加载修复
常见的懒加载属性（按优先级）：
- `data-src` → 复制到 `src`
- `data-original` → 复制到 `src`
- `data-lazy-src` → 复制到 `src`

### 3. 相对 URL 转绝对 URL
所有 `<img>` 和 `<a>` 的相对路径需要基于页面 origin 转换为绝对路径。

## 正文识别

### Readability 提取
- 使用 Mozilla Readability 作为主要提取器
- 最小有效正文长度：100 字符（去除空白后）
- 如果提取失败，需要 AI 分析 HTML 结构手动定位正文区域

### 常见正文容器选择器（优先级从高到低）
- `article`
- `[role="main"]`
- `.post-content`, `.article-content`, `.entry-content`
- `#content`, `.content`

## 元数据提取

### 标题（按优先级）
1. `<meta property="og:title">`
2. `<title>` 标签
3. `<h1>` 第一个

### 作者（按优先级）
1. `<meta name="author">`
2. `<meta property="article:author">`
3. 页面内 byline 模式匹配

### 发布日期（按优先级）
1. `<meta property="article:published_time">`
2. `<time>` 标签的 `datetime` 属性
3. 页面内日期模式匹配

## 质量检查标准

一篇成功解析的文章应满足：
- [ ] 标题非空且不是纯 URL
- [ ] 正文长度 > 200 字符
- [ ] 正文不包含大量重复内容（导航栏、侧边栏残留）
- [ ] 图片 URL 可访问（抽查前 3 张）
- [ ] Markdown 格式正确（标题层级、代码块闭合）
```

### platforms/wechat.md 初始内容（从代码迁移）

```markdown
# 微信公众号 (mp.weixin.qq.com)

## 域名匹配
- `mp.weixin.qq.com`

## 内容提取策略

### 长文章（标准模式）
- Readability 正常提取即可
- 图片使用 `data-src` 属性（必须做懒加载修复）

### 短内容（type 9）
微信短内容不在 DOM 中，而是存储在 JS 变量里：
1. 在 `<script>` 标签中查找 `text_page_info` 变量
2. 正则提取：`text_page_info:\s*\{[\s\S]*?content:\s*JsDecode\('([\s\S]*?)'\)`
3. 解码转义序列：`\x0a` → 换行，`\x26` → &，等等
4. 如果 Readability 提取的内容为空但 JS 变量有内容，使用 JS 变量的内容

### 元数据提取
- 标题：`window.msg_title = '...'` JS 变量
- 作者：`nick_name: '...'` JS 变量
- 站点名：默认为 "微信公众号"

## 注意事项
- 微信文章的 `<section>` 标签大量使用 inline style
- 部分样式会导致 Readability 错误判断内容层级
- 图片可能有防盗链，需要保留原始 URL
```

---

## 解析历史

### history.jsonl 格式

每行一条 JSON 记录：

```json
{
  "timestamp": "2026-04-16T10:30:00Z",
  "articleId": "uuid-xxx",
  "url": "https://mp.weixin.qq.com/s/xxx",
  "platform": "wechat",
  "fixedParseSuccess": true,
  "qualityCheck": {
    "passed": false,
    "issues": ["标题提取为空", "正文缺少图片"]
  },
  "aiReparse": true,
  "aiResult": {
    "success": true,
    "method": "从 JS 变量中提取短内容",
    "ruleUpdated": "platforms/wechat.md"
  },
  "tokenUsed": 1234,
  "duration": 3500
}
```

### 前端查看

在文章元数据中增加 `parseStatus` 字段：
- `fixed` — 固定解析成功，AI 质量检查通过
- `ai_enhanced` — AI 介入后成功
- `ai_parsing` — AI 正在后台解析中
- `quality_warning` — 固定解析成功但质量检查未通过（AI 也无法改善）
- `failed` — 解析失败

在 `ArticlePreview.tsx` 中用小标签展示解析状态，点击可查看详细日志。

---

## 实现步骤

### Phase 0: 共享 Query 配置层（基础设施前置）

0. **新建 `agent-query-config.ts`**
   - 抽取 `buildQueryBaseConfig()` 函数
   - 从 `settings.json` 读取 Profile、thinking、effort、permissionMode
   - 构建完整的 env（ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, 模型映射等）
   - 处理打包环境 `pathToClaudeCodeExecutable`

1. **改造 `QueryBasedSession.start()`**
   - 替换内联配置加载（约 L143-L299），改为调用 `buildQueryBaseConfig()`
   - 保留会话特有的逻辑（systemPrompt 构建、canUseTool 回调、hooks）
   - 确保行为完全一致（回归测试：创建会话、发送消息、resume、fork）

2. **改造 `agent-worker.ts` 的 `handleAnalyzeBookTask()`**
   - Worker 内部调用 `buildQueryBaseConfig()` 获取配置（Worker 可直接 fs 读 settings.json）
   - 扩展 `AgentWorkerConfig` 增加 `isPackaged` 和 `cliPath` 字段（`app` API 在 Worker 不可用）
   - 修改 `agent-manager.ts` 的 `createWorker()` 传入这些字段
   - 将 `env` + `thinking` + `pathToClaudeCodeExecutable` 注入到 `query()` options 中
   - 确保书籍分析功能不退化

3. **清理遗留代码**
   - 移除 `agent-manager.ts` 中的 `dbPath` 相关代码（SQLite 已废弃）
   - 移除 Worker init 中创建 `data/` 目录的逻辑

### Phase 1: Skill 规则基础设施

4. 创建 Skill 规则目录和初始文件
   - `.dogear/skills/article-parser/common.md`
   - `.dogear/skills/article-parser/platforms/wechat.md`
   - 初始化 `history.jsonl`

5. 新增 TaskType 和 payload 定义
   - `task-types.ts` 添加 `PARSE_ARTICLE`

6. 创建 MCP 工具
   - `agents/tools/article-parse-tools.ts`（5 个工具）

### Phase 2: Agent Worker 集成

7. `agent-worker.ts` 添加 `handleParseArticleTask()`
   - 调用 `buildQueryBaseConfig()` 获取完整配置
   - 质量检查模式的 prompt
   - 完整解析模式的 prompt
   - 规则加载和匹配逻辑

8. `tipc/article.ts` 修改触发逻辑
   - 固定解析成功后异步提交质量检查
   - 固定解析失败后异步提交完整解析
   - 新增 `raw.html` 单独保存逻辑（固定解析失败时）

### Phase 3: 前端展示

9. 文章元数据扩展 `parseStatus` 字段
10. `ArticlePreview.tsx` 添加解析状态标签
11. 解析进度事件监听和状态更新

### Phase 4: 规则自进化

12. `UpdateParserRule` 工具实现（AI 回写规则）
13. 平台域名匹配逻辑
14. 解析历史 JSONL 读写

---

## 风险与注意事项

1. **AI 成本控制**
   - 每次质量检查约 500-1000 tokens（只是快速扫描）
   - 完整解析约 2000-5000 tokens（取决于 HTML 大小）
   - 可考虑对 raw.html 做截断（保留前 50KB）

2. **规则文件膨胀**
   - 单个平台规则文件上限建议 5KB
   - common.md 上限建议 10KB
   - AI 更新规则时应精简而非追加

3. **并发安全**
   - 多篇文章同时导入时，规则文件写入需要互斥锁
   - 可复用 `safe-json.ts` 的 mutex 模式

4. **不破坏现有流程**
   - 固定解析逻辑完全保持不变
   - AI 是异步后台任务，不影响文章导入的即时响应
   - 即使 AI 任务失败，用户仍有固定解析的结果可用
