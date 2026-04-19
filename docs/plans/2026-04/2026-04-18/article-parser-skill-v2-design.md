# 自进化文章解析系统 V2 设计（Skill + Python 脚本化）

> 日期：2026-04-18
> 状态：设计阶段
> 替代方案：[2026-04-16/self-evolving-article-parser-design.md](../2026-04-16/self-evolving-article-parser-design.md)

## 背景

2026-04-16 设计（V1）已实施到 Phase 3，但实际跑了两天下来存在三处关键问题：

1. **"看不见历史"**：`history.jsonl` 只落盘，前端完全没有查看入口。用户感知不到 AI 是否介入、改了什么。
2. **"自进化没发生"**：生产中 `ruleUpdated` 记录全部为 `null`。AI 在 prompt 里被要求"**如果**发现新模式就调用 UpdateParserRule"——这种软约束让 AI 倾向于解析完就收工。
3. **"形态错了"**：V1 的规则是 Markdown 文档，让 AI 每次重新读自然语言规则后重新解析。用户原意是**脚本化**——让 AI 把学到的提取逻辑固化成可重复执行的代码，下次同类文章直接跑脚本零 AI。

V2 的核心调整：**规则从 Markdown 文档升级为可执行的 Python 脚本**，每个平台一个脚本文件，AI 负责写和迭代这些脚本。

---

## 目标与非目标

### 目标
- 每个平台一个可执行的 Python 脚本，脚本成功 = 零 AI 成本
- AI 只在脚本不存在 / 脚本报错 / Readability 也失败时介入
- AI 像开发者一样"来来回回调试"：写候选脚本 → 跑 → 看结果 → 修 → 达标后落盘
- 同一套能力也暴露给主会话的 AgentChat，用户可在对话里说"帮我改下知乎脚本"
- 历史有可视化入口，解析过程可追溯

### 非目标
- 不做企业级多用户 / 云端规则共享（定位是个人工具，"千人千面"）
- 不做强沙箱（Python 子进程隔离已够用，不再上 seccomp/docker）
- 不对所有成功解析的文章跑质量抽检（省 token，尊重主观标准）

---

## 架构全景

```
                          ┌────────────────────────────┐
 用户在 AgentChat 说       │  主会话 Agent              │
 "改下知乎脚本"     ─────►  │  加载 article-parser Skill │──┐
                          └────────────────────────────┘  │
                                                          │
 导入 URL → 尝试脚本 ─┐                                   │
           ├─ 成功   ──► 保存，结束                        │ 都通过
           └─ 失败   ──► 提交 PARSE_ARTICLE Worker 任务 ──┤ 同一套
                        ┌────────────────────────────┐   │ MCP 工具
                        │  Agent Worker              │   │
                        │  加载 article-parser Skill │───┘
                        └────────────────────────────┘
                                     │
                                     ▼
                   ┌─────────────────────────────────────┐
                   │  MCP 工具（electron 主进程提供）    │
                   │  - ReadRawHtml                      │
                   │  - ReadCurrentContent               │
                   │  - ListPlatformScripts              │
                   │  - ReadPlatformScript               │
                   │  - RunPlatformScript  ──┐           │
                   │  - UpdatePlatformScript │           │
                   │  - SaveParsedArticle    │           │
                   │  - ReadParseHistory     │           │
                   └─────────────────────────┼───────────┘
                                             │
                                             ▼
                           ┌────────────────────────────┐
                           │  Python Bridge             │
                           │  （复用 python-bridge.ts） │
                           │  新增 RPC:                 │
                           │  - run_article_script      │
                           └────────────────────────────┘
                                             │
                                             ▼
                           ┌────────────────────────────┐
                           │  python/article_parser/    │
                           │  - runner.py（沙箱执行）   │
                           │  - sdk.py（给脚本用的 API）│
                           └────────────────────────────┘
```

---

## 文件布局

### Skill 目录（用户数据，自进化对象）

```
.dogear/skills/article-parser/
  ├── SKILL.md                  # 新增：Agent SDK Skill 入口文件
  ├── common.md                 # 保留：通用规则（给 AI 看的知识，不执行）
  ├── platforms/
  │   ├── wechat.py             # 微信公众号脚本（初始版由人类或 AI 写）
  │   ├── zhihu.py              # 知乎（AI 自己写的）
  │   └── ...                   # AI 遇到新平台时自动创建
  └── history.jsonl             # 保留：每次解析的审计记录
```

### SKILL.md 格式（Agent SDK 标准）

```markdown
---
name: article-parser
description: 从网络文章 HTML 中提取标题、正文、作者等结构化内容。当用户导入文章失败、质量不佳，或要求调整某平台的解析逻辑时使用此 Skill。
---

# 文章解析 Skill

## 工作流
...（告诉 Agent 怎么调用工具，详见「AI 调试循环」章节）
```

### Python 运行时（代码仓库内）

```
python/article_parser/
  ├── __init__.py
  ├── runner.py                 # 沙箱执行器：加载 platforms/xxx.py 并调用 extract()
  └── sdk.py                    # 暴露给用户脚本的 API（HTML 解析工具、结果构造器）
```

### 平台脚本约定（AI 写出来的东西）

每个 `platforms/<platform>.py` 必须导出一个 `extract(ctx)` 函数：

```python
# 示例：.dogear/skills/article-parser/platforms/wechat.py
from article_parser_sdk import soup, Result, extract_js_var

def extract(ctx):
    """
    ctx.url: str - 文章 URL
    ctx.html: str - 原始 HTML
    返回 Result(title=..., content=..., author=..., site_name=..., excerpt=...)
    content 必须是 Markdown 字符串
    """
    doc = soup(ctx.html)

    # 长文章标准模式
    body = doc.select_one('div.rich_media_content')
    if body:
        title = doc.select_one('#activity-name').get_text(strip=True)
        author = doc.select_one('#js_name').get_text(strip=True) if doc.select_one('#js_name') else None
        return Result(
            title=title,
            content=html_to_markdown(body),
            author=author,
            site_name='微信公众号',
        )

    # 短内容（type 9）：从 JS 变量提取
    text = extract_js_var(ctx.html, 'text_page_info', 'content')
    if text:
        title = extract_js_var(ctx.html, 'msg_title') or '(无标题)'
        return Result(title=title, content=text, site_name='微信公众号')

    raise ValueError('无法识别的微信文章结构')
```

**关键约束**（由 `runner.py` 强制）：
- 脚本顶层只能 `from article_parser_sdk import ...`，不能 `import requests` / `import os` / `import subprocess` 等
- `article_parser_sdk` 只暴露：HTML 解析（基于 BeautifulSoup + lxml 包装）、Markdown 转换（基于 markdownify）、正则工具、`Result` 数据类
- 不给脚本任何 I/O 能力：没法读文件、没法发网络请求（原始 HTML 由 ctx 传入）
- 脚本超时硬限制 5 秒

---

## 核心组件详解

### 1. Python Runner（脚本执行沙箱）

**入口（复用 python-bridge）**：`python/main.py` 里新增 JSON-RPC 方法 `run_article_script`。

**沙箱策略**：
- Python 提供 `importlib.util.spec_from_file_location` 按路径加载脚本模块
- 加载前改写 `__builtins__`，去掉 `open` / `exec` / `eval` / `__import__` 中对非白名单模块的访问
- 具体用 `RestrictedPython` 还是手写白名单 import hook，实现阶段选一个
- 脚本执行用 `signal.alarm`（Unix）或 `threading.Timer + _thread.interrupt_main`（Windows）做超时

**RPC 接口**：

```python
# 请求
{
  "method": "run_article_script",
  "params": {
    "script_path": "c:/dogear/.dogear/skills/article-parser/platforms/wechat.py",
    "url": "https://mp.weixin.qq.com/s/xxx",
    "html": "<html>...</html>",
    "timeout_ms": 5000
  }
}

# 响应（成功）
{
  "result": {
    "ok": true,
    "title": "...",
    "content": "...（Markdown）",
    "author": "...",
    "site_name": "...",
    "excerpt": "...",
    "stdout": "...（脚本里 print 的内容，给 AI 调试用）",
    "duration_ms": 45
  }
}

# 响应（失败）
{
  "result": {
    "ok": false,
    "error_type": "ImportError|SyntaxError|TimeoutError|AssertionError|ValueError|...",
    "error_message": "...",
    "traceback": "...（完整 Python traceback）",
    "stdout": "..."
  }
}
```

**关键设计：RPC 从不 throw**。脚本报错也是 `ok: false` 的正常返回，让 AI 拿到 traceback 继续调试。

### 2. MCP 工具集（新增的 5 个）

所有工具都在 `electron/main/agents/tools/article-parse-tools.ts` 里追加，复用现有的 MCP Server 定义。

| 工具 | 入参 | 出参 | 作用 |
|---|---|---|---|
| `ListPlatformScripts` | `skillsDir` | `[{ platform, path, sizeBytes, lastModified }]` | 列出所有已有平台脚本 |
| `ReadPlatformScript` | `skillsDir, platform` | `{ exists, content }` | 读取单个脚本源码 |
| `RunPlatformScript` | `skillsDir, platform, articleDir` 或 `scriptContent`（试跑候选） | Python RPC 的响应 | 试跑脚本，不落盘 |
| `UpdatePlatformScript` | `skillsDir, platform, content` | `{ success, path, sizeBytes }` | 落盘脚本文件（路径白名单校验） |
| `ReadParseHistory` | `skillsDir, limit` | `history.jsonl` 最近 N 条 | 给 AI 看历史失败样本 |

**安全校验**（在 `UpdatePlatformScript` 里强制）：
- `platform` 必须匹配 `/^[a-z0-9-]{1,32}$/`，拒绝 `../`、绝对路径、大写、特殊字符
- 最终路径必须落在 `skillsDir/platforms/` 下（用 `path.resolve` 比较）
- 脚本内容上限 20KB（防 AI 无限膨胀）
- 脚本保存前先做一次 Python 语法编译（`python -c "compile(open(path).read(), path, 'exec')"`），语法错直接拒绝

**`RunPlatformScript` 两种模式**：
- 生产模式（`platform` 入参）：读已落盘的脚本跑，用于验证
- 调试模式（`scriptContent` 入参）：写临时文件试跑，用于 AI 迭代候选代码，不污染 `platforms/`

### 3. Skill 的 SKILL.md（Agent 调用指南）

这是自进化最关键的一块。SKILL.md 的作用是：任何加载 article-parser Skill 的 Agent（Worker 或主会话）都能看到下面这套规程。

```markdown
---
name: article-parser
description: 从网络文章 HTML 中提取标题、正文、作者等结构化内容。当文章导入失败、质量不佳，或用户要求调整某平台解析逻辑时使用。
---

# 文章解析 Skill

## 何时使用
- 用户导入的文章正文缺失、标题异常、图片丢失
- 用户主动要求「改下 xx 平台的解析」
- PARSE_ARTICLE 后台任务触发

## 工具清单
- ReadRawHtml / ReadCurrentContent：看当前文章原料和已解析结果
- ListPlatformScripts / ReadPlatformScript：看已有平台脚本
- RunPlatformScript：试跑脚本（必须先试跑再落盘）
- UpdatePlatformScript：落盘（仅在试跑通过后）
- SaveParsedArticle：保存当前文章的解析结果
- ReadParseHistory：看历史失败样本

## 调试循环（重要）

遇到解析问题时，严格按下面步骤：

1. **诊断**：调 ReadRawHtml 和 ReadCurrentContent，判断当前产出有什么问题
2. **查旧**：调 ListPlatformScripts，看该平台有没有脚本
   - 有脚本 → ReadPlatformScript 读出来
   - 无脚本 → 参考 common.md 的通用规则
3. **写候选**：基于 HTML 结构写新/改进的 extract() 函数
   - 必须用 article_parser_sdk 暴露的工具，不要 import 系统模块
   - Result.content 必须是 Markdown
4. **试跑**：用 RunPlatformScript 的 scriptContent 模式试跑
   - 失败 → 看 traceback，改，再试（最多 5 轮）
   - 成功 → 检查输出合理性（title 非空、content > 200 字符）
5. **落盘**：UpdatePlatformScript 写入 platforms/
6. **保存当前文章**：SaveParsedArticle（用刚刚试跑的输出）

## 约束
- 不要对用户明显不关心的平台（比如一次性下载、登录墙页面）写脚本
- UpdatePlatformScript 之前必须有一次成功的 RunPlatformScript
- 脚本要精简，不追求覆盖所有边界情况（后续会继续迭代）
```

### 4. 导入流程的重构

**当前行为（要改掉）**：`tipc/article.ts` 的 `parseArticle` 固定解析成功后**无条件**提交 `PARSE_ARTICLE` 质量检查任务。

**新行为**：

```typescript
// tipc/article.ts 伪代码
async function parseArticle(url: string) {
  const rawHtml = await fetchRawHtml(url);
  const platform = detectPlatform(url);

  // Step 1: 尝试平台脚本
  const scriptResult = platform
    ? await tryPlatformScript(platform, url, rawHtml)
    : null;

  if (scriptResult?.ok) {
    // 脚本成功 → 直接保存，零 AI 成本
    const article = await saveArticleFromScript(url, rawHtml, scriptResult);
    await updateParseStatus(article.id, 'script_ok');
    appendHistory({ ..., triggeredAi: false });
    return { article };
  }

  // Step 2: 脚本失败 or 无脚本，走 Readability 兜底
  const fallback = await articleService.fetchAndParseArticle(url, rawHtml);

  // 成功 → 直接返回，不跑质量检查（新策略：不自动消耗 AI）
  if (fallback.success) {
    await updateParseStatus(fallback.meta.id, 'fixed');
    appendHistory({ ..., triggeredAi: false, reason: platform ? 'script_failed' : 'no_script' });
    return { article: fallback.meta };
  }

  // Step 3: Readability 也失败 → 启动 AI 调试任务
  await saveRawHtml(articleDir, rawHtml);
  await updateParseStatus(stubArticleId, 'ai_parsing');
  agentManager.submitTask({
    type: TaskType.PARSE_ARTICLE,
    payload: {
      articleId, articleDir, url, platform,
      skillsDir: getSkillsDir(),
      trigger: 'parse_failed',
      scriptError: scriptResult?.error,
    },
  });
  return { article: stubMeta, status: 'ai_parsing' };
}
```

**关键变化**：
- **移除**对所有成功文章的自动质量检查（用户选择的触发策略）
- **新增**"先试脚本再试 Readability"的链路
- AI 只在**全链路失败**时介入，这是 Worker 任务的唯一自动触发路径
- 脚本成功的文章在 `parseStatus` 用新值 `script_ok` 标记（区分于 Readability 的 `fixed`）

### 5. Worker 端的 handleParseArticleTask 改造

现在这个 handler 基本是对的，但要改：

1. **Prompt 要指向 Skill**：不再把 common.md 内容塞进 prompt，而是让 SDK 用 Skill 机制自动加载 `SKILL.md`（query options 的 `skills` 字段）。prompt 变得很短：

   ```
   触发原因：{trigger}
   文章：articleId={articleId}, articleDir={articleDir}, url={url}
   平台：{platform || '未识别'}
   脚本错误（如有）：{scriptError}
   skillsDir={skillsDir}

   使用 article-parser skill 里定义的调试循环完成解析。
   ```

2. **Skill 加载**：query options 里增加 `skills: { 'article-parser': skillsDir }`（根据 SDK 实际 API 名调整，确认下 `sdk.d.ts`）

3. **触发原因传递**：payload 增加 `trigger: 'script_failed' | 'parse_failed' | 'user_requested'` 字段，让 AI 知道为什么被调起

### 6. 主会话也能用同一个 Skill

用户在 AgentChat 说"帮我改下知乎脚本"时，路径：

1. `QueryBasedSession.start()` 在 `query()` options 里自动加载所有已注册的 skills，`article-parser` 就在其中
2. 该 Skill 声明的 MCP Server（`dogear-article-parse`）也自动注册
3. Agent 看到用户请求后，自主决定加载 Skill，按 SKILL.md 里的调试循环工作

**需要改造的地方**：
- `QueryBasedSession.ts` 里现在 MCP Server 和 Skill 注册是按需的，要把 `dogear-article-parse` 加到默认注册列表
- 允许的工具白名单（permissionRules 或 allowedTools）要把新增的 5 个 `mcp__dogear-article-parse__*` 加进去

### 7. 前端："解析历史"面板

这是你关心的"看不见历史"问题的解决方案。

**新增位置**：设置页新增一个 Tab「解析历史」，或者在 ArticlePreview 的 ParseStatusBadge 旁加个小按钮弹出对话框。

**组件**：`components/ArticleParseHistoryPanel.tsx`

**数据来源**：新增 tipc RPC `article/getParseHistory(limit: number)`，后端读 `history.jsonl` 尾部 N 条。

**UI 草图**：

```
┌──────────────────────────────────────────────────────────┐
│ 解析历史                                        [刷新]    │
├──────────────────────────────────────────────────────────┤
│ 2026-04-18 10:23 │ 知乎         │ AI 介入 │ 脚本新建 ✨ │
│   https://zhuanlan.zhihu.com/p/xxx                       │
│   触发：parse_failed                                      │
│   改动：新建 platforms/zhihu.py (2.1 KB)                  │
│   耗时：14.3s  tokens：3421                              │
│   [查看脚本] [查看差异] [查看原 HTML]                     │
├──────────────────────────────────────────────────────────┤
│ 2026-04-18 09:14 │ 微信公众号   │ AI 介入 │ 脚本修补 🔧 │
│   改动：wechat.py +12 -3 行                              │
│   ...                                                     │
└──────────────────────────────────────────────────────────┘
```

**最小版本先做**：纯表格，点击展开详情。脚本 diff 视图是增强项。

### 8. history.jsonl schema 扩展

```json
{
  "timestamp": "2026-04-18T10:23:00Z",
  "articleId": "uuid",
  "url": "https://...",
  "platform": "zhihu",
  "trigger": "script_failed | parse_failed | user_requested | auto",
  "triggeredAi": true,
  "scriptBefore": { "exists": false, "sizeBytes": 0 },
  "scriptAfter": { "exists": true, "sizeBytes": 2145, "isNew": true },
  "articleSaved": true,
  "parseStatus": "ai_enhanced",
  "durationMs": 14300,
  "tokensUsed": 3421,
  "error": null
}
```

---

## parseStatus 枚举扩展

```typescript
type ParseStatus =
  | 'script_ok'       // 新增：平台脚本解析成功（最快路径）
  | 'fixed'           // Readability 兜底成功
  | 'ai_parsing'      // AI 调试中
  | 'ai_enhanced'     // AI 调试完成并保存
  | 'quality_warning' // AI 也无法解析，保留原样
  | 'failed';         // 彻底失败
```

---

## 实现步骤（从零到跑通）

### Phase 0: 清理旧行为（~ 1 小时）
- 移除 `tipc/article.ts` 中"固定解析成功后无条件提交质量检查任务"的逻辑
- 保留 Worker 里的 `handleParseArticleTask` 但暂时只走 `parse_failed` 触发

### Phase 1: Python 运行时（~ 1 天）
- `python/article_parser/sdk.py`：封装 BeautifulSoup、markdownify、正则工具、`Result` 数据类
- `python/article_parser/runner.py`：沙箱加载、超时控制、错误包装
- `python/main.py`：注册 `run_article_script` RPC 方法
- `python/requirements.txt` 追加：beautifulsoup4、lxml、markdownify
- **测试**：手写 `platforms/_test_ok.py` 和 `platforms/_test_bad.py`，用 python-bridge 直接调用跑通

### Phase 2: 新增 MCP 工具（~ 半天）
- `ListPlatformScripts`、`ReadPlatformScript`、`RunPlatformScript`、`UpdatePlatformScript`、`ReadParseHistory`
- 路径安全校验、脚本大小限制、Python 语法预编译
- 在 `tool-registry.ts` 注册

### Phase 3: 打通 Worker 端新流程（~ 半天）
- 改写 `tipc/article.ts`：试脚本 → Readability 兜底 → AI 任务
- 扩展 `ParseArticlePayload` 增加 `trigger`、`scriptError`
- 改写 Worker `handleParseArticleTask`：prompt 简化，加载 Skill
- 扩展 history.jsonl schema

### Phase 4: SKILL.md 和初始脚本（~ 半天）
- 写 `SKILL.md`
- 从现有 `article-service.ts` 的微信特殊逻辑迁移出 `platforms/wechat.py`
- 手工验证：导入一篇微信长文 → 走脚本成功；故意改坏脚本 → AI 修回来

### Phase 5: 主会话集成（~ 半天）
- `QueryBasedSession` 注册 `dogear-article-parse` MCP Server
- 加载 article-parser Skill 到默认 skills 列表
- 验证：在 AgentChat 说"列出所有平台脚本"、"帮我看下 wechat.py 在干啥"

### Phase 6: 前端历史面板（~ 半天）
- 新增 RPC `article/getParseHistory`
- 新增 `ArticleParseHistoryPanel.tsx`
- 设置页挂一个「解析历史」Tab，或在 ParseStatusBadge 加 popover

### Phase 7: 打磨（按需）
- Badge 点击 → 跳转该文章的单条历史记录
- 脚本 diff 视图
- 平台检测扩展（`detectPlatform` 加更多域名映射）

---

## 风险与对策

| 风险 | 对策 |
|---|---|
| AI 写的脚本有死循环 / 无限递归 | runner.py 5 秒硬超时 |
| AI 脚本吃光内存 | Python 子进程独立，Electron 主进程不受影响；必要时加内存限制 |
| AI 反复修同一个脚本越修越差 | UpdatePlatformScript 前强制 RunPlatformScript 通过；history.jsonl 记录所有改动可回滚 |
| AI 写脚本时偷偷 import os | article_parser_sdk 是唯一允许的 import；加载前解析 AST 白名单校验 |
| 平台识别不准确（比如子域名） | `detectPlatform` 先做域名前缀匹配，留个 `other` 兜底走 Readability |
| history.jsonl 无限增长 | 达到 10 MB 后轮转到 `history.1.jsonl`，最多保留 3 份 |
| Python 子进程没起来 | python-bridge 已有的健康检查和自动重启沿用；起不来就降级到只走 Readability |

---

## 遗留问题（待实现期确认）

1. **Agent SDK 的 Skill API 具体名字**：`options.skills`？`options.skillDirs`？实现时查 `sdk.d.ts` 确认
2. **RestrictedPython vs 手写白名单**：Phase 1 开始前做个小 spike，看 RestrictedPython 能不能拦住 `__builtins__.__import__`。拦不住就手写 AST 扫描
3. **Windows 下 Python 超时实现**：`signal.alarm` 只在 Unix 有，Windows 要用 `multiprocessing` 或 `concurrent.futures` 做超时隔离，Phase 1 里验证
4. **主会话加载 Skill 的权限模式**：当前默认 `permissionMode: 'default'` 会对写操作问用户。新增的 `UpdatePlatformScript` 要不要走 auto-approve？建议在 `permissionRules.allow` 里加 `mcp__dogear-article-parse__UpdatePlatformScript`

---

## 对现有代码的影响清单

### 修改
- `electron/main/tipc/article.ts` — 重写 parseArticle 流程
- `electron/main/agents/agent-worker.ts` — handleParseArticleTask 简化，prompt 指向 Skill
- `electron/main/agents/tools/article-parse-tools.ts` — 追加 5 个新工具
- `electron/main/agents/task-types.ts` — ParseArticlePayload 增加 `trigger`、`scriptError`
- `electron/main/agents/query-based-session.ts` — 默认注册 article-parse MCP + Skill
- `electron/main/services/stock/python-bridge.ts` — 复用，无修改
- `python/main.py` — 注册新 RPC 方法
- `types/article.ts` — ParseStatus 枚举加 `script_ok`
- `components/ArticlePreview.tsx` — ParseStatusBadge 支持新状态

### 新增
- `.dogear/skills/article-parser/SKILL.md`
- `.dogear/skills/article-parser/platforms/wechat.py`（初始脚本）
- `python/article_parser/__init__.py`
- `python/article_parser/sdk.py`
- `python/article_parser/runner.py`
- `components/ArticleParseHistoryPanel.tsx`
- `electron/main/tipc/article.ts` 里新增 `getParseHistory` RPC

### 删除
- 无（V1 的 common.md 保留，继续作为"AI 的常识"参考）

---

## 小结

V2 相对 V1 的三大飞跃：
1. **规则从文档 → 可执行脚本**：自进化的产物是真正能跑的代码，而不是让 AI 下次重新理解一遍的自然语言
2. **AI 介入从"默认检查" → "兜底救援"**：只在确实解决不了时才花 token
3. **Skill 从"Worker 专属" → "全局能力"**：主会话的 Agent 也能加载同一套 Skill，用户能自然语言驱动迭代

这三点叠加起来，才是你最初想要的"自进化"形态——每一次 AI 介入都沉淀为下一次的零成本能力。
