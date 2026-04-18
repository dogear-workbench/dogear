# 文章解析 Skill V2 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把文章解析从"纯 AI 介入 + Markdown 规则"升级为"Python 脚本直出 + AI 只在脚本失败时调试并进化脚本"的自进化系统。

**Architecture:** 每个平台一个 Python 脚本（`.dogear/skills/article-parser/platforms/*.py`），主流程是"尝试脚本 → Readability 兜底 → AI 任务"。AI Worker 通过 MCP 工具读/试跑/落盘脚本，失败也沉淀成脚本。主会话 AgentChat 加载同一 Skill，用户可对话驱动迭代。

**Tech Stack:**
- Electron + TypeScript（主进程 / tipc / Agent Worker）
- Python 3 + BeautifulSoup + markdownify（脚本运行时）
- 复用现有 `python-bridge.ts`（JSON-RPC 守护进程）
- Claude Agent SDK `plugins: [{ type: 'local', path }]`（SKILL 加载）

**设计依据：** [docs/plans/2026-04/2026-04-18/article-parser-skill-v2-design.md](article-parser-skill-v2-design.md)

**执行约定：**
- 工作在 worktree `c:/dogear/.worktrees/article-parser-v2/`（分支 `feature/article-parser-v2`）
- 所有路径均相对 worktree 根目录
- 每个 Task 完成后立即 commit
- Phase 内部任务顺序不可打乱（有依赖）；跨 Phase 可并行评估但推荐顺序执行
- TDD 原则：能写单元测试的 Python 模块必写；TypeScript 端通过集成/手动验证

---

## Phase 0: 清理 V1 的自动触发行为

**目标：** 先把"所有成功文章都跑质量检查"的行为关掉，避免 V2 开发过程中还在消耗 token。

### Task 0.1: 停用 parseArticle 的自动质量检查提交

**Files:**
- Modify: `electron/main/tipc/article.ts:97-102`

**Step 1: 改动说明**

删掉 `parseArticle` 里 `submitQualityCheckTask(...)` 的调用。`submitQualityCheckTask` 函数保留（后续 Phase 3 还会用到，换参数）。

**Step 2: 修改**

把 `electron/main/tipc/article.ts:94-104` 这段：

```typescript
const result = await articleService.fetchAndParseArticle(input.url);
await articleService.saveArticle(workspace.path, result);

// 异步触发 AI 质量检查（后台静默执行，用户立即收到固定解析结果）
submitQualityCheckTask({
  articleId: result.meta.id,
  workspacePath: workspace.path,
  url: input.url,
});

return { article: result.meta };
```

改为：

```typescript
const result = await articleService.fetchAndParseArticle(input.url);
await articleService.saveArticle(workspace.path, result);

// V2: 固定解析成功后不再自动跑 AI 质量检查
// AI 只在 Phase 3 引入的"脚本 + Readability 双双失败"路径才介入
return { article: result.meta };
```

**Step 3: 同时修改 `submitQualityCheckTask` 函数**

将函数留着（改名 `submitAiParseTask`，接受 trigger 参数），但函数内不再构造 `fixedParseSuccess`。改为接收完整参数，之后 Phase 3 会补充调用点。

直接删除整个 `submitQualityCheckTask` 函数（第 47-81 行），Phase 3 会重新设计。

**Step 4: 编译验证**

Run: `bun run build:electron`
Expected: 无 TypeScript 报错

**Step 5: Commit**

```bash
git add electron/main/tipc/article.ts
git commit -m "chore(article): 停用自动质量检查（V2 重构准备）"
```

---

## Phase 1: Python 脚本运行时

**目标：** 在 Python 端搭好沙箱执行器和暴露给脚本的 SDK，让 `run_article_script` RPC 能跑。

### Task 1.1: 扩展 requirements.txt

**Files:**
- Modify: `python/requirements.txt`

**Step 1: 追加依赖**

文件末尾追加：

```
beautifulsoup4>=4.12
lxml>=5.0
markdownify>=0.12
```

**Step 2: 验证语法**

Run: `python3 -m pip install --dry-run -r python/requirements.txt` （或手动 `pip install`）
Expected: 无错误

**Step 3: 同步 python-bridge 依赖检测**

Modify: `electron/main/services/stock/python-bridge.ts:274`

现状：`const checkScript = 'import pandas,numpy,akshare,lark';`

改为：`const checkScript = 'import pandas,numpy,akshare,lark,bs4,lxml,markdownify';`

**Step 4: Commit**

```bash
git add python/requirements.txt electron/main/services/stock/python-bridge.ts
git commit -m "feat(python): 新增 BeautifulSoup/lxml/markdownify 依赖"
```

---

### Task 1.2: article_parser SDK（给用户脚本用的 API）

**Files:**
- Create: `python/article_parser/__init__.py`
- Create: `python/article_parser/sdk.py`

**Step 1: 写 __init__.py**

```python
"""文章解析用户脚本 SDK 入口。"""
from .sdk import soup, Result, extract_js_var, html_to_markdown

__all__ = ['soup', 'Result', 'extract_js_var', 'html_to_markdown']
```

**Step 2: 写 sdk.py（含完整实现）**

```python
"""
article_parser_sdk — 暴露给用户平台脚本的 API。

用户脚本只能 from article_parser_sdk import ...，不能 import 其他 stdlib 或三方包。
执行环境由 article_parser/runner.py 强制限制。
"""
from __future__ import annotations
import re
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Result:
    """平台脚本的统一返回格式。"""
    title: str
    content: str                         # Markdown 正文
    author: Optional[str] = None
    site_name: Optional[str] = None
    excerpt: Optional[str] = None        # 摘要，不超过 200 字符
    language: Optional[str] = None       # 如 'zh', 'en'
    extras: dict = field(default_factory=dict)  # 预留扩展字段

    def to_dict(self) -> dict:
        return {
            'title': self.title,
            'content': self.content,
            'author': self.author,
            'site_name': self.site_name,
            'excerpt': self.excerpt,
            'language': self.language,
            'extras': dict(self.extras),
        }


def soup(html: str):
    """返回 BeautifulSoup 对象（lxml 解析器）。"""
    from bs4 import BeautifulSoup
    return BeautifulSoup(html, 'lxml')


def html_to_markdown(element_or_html) -> str:
    """
    把 BeautifulSoup 元素或 HTML 字符串转 Markdown。
    使用 markdownify 的默认选项，保留 code/pre/blockquote/图片等。
    """
    from markdownify import markdownify as md
    raw = str(element_or_html) if not isinstance(element_or_html, str) else element_or_html
    return md(raw, heading_style='ATX').strip()


_JS_VAR_PATTERNS = [
    # 精确匹配：var_name = '...'
    r"{name}\s*=\s*['\"]([\s\S]*?)['\"]",
    # 对象字段：var_name: '...'
    r"{name}\s*:\s*['\"]([\s\S]*?)['\"]",
]


def extract_js_var(html: str, var_name: str, nested_field: Optional[str] = None) -> Optional[str]:
    """
    从 <script> 块中提取 JS 变量的字符串值。

    - extract_js_var(html, 'msg_title') → 匹配 msg_title = '...' 或 msg_title: '...'
    - extract_js_var(html, 'text_page_info', 'content') → 找到 text_page_info 对象，取其 content 字段
    """
    if nested_field:
        # 先切到对象块
        block_pattern = r"{outer}\s*[:=]\s*\{{([\s\S]*?)\}}".format(outer=re.escape(var_name))
        block_match = re.search(block_pattern, html)
        if not block_match:
            return None
        block = block_match.group(1)
        for p in _JS_VAR_PATTERNS:
            m = re.search(p.format(name=re.escape(nested_field)), block)
            if m:
                return _decode_js_escapes(m.group(1))
        return None

    for p in _JS_VAR_PATTERNS:
        m = re.search(p.format(name=re.escape(var_name)), html)
        if m:
            return _decode_js_escapes(m.group(1))
    return None


def _decode_js_escapes(s: str) -> str:
    """解码 \\xNN 这种 JS 转义序列。不处理 JsDecode() 等平台私有函数。"""
    return re.sub(
        r'\\x([0-9a-fA-F]{2})',
        lambda m: chr(int(m.group(1), 16)),
        s,
    )
```

**Step 3: Commit**

```bash
git add python/article_parser/__init__.py python/article_parser/sdk.py
git commit -m "feat(python): 新增 article_parser SDK（soup/Result/extract_js_var/html_to_markdown）"
```

---

### Task 1.3: Python 沙箱执行器

**Files:**
- Create: `python/article_parser/runner.py`

**Step 1: 设计要点**
- 用 `importlib.util.spec_from_file_location` 按路径加载脚本
- 加载前**扫描 AST**，拦截非白名单 import（只允许 `article_parser_sdk`）
- 超时：用 `threading.Timer` 监控，超时杀子线程（Windows/Unix 通用）
- 脚本报错 → 返回 `{ok: False, error_type, error_message, traceback, stdout}`，不抛异常

**Step 2: 写 runner.py**

```python
"""
平台脚本沙箱执行器。

进入点：run_script(script_path_or_content, url, html, timeout_ms)
返回：
  - 成功：{'ok': True, 'title': ..., 'content': ..., ...}
  - 失败：{'ok': False, 'error_type': ..., 'error_message': ..., 'traceback': ..., 'stdout': ...}
  - 超时：{'ok': False, 'error_type': 'TimeoutError', ...}

安全约束：
- 脚本顶层 import 只允许 article_parser_sdk（AST 预扫描）
- 不允许 exec/eval/compile/__import__（AST 拦截）
- 不提供 __builtins__.open（替换内置）
"""
from __future__ import annotations
import ast
import io
import sys
import time
import traceback
import threading
import importlib.util
from contextlib import redirect_stdout
from dataclasses import dataclass, field
from typing import Optional


# 白名单：脚本顶层可以 import 的模块前缀
ALLOWED_IMPORTS = {'article_parser_sdk'}

# 禁用的内置函数
BLOCKED_BUILTINS = {'eval', 'exec', 'compile', '__import__', 'open'}


class ScriptSecurityError(Exception):
    """脚本安全检查失败（非白名单 import 等）。"""


@dataclass
class ArticleContext:
    url: str
    html: str


@dataclass
class RunResult:
    ok: bool
    title: Optional[str] = None
    content: Optional[str] = None
    author: Optional[str] = None
    site_name: Optional[str] = None
    excerpt: Optional[str] = None
    language: Optional[str] = None
    extras: dict = field(default_factory=dict)
    stdout: str = ''
    duration_ms: int = 0
    error_type: Optional[str] = None
    error_message: Optional[str] = None
    traceback: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            'ok': self.ok,
            'title': self.title,
            'content': self.content,
            'author': self.author,
            'site_name': self.site_name,
            'excerpt': self.excerpt,
            'language': self.language,
            'extras': self.extras,
            'stdout': self.stdout,
            'duration_ms': self.duration_ms,
            'error_type': self.error_type,
            'error_message': self.error_message,
            'traceback': self.traceback,
        }


def _validate_ast(source: str, script_name: str) -> None:
    """AST 扫描：拦截危险 import 和调用。"""
    try:
        tree = ast.parse(source, filename=script_name)
    except SyntaxError as e:
        raise ScriptSecurityError(f'语法错误: {e}')

    for node in ast.walk(tree):
        # import xxx
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split('.')[0]
                if root not in ALLOWED_IMPORTS:
                    raise ScriptSecurityError(
                        f'禁止 import {alias.name}。只允许：{sorted(ALLOWED_IMPORTS)}'
                    )
        # from xxx import yyy
        elif isinstance(node, ast.ImportFrom):
            if node.module is None:
                raise ScriptSecurityError('禁止相对 import')
            root = node.module.split('.')[0]
            if root not in ALLOWED_IMPORTS:
                raise ScriptSecurityError(
                    f'禁止 from {node.module} import ...。只允许：{sorted(ALLOWED_IMPORTS)}'
                )
        # 禁用内置函数的直接调用
        elif isinstance(node, ast.Call):
            fn = node.func
            if isinstance(fn, ast.Name) and fn.id in BLOCKED_BUILTINS:
                raise ScriptSecurityError(f'禁止调用内置函数 {fn.id}')


def _load_module(script_path: Optional[str], source: Optional[str], name: str):
    """加载脚本为模块（根据是路径还是源码选择加载方式）。"""
    if source is not None:
        # 临时模块，不落盘
        spec = importlib.util.spec_from_loader(name, loader=None)
        module = importlib.util.module_from_spec(spec)
        code = compile(source, f'<{name}>', 'exec')
        exec(code, module.__dict__)
        return module

    spec = importlib.util.spec_from_file_location(name, script_path)
    if spec is None or spec.loader is None:
        raise ScriptSecurityError(f'无法加载脚本: {script_path}')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_with_timeout(target, timeout_ms: int):
    """在子线程里跑 target()，超时返回 TimeoutError。"""
    result_holder = {}

    def wrapper():
        try:
            result_holder['value'] = target()
        except BaseException as e:
            result_holder['error'] = e

    t = threading.Thread(target=wrapper, daemon=True)
    t.start()
    t.join(timeout=timeout_ms / 1000.0)
    if t.is_alive():
        # 无法强制 kill Python 线程，但 daemon=True 保证进程退出时一起结束
        raise TimeoutError(f'脚本执行超过 {timeout_ms}ms')
    if 'error' in result_holder:
        raise result_holder['error']
    return result_holder.get('value')


def run_script(
    *,
    script_path: Optional[str] = None,
    script_content: Optional[str] = None,
    url: str,
    html: str,
    timeout_ms: int = 5000,
) -> RunResult:
    """执行平台脚本。script_path 和 script_content 二选一。"""
    start = time.time()
    stdout_capture = io.StringIO()

    # 1. 获取源码（给 AST 扫描）
    if script_content is None:
        if script_path is None:
            return RunResult(
                ok=False,
                error_type='ValueError',
                error_message='必须提供 script_path 或 script_content',
            )
        try:
            with open(script_path, 'r', encoding='utf-8') as f:
                source = f.read()
        except Exception as e:
            return RunResult(
                ok=False,
                error_type=type(e).__name__,
                error_message=f'读取脚本失败: {e}',
                traceback=traceback.format_exc(),
            )
    else:
        source = script_content

    # 2. AST 安全扫描
    try:
        _validate_ast(source, script_path or '<inline>')
    except ScriptSecurityError as e:
        return RunResult(
            ok=False,
            error_type='ScriptSecurityError',
            error_message=str(e),
            duration_ms=int((time.time() - start) * 1000),
        )

    # 3. 执行 extract(ctx)
    def target():
        with redirect_stdout(stdout_capture):
            module = _load_module(
                script_path if script_content is None else None,
                source if script_content is not None else None,
                name='_article_parser_user_script',
            )
            if not hasattr(module, 'extract'):
                raise AttributeError('脚本必须定义 extract(ctx) 函数')
            ctx = ArticleContext(url=url, html=html)
            return module.extract(ctx)

    try:
        user_result = _run_with_timeout(target, timeout_ms)
    except TimeoutError as e:
        return RunResult(
            ok=False,
            error_type='TimeoutError',
            error_message=str(e),
            stdout=stdout_capture.getvalue(),
            duration_ms=timeout_ms,
        )
    except BaseException as e:
        return RunResult(
            ok=False,
            error_type=type(e).__name__,
            error_message=str(e),
            traceback=traceback.format_exc(),
            stdout=stdout_capture.getvalue(),
            duration_ms=int((time.time() - start) * 1000),
        )

    # 4. 规范化返回
    duration_ms = int((time.time() - start) * 1000)
    try:
        # Result 对象或 dict 都支持
        if hasattr(user_result, 'to_dict'):
            d = user_result.to_dict()
        elif isinstance(user_result, dict):
            d = user_result
        else:
            raise TypeError(
                f'extract() 必须返回 Result 或 dict，得到 {type(user_result).__name__}'
            )

        if not d.get('title'):
            return RunResult(
                ok=False,
                error_type='ValueError',
                error_message='extract() 返回的 title 为空',
                stdout=stdout_capture.getvalue(),
                duration_ms=duration_ms,
            )
        if not d.get('content') or len(d['content'].strip()) < 50:
            return RunResult(
                ok=False,
                error_type='ValueError',
                error_message=f'extract() 返回的 content 过短（{len(d.get("content") or "")} 字符）',
                stdout=stdout_capture.getvalue(),
                duration_ms=duration_ms,
            )

        return RunResult(
            ok=True,
            title=d['title'],
            content=d['content'],
            author=d.get('author'),
            site_name=d.get('site_name'),
            excerpt=d.get('excerpt'),
            language=d.get('language'),
            extras=d.get('extras', {}),
            stdout=stdout_capture.getvalue(),
            duration_ms=duration_ms,
        )
    except Exception as e:
        return RunResult(
            ok=False,
            error_type=type(e).__name__,
            error_message=str(e),
            traceback=traceback.format_exc(),
            stdout=stdout_capture.getvalue(),
            duration_ms=duration_ms,
        )
```

**Step 3: 让 sdk.py 能作为 article_parser_sdk 被 import**

在 `python/main.py` 启动时注册别名，让用户脚本能写 `from article_parser_sdk import ...`。

Modify: `python/main.py`（在 import 顶部附近）追加：

```python
# 让用户平台脚本能用 `from article_parser_sdk import ...`
import sys
from article_parser import sdk as _article_parser_sdk
sys.modules['article_parser_sdk'] = _article_parser_sdk
```

**Step 4: 写单元测试**

Create: `python/tests/test_article_parser_runner.py`

```python
"""runner.py 的单元测试。"""
import sys
from pathlib import Path

# 让测试能找到 python/ 下的模块
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# 注册 article_parser_sdk 别名（与 main.py 保持一致）
from article_parser import sdk as _sdk
sys.modules['article_parser_sdk'] = _sdk

from article_parser.runner import run_script


OK_SCRIPT = """
from article_parser_sdk import Result

def extract(ctx):
    return Result(title='Hello', content='x' * 100)
"""

MISSING_TITLE_SCRIPT = """
from article_parser_sdk import Result

def extract(ctx):
    return Result(title='', content='x' * 100)
"""

SHORT_CONTENT_SCRIPT = """
from article_parser_sdk import Result

def extract(ctx):
    return Result(title='T', content='short')
"""

CRASH_SCRIPT = """
from article_parser_sdk import Result

def extract(ctx):
    raise ValueError('boom')
"""

BANNED_IMPORT_SCRIPT = """
import os

def extract(ctx):
    return {'title': 'T', 'content': 'x' * 100}
"""

BANNED_CALL_SCRIPT = """
from article_parser_sdk import Result

def extract(ctx):
    exec('print(1)')
    return Result(title='T', content='x' * 100)
"""

TIMEOUT_SCRIPT = """
import time  # 这会被 AST 拦截；先测 eval 的超时，换个更合法的死循环
"""

LEGAL_INFINITE_LOOP = """
from article_parser_sdk import Result

def extract(ctx):
    while True:
        pass
"""


def _run(src, **kw):
    return run_script(script_content=src, url='x', html='y', **kw)


def test_ok_script():
    r = _run(OK_SCRIPT)
    assert r.ok, r.error_message
    assert r.title == 'Hello'


def test_missing_title():
    r = _run(MISSING_TITLE_SCRIPT)
    assert not r.ok
    assert r.error_type == 'ValueError'


def test_short_content():
    r = _run(SHORT_CONTENT_SCRIPT)
    assert not r.ok
    assert '过短' in r.error_message


def test_crash_script():
    r = _run(CRASH_SCRIPT)
    assert not r.ok
    assert r.error_type == 'ValueError'
    assert 'boom' in r.error_message
    assert r.traceback  # 有 traceback


def test_banned_import():
    r = _run(BANNED_IMPORT_SCRIPT)
    assert not r.ok
    assert r.error_type == 'ScriptSecurityError'


def test_banned_call():
    r = _run(BANNED_CALL_SCRIPT)
    assert not r.ok
    assert r.error_type == 'ScriptSecurityError'


def test_timeout():
    r = _run(LEGAL_INFINITE_LOOP, timeout_ms=200)
    assert not r.ok
    assert r.error_type == 'TimeoutError'
```

**Step 5: 跑测试**

Run: `cd python && python3 -m pytest tests/test_article_parser_runner.py -v`
Expected: 所有测试通过（如没装 pytest，先 `pip install pytest`）

如果 pytest 不方便安装，退而求其次跑：
`cd python && python3 -m unittest tests.test_article_parser_runner`（把上面的函数改成 unittest 风格；**不强制**，能跑 pytest 就 pytest）

**Step 6: Commit**

```bash
git add python/article_parser/runner.py python/main.py python/tests/test_article_parser_runner.py
git commit -m "feat(python): article_parser 沙箱执行器 + AST 安全扫描 + 单元测试"
```

---

### Task 1.4: 在 python/main.py 注册 run_article_script RPC

**Files:**
- Modify: `python/main.py`

**Step 1: 新增 handler**

在 `python/main.py` 的 `METHOD_HANDLERS` 之前新增：

```python
def handle_run_article_script(request_id: str, params: dict):
    """
    执行平台脚本。
    params:
      script_path: str | None — 脚本文件路径（二选一）
      script_content: str | None — 直接传入的脚本源码（二选一）
      url: str
      html: str
      timeout_ms: int (default 5000)
    """
    from article_parser.runner import run_script

    script_path = params.get('script_path')
    script_content = params.get('script_content')
    url = params.get('url', '')
    html = params.get('html', '')
    timeout_ms = int(params.get('timeout_ms', 5000))

    if not script_path and not script_content:
        send_error(request_id, -1, '必须提供 script_path 或 script_content')
        return
    if not html:
        send_error(request_id, -1, '缺少 html 参数')
        return

    # 限制 timeout_ms 在合理范围
    timeout_ms = max(100, min(timeout_ms, 30_000))

    result = run_script(
        script_path=script_path,
        script_content=script_content,
        url=url,
        html=html,
        timeout_ms=timeout_ms,
    )
    send_response(request_id, result.to_dict())
```

在 `METHOD_HANDLERS` dict 里新增一行：

```python
"run_article_script": handle_run_article_script,
```

**Step 2: 手动冒烟测试**

Run: `cd python && python3 main.py` 然后从另一个 terminal 或脚本喂一条 JSON 请求（可暂时用 Python repl 手动喂）。这步**非必须**，下一个 Phase 的 TS 调用会跑通。

**Step 3: Commit**

```bash
git add python/main.py
git commit -m "feat(python): 注册 run_article_script RPC"
```

---

## Phase 2: Skill 目录结构 + 初始平台脚本

**目标：** 把 `.dogear/skills/article-parser/` 改造成 SDK 认可的 Skill 插件结构，迁移微信为 Python 脚本。

### Task 2.1: 改造 article-parser-skills-service 以支持 Python 脚本

**Files:**
- Modify: `electron/main/services/article-parser-skills-service.ts`

**Step 1: 现状理解**

当前 `ensureSkillsInitialized()` 只写 `common.md` / `wechat.md` / `history.jsonl`。V2 要：
- 保留 `common.md`（AI 看的知识）
- **不再**自动创建 `wechat.md`（被 `wechat.py` 取代）
- 新增 `SKILL.md` 入口文件
- 新增 `platforms/wechat.py`（初始脚本，幂等不覆盖）

**Step 2: 新增常量**

在 `article-parser-skills-service.ts` 文件开头追加：

```typescript
const SKILL_MD = `---
name: article-parser
description: 从网络文章 HTML 中提取标题、正文、作者等结构化内容。当用户导入文章失败、解析质量不佳，或用户明确要求调整某平台解析逻辑时使用此 Skill。
---

# 文章解析 Skill

## 何时使用
- 后台 PARSE_ARTICLE 任务触发（脚本或 Readability 解析失败）
- 用户在对话中说「xx 平台解析不对」「帮我改下 xx 脚本」

## 可用 MCP 工具（dogear-article-parse）
- ReadRawHtml / ReadCurrentContent — 看原料和已解析结果
- ListPlatformScripts / ReadPlatformScript — 看已有平台脚本
- RunPlatformScript — 试跑脚本（支持 scriptContent 试跑候选，不落盘）
- UpdatePlatformScript — 落盘脚本（仅在试跑通过后调用）
- SaveParsedArticle — 保存当前这篇文章的解析结果
- ReadParseHistory — 看最近的解析历史，辅助判断是否有规律性失败

## 调试循环

遇到解析问题时，严格按下列步骤：

1. **诊断**：ReadRawHtml 和 ReadCurrentContent 了解问题
2. **查旧**：ListPlatformScripts → 若有脚本则 ReadPlatformScript 读出来
3. **写候选**：基于 HTML 结构编写新/改进的 extract() 函数
   - 必须 from article_parser_sdk import，不允许 import os/requests 等
   - 返回 Result(title=..., content=..., author=..., site_name=...)
   - content 必须是 Markdown 格式
4. **试跑**：RunPlatformScript(scriptContent=候选源码) 试跑
   - 失败 → 读 traceback，修改，再试（最多 5 轮）
   - 成功 → 检查 title 非空、content ≥ 200 字符、内容合理
5. **落盘**：UpdatePlatformScript(platform, content=脚本最终版) 写入
6. **保存当前文章**：SaveParsedArticle(title, content, ...)

## 约束
- 脚本存在且有效时优先用脚本解析
- 不要为登录墙/反爬页面写脚本，直接报告失败
- UpdatePlatformScript 之前必须有一次成功的 RunPlatformScript
- 脚本保持精简，不追求覆盖所有边缘场景
- 禁止修改 SKILL.md 和 common.md（工具路径白名单已拒绝）

## 常识参考
common.md 里记录了通用的 HTML 预处理和元数据提取常识，可用 ReadParserRules 加载作为参考。
`;

const WECHAT_PY = `"""
微信公众号 (mp.weixin.qq.com) 解析脚本。

关键模式：
- 长文章：正文在 #js_content 或 .rich_media_content 里
- 短内容（type 9）：不在 DOM，而在 <script> 里的 text_page_info.content
- 图片懒加载：data-src 优先于 src
"""
from article_parser_sdk import soup, Result, extract_js_var, html_to_markdown


def extract(ctx):
    doc = soup(ctx.html)

    # 修复懒加载：data-src 复制到 src
    for img in doc.find_all('img'):
        if img.get('data-src') and not img.get('src'):
            img['src'] = img['data-src']

    # 路径 1：长文章标准模式
    body = doc.select_one('#js_content') or doc.select_one('.rich_media_content')
    if body and len(body.get_text(strip=True)) > 50:
        title_tag = doc.select_one('#activity-name') or doc.select_one('h1')
        title = title_tag.get_text(strip=True) if title_tag else None

        author_tag = doc.select_one('#js_name') or doc.select_one('.rich_media_meta_nickname')
        author = author_tag.get_text(strip=True) if author_tag else None

        if title:
            return Result(
                title=title,
                content=html_to_markdown(body),
                author=author,
                site_name='微信公众号',
            )

    # 路径 2：短内容（type 9）
    short_content = extract_js_var(ctx.html, 'text_page_info', 'content')
    if short_content and len(short_content.strip()) > 20:
        title = extract_js_var(ctx.html, 'msg_title') or '(微信短内容)'
        author = extract_js_var(ctx.html, 'nick_name')
        return Result(
            title=title,
            content=short_content,
            author=author,
            site_name='微信公众号',
        )

    raise ValueError('无法识别的微信文章结构')
`;
```

**Step 3: 改造 ensureSkillsInitialized()**

完全替换函数体：

```typescript
export async function ensureSkillsInitialized(): Promise<void> {
  const skillsDir = getArticleParserSkillsDir();
  const platformsDir = path.join(skillsDir, 'platforms');

  await fs.mkdir(platformsDir, { recursive: true });

  const skillPath = path.join(skillsDir, 'SKILL.md');
  const commonPath = path.join(skillsDir, 'common.md');
  const wechatPyPath = path.join(platformsDir, 'wechat.py');
  const historyPath = path.join(skillsDir, 'history.jsonl');

  if (!(await fileExists(skillPath))) {
    await safeFileWrite(skillPath, SKILL_MD);
  }
  if (!(await fileExists(commonPath))) {
    await safeFileWrite(commonPath, COMMON_MD);
  }
  if (!(await fileExists(wechatPyPath))) {
    await safeFileWrite(wechatPyPath, WECHAT_PY);
  }
  if (!(await fileExists(historyPath))) {
    await fs.writeFile(historyPath, '', 'utf-8');
  }
}
```

**Step 4: 删除不再使用的 WECHAT_MD 常量**

删除文件中的 `const WECHAT_MD = ...` 整个常量（第 94-121 行）。

**Step 5: 编译验证**

Run: `bun run build:electron`
Expected: 无 TS 报错

**Step 6: Commit**

```bash
git add electron/main/services/article-parser-skills-service.ts
git commit -m "feat(skills): Skill 目录引入 SKILL.md + platforms/wechat.py 初始脚本"
```

---

### Task 2.2: 实施后一次性迁移老用户目录

**Files:**
- 无代码改动，纯运行时自检

**Step 1: 手动清理（仅开发者本机）**

开发者本机运行一次：

```bash
# 如果已有老的 wechat.md，删掉让脚本初始化接手
rm -f c:/dogear/.dogear/skills/article-parser/platforms/wechat.md 2>/dev/null
# SKILL.md 和 wechat.py 会在下次 ensureSkillsInitialized() 时自动生成
```

**注意**：生产用户第一次启动也能正确初始化（因为 `ensureSkillsInitialized` 只看"文件不存在"）。老的 `wechat.md` 如果存在不会被删，但 V2 流程不再读它。Task 3.x 的新工具完全不看 Markdown 平台规则。

**Step 2: 不 commit**（纯本机操作）

---

## Phase 3: MCP 工具扩展

**目标：** 在现有 `article-parse-tools.ts` 里新增 4 个工具（List/Read/Run/UpdatePlatformScript），改造 2 个（SaveParsedArticle 保留，UpdateParserRule 弃用/删除），新增 ReadParseHistory。

### Task 3.1: 新增 ListPlatformScripts / ReadPlatformScript 工具

**Files:**
- Modify: `electron/main/agents/tools/article-parse-tools.ts`

**Step 1: 在文件头部引入 path + 保留**

已有 `import path from 'path';`、`import fs from 'fs/promises';`、`assertPathSafe`。直接沿用。

**Step 2: 在 registerTools([...]) 里追加新工具元数据**

在现有 registerTools 的数组追加 4 个条目：

```typescript
  { name: 'ListPlatformScripts', description: '列出所有已有的平台脚本文件',                       server: 'dogear-article-parse', category: 'article' },
  { name: 'ReadPlatformScript',  description: '读取单个平台脚本的源码',                          server: 'dogear-article-parse', category: 'article' },
  { name: 'RunPlatformScript',   description: '在 Python 沙箱里试跑脚本（支持候选源码，不落盘）', server: 'dogear-article-parse', category: 'article' },
  { name: 'UpdatePlatformScript', description: '落盘平台脚本文件（仅在 RunPlatformScript 成功后调用）', server: 'dogear-article-parse', category: 'article' },
  { name: 'ReadParseHistory',    description: '读取最近 N 条解析历史',                            server: 'dogear-article-parse', category: 'article' },
```

**同时移除**旧的 `UpdateParserRule` 元数据条目（保留兼容的话注释掉；直接删更干净）。

**Step 3: 在 createArticleParseMcpServer().tools 数组里追加 5 个新工具**

顺着现有 `tool(...)` 的写法，在 `UpdateParserRule` 后面追加：

```typescript
      // ===== 工具 6: ListPlatformScripts =====
      tool(
        'ListPlatformScripts',
        '列出所有已有的平台脚本（*.py 文件）',
        {
          skillsDir: z.string().describe('Skill 规则目录的绝对路径'),
        },
        async (args) => {
          try {
            const dir = path.join(args.skillsDir, 'platforms');
            assertPathSafe(dir, args.skillsDir);
            const entries = await fs.readdir(dir).catch(() => []);
            const scripts = entries
              .filter((n) => n.endsWith('.py'))
              .map((n) => n.slice(0, -3));
            const details = await Promise.all(scripts.map(async (p) => {
              const st = await fs.stat(path.join(dir, p + '.py'));
              return {
                platform: p,
                path: `platforms/${p}.py`,
                sizeBytes: st.size,
                lastModified: st.mtime.toISOString(),
              };
            }));
            return {
              content: [{
                type: 'text' as const,
                text: details.length
                  ? `已有 ${details.length} 个平台脚本:\n\n\`\`\`json\n${JSON.stringify(details, null, 2)}\n\`\`\``
                  : '暂无平台脚本。',
              }],
            };
          } catch (error) {
            return { content: [{ type: 'text' as const, text: `❌ 列出脚本失败: ${error}` }], isError: true };
          }
        }
      ),

      // ===== 工具 7: ReadPlatformScript =====
      tool(
        'ReadPlatformScript',
        '读取单个平台脚本的源码',
        {
          skillsDir: z.string().describe('Skill 规则目录的绝对路径'),
          platform:  z.string().describe('平台名称（如 "wechat"）'),
        },
        async (args) => {
          try {
            if (!/^[a-z0-9_-]{1,32}$/.test(args.platform)) {
              return { content: [{ type: 'text' as const, text: `❌ platform 名称不合法: ${args.platform}` }], isError: true };
            }
            const p = path.join(args.skillsDir, 'platforms', `${args.platform}.py`);
            assertPathSafe(p, args.skillsDir);
            const content = await fs.readFile(p, 'utf-8').catch(() => null);
            if (content === null) {
              return { content: [{ type: 'text' as const, text: `该平台暂无脚本：platforms/${args.platform}.py 不存在` }] };
            }
            return {
              content: [{
                type: 'text' as const,
                text: `# platforms/${args.platform}.py (${Buffer.byteLength(content, 'utf-8')} 字节)\n\n\`\`\`python\n${content}\n\`\`\``,
              }],
            };
          } catch (error) {
            return { content: [{ type: 'text' as const, text: `❌ 读取脚本失败: ${error}` }], isError: true };
          }
        }
      ),

      // ===== 工具 8: RunPlatformScript =====
      tool(
        'RunPlatformScript',
        '在 Python 沙箱里试跑平台脚本。支持两种模式：\n' +
        '- 生产模式：传 skillsDir+platform+articleDir，跑已落盘的脚本对当前 raw.html\n' +
        '- 调试模式：传 scriptContent+articleDir，跑候选源码（不落盘）对当前 raw.html',
        {
          articleDir:    z.string().describe('文章目录的绝对路径（用来读 raw.html）'),
          skillsDir:     z.string().optional().describe('Skill 目录（生产模式必填）'),
          platform:      z.string().optional().describe('平台名称（生产模式必填）'),
          scriptContent: z.string().optional().describe('脚本源码（调试模式必填）'),
          timeoutMs:     z.number().optional().default(5000).describe('超时毫秒数，默认 5000'),
        },
        async (args) => {
          try {
            // 读 raw.html
            const htmlPath = path.join(args.articleDir, 'raw.html');
            const html = await fs.readFile(htmlPath, 'utf-8').catch(() => null);
            if (html === null) {
              return { content: [{ type: 'text' as const, text: `❌ raw.html 不存在：${htmlPath}` }], isError: true };
            }

            // 读 url（从 meta.json）
            const metaRaw = await fs.readFile(path.join(args.articleDir, 'meta.json'), 'utf-8').catch(() => '{}');
            const meta = JSON.parse(metaRaw);
            const url = meta.url || '';

            // 构造 Python 请求参数
            let params: Record<string, unknown> = { url, html, timeout_ms: args.timeoutMs };
            if (args.scriptContent) {
              params.script_content = args.scriptContent;
            } else if (args.skillsDir && args.platform) {
              if (!/^[a-z0-9_-]{1,32}$/.test(args.platform)) {
                return { content: [{ type: 'text' as const, text: `❌ platform 名称不合法: ${args.platform}` }], isError: true };
              }
              params.script_path = path.join(args.skillsDir, 'platforms', `${args.platform}.py`);
            } else {
              return { content: [{ type: 'text' as const, text: '❌ 必须提供 scriptContent 或 (skillsDir + platform)' }], isError: true };
            }

            const { pythonBridge } = await import('../../services/stock/python-bridge.js');
            const result = await pythonBridge.call<any>('run_article_script', params, 30_000);

            // 截断 content 防 token 炸
            const previewContent = typeof result.content === 'string' && result.content.length > 2000
              ? result.content.slice(0, 2000) + '\n\n[已截断，总长 ' + result.content.length + ' 字符]'
              : result.content;

            return {
              content: [{
                type: 'text' as const,
                text: `## 脚本执行结果\n\n\`\`\`json\n${JSON.stringify({
                  ok: result.ok,
                  title: result.title,
                  author: result.author,
                  site_name: result.site_name,
                  excerpt: result.excerpt,
                  language: result.language,
                  duration_ms: result.duration_ms,
                  error_type: result.error_type,
                  error_message: result.error_message,
                  stdout: result.stdout,
                }, null, 2)}\n\`\`\`\n\n${result.ok ? '## 正文预览\n\n' + previewContent : '## Traceback\n\n```\n' + (result.traceback || '(无)') + '\n```'}`,
              }],
            };
          } catch (error) {
            return { content: [{ type: 'text' as const, text: `❌ RunPlatformScript 失败: ${error}` }], isError: true };
          }
        }
      ),

      // ===== 工具 9: UpdatePlatformScript =====
      tool(
        'UpdatePlatformScript',
        '落盘平台脚本。只在 RunPlatformScript 试跑成功后调用。\n' +
        '路径白名单：只能写 platforms/<name>.py；name 必须是 [a-z0-9_-]{1,32}。',
        {
          skillsDir: z.string().describe('Skill 目录的绝对路径'),
          platform:  z.string().describe('平台名称'),
          content:   z.string().describe('脚本完整源码（UTF-8）'),
        },
        async (args) => {
          try {
            if (!/^[a-z0-9_-]{1,32}$/.test(args.platform)) {
              return { content: [{ type: 'text' as const, text: `❌ platform 名称不合法: ${args.platform}` }], isError: true };
            }
            const bytes = Buffer.byteLength(args.content, 'utf-8');
            if (bytes > 20 * 1024) {
              return { content: [{ type: 'text' as const, text: `❌ 脚本过大（${bytes} 字节），上限 20 KB` }], isError: true };
            }
            // 语法预检（调 Python）
            const { pythonBridge } = await import('../../services/stock/python-bridge.js');
            const dryrun = await pythonBridge.call<any>('run_article_script', {
              script_content: args.content,
              url: 'https://example.com/__syntax_check__',
              html: '<html><body>dry</body></html>',
              timeout_ms: 2000,
            }, 10_000);
            // dryrun 只要不是 SyntaxError / ScriptSecurityError 就算语法/安全 OK；业务错误允许
            if (dryrun.error_type === 'SyntaxError' || dryrun.error_type === 'ScriptSecurityError') {
              return {
                content: [{
                  type: 'text' as const,
                  text: `❌ 脚本预检失败：${dryrun.error_type} — ${dryrun.error_message}`,
                }],
                isError: true,
              };
            }

            const targetPath = path.join(args.skillsDir, 'platforms', `${args.platform}.py`);
            assertPathSafe(targetPath, args.skillsDir);
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            await safeFileWrite(targetPath, args.content);

            return {
              content: [{
                type: 'text' as const,
                text: `✅ 已保存：platforms/${args.platform}.py（${bytes} 字节）`,
              }],
            };
          } catch (error) {
            return { content: [{ type: 'text' as const, text: `❌ 保存脚本失败: ${error}` }], isError: true };
          }
        }
      ),

      // ===== 工具 10: ReadParseHistory =====
      tool(
        'ReadParseHistory',
        '读取最近 N 条解析历史（history.jsonl 的尾部）',
        {
          skillsDir: z.string().describe('Skill 目录的绝对路径'),
          limit:     z.number().optional().default(20).describe('读取条数，默认 20'),
        },
        async (args) => {
          try {
            const p = path.join(args.skillsDir, 'history.jsonl');
            const raw = await fs.readFile(p, 'utf-8').catch(() => '');
            const lines = raw.split('\n').filter((l) => l.trim()).slice(-args.limit);
            const entries = lines.map((l) => {
              try { return JSON.parse(l); } catch { return { raw: l }; }
            });
            return {
              content: [{
                type: 'text' as const,
                text: `## 最近 ${entries.length} 条解析历史\n\n\`\`\`json\n${JSON.stringify(entries, null, 2)}\n\`\`\``,
              }],
            };
          } catch (error) {
            return { content: [{ type: 'text' as const, text: `❌ 读取历史失败: ${error}` }], isError: true };
          }
        }
      ),
```

**Step 4: 删除旧的 `UpdateParserRule` 工具代码块**

删掉整个第 178-221 行（`// ===== 工具 5: UpdateParserRule =====` 块）。删除后把 ReadParseHistory 改为工具 9（只是注释）。

**Step 5: 编译**

Run: `bun run build:electron`
Expected: 无 TS 报错

**Step 6: Commit**

```bash
git add electron/main/agents/tools/article-parse-tools.ts
git commit -m "feat(tools): 新增 List/Read/Run/UpdatePlatformScript 和 ReadParseHistory 工具"
```

---

## Phase 4: 主流程重构（导入 URL 时的脚本优先链路）

**目标：** 改造 `articleService.fetchAndParseArticle` 和 `tipc/article.ts parseArticle`，使其按 "platform script → Readability → AI" 三段式工作。

### Task 4.1: 扩展 articleService 暴露原始 HTML

**Files:**
- Read: `electron/main/services/article-service.ts:213-360`（`fetchAndParseArticle`）
- Modify: `electron/main/services/article-service.ts`

**Step 1: 先读当前 fetchAndParseArticle 实现，确认它内部已经有 rawHtml**

Run: `grep -n "rawHtml\|raw.html" electron/main/services/article-service.ts`

**Step 2: 让函数同时返回 rawHtml（如果尚未返回）**

如果 `fetchAndParseArticle` 已经保存 raw.html 但没 return，改为 return 里带上 `rawHtml`。具体改动依赖于当前实现 —— 实施时读取后再决定。

**原则**：
- 保持现有调用点不破坏（其他地方只用 `meta`/`content`，新增字段即可）
- `saveArticle` 已经写 raw.html 就不重复

**Step 3: 暴露平台检测**

如果 article-service.ts 里已有域名判断（目前有 wechat 特判），抽成：

```typescript
export function detectPlatform(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname;
    if (host === 'mp.weixin.qq.com') return 'wechat';
    if (host.endsWith('zhihu.com')) return 'zhihu';
    if (host.endsWith('juejin.cn')) return 'juejin';
    if (host.endsWith('bilibili.com')) return 'bilibili';
    // 扩展：用户可以通过脚本自动进化新平台
    return null;
  } catch {
    return null;
  }
}
```

**Step 4: 编译**

Run: `bun run build:electron`
Expected: 无报错

**Step 5: Commit**

```bash
git add electron/main/services/article-service.ts
git commit -m "feat(article): 暴露 detectPlatform 和 rawHtml 供 V2 主流程使用"
```

---

### Task 4.2: 新增 articleService.tryPlatformScript 辅助函数

**Files:**
- Modify: `electron/main/services/article-service.ts`

**Step 1: 追加函数**

```typescript
/**
 * 尝试用平台脚本解析文章。
 * 成功 → 返回标准化的 { meta, content, rawHtml }
 * 失败 → 返回 null（连带详细原因）或抛出（仅在系统级失败时）
 */
import { pythonBridge } from './stock/python-bridge.js';
import { getArticleParserSkillsDir } from './article-parser-skills-service.js';

export interface ScriptParseAttempt {
  ok: boolean;
  title?: string;
  content?: string;
  author?: string | null;
  siteName?: string | null;
  excerpt?: string | null;
  language?: string | null;
  durationMs: number;
  errorType?: string;
  errorMessage?: string;
}

export async function tryPlatformScript(params: {
  platform: string;
  url: string;
  html: string;
  timeoutMs?: number;
}): Promise<ScriptParseAttempt> {
  const skillsDir = getArticleParserSkillsDir();
  const scriptPath = path.join(skillsDir, 'platforms', `${params.platform}.py`);

  // 不存在就当作"没脚本"，不报错
  const exists = await fs.access(scriptPath).then(() => true).catch(() => false);
  if (!exists) {
    return {
      ok: false,
      durationMs: 0,
      errorType: 'NoScript',
      errorMessage: `No platform script for ${params.platform}`,
    };
  }

  try {
    const res = await pythonBridge.call<any>('run_article_script', {
      script_path: scriptPath,
      url: params.url,
      html: params.html,
      timeout_ms: params.timeoutMs ?? 5000,
    }, 30_000);

    return {
      ok: !!res.ok,
      title: res.title ?? undefined,
      content: res.content ?? undefined,
      author: res.author ?? null,
      siteName: res.site_name ?? null,
      excerpt: res.excerpt ?? null,
      language: res.language ?? null,
      durationMs: res.duration_ms ?? 0,
      errorType: res.error_type ?? undefined,
      errorMessage: res.error_message ?? undefined,
    };
  } catch (err) {
    return {
      ok: false,
      durationMs: 0,
      errorType: 'BridgeError',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
```

**注意**：如果 article-service.ts 顶部已有 `path`/`fs` import 就别重复。`pythonBridge` 和 `getArticleParserSkillsDir` 需要新增 import。

**Step 2: 编译**

Run: `bun run build:electron`
Expected: 无 TS 报错

**Step 3: Commit**

```bash
git add electron/main/services/article-service.ts
git commit -m "feat(article): 新增 tryPlatformScript 辅助函数"
```

---

### Task 4.3: 改造 parseArticle 主流程

**Files:**
- Modify: `electron/main/tipc/article.ts`
- Modify: `electron/main/agents/task-types.ts:189-196`

**Step 1: 扩展 ParseArticlePayload**

把 `ParseArticlePayload` 改为：

```typescript
export interface ParseArticlePayload {
  articleId: string;
  articleDir: string;
  workspacePath: string;
  url: string;
  skillsDir: string;

  // V2 新增
  platform: string | null;                    // 检测到的平台，null 表示未识别
  trigger: 'script_failed' | 'parse_failed' | 'user_requested';
  scriptError?: { type: string; message: string };  // 脚本报错信息（script_failed 时）
  readabilityError?: string;                  // Readability 报错（parse_failed 时）

  // 兼容字段（逐步淘汰）
  fixedParseSuccess?: boolean;
}
```

**Step 2: 扩展 ArticleParseStatus**

Modify: `types/article.ts:6-11`

```typescript
export type ArticleParseStatus =
  | 'script_ok'        // 新增：平台脚本解析成功（零 AI）
  | 'fixed'            // Readability 兜底成功
  | 'ai_parsing'       // AI 调试中
  | 'ai_enhanced'      // AI 调试完成
  | 'quality_warning'
  | 'failed';
```

**Step 3: 重写 parseArticle（核心）**

用以下版本替换 `electron/main/tipc/article.ts` 的 `parseArticle` 以及 `submitQualityCheckTask`（删除 `submitQualityCheckTask`，不再使用）：

```typescript
function submitAiParseTask(params: {
  articleId: string;
  articleDir: string;
  workspacePath: string;
  url: string;
  platform: string | null;
  trigger: 'script_failed' | 'parse_failed' | 'user_requested';
  scriptError?: { type: string; message: string };
  readabilityError?: string;
}) {
  try {
    const skillsDir = getArticleParserSkillsDir();
    const payload: ParseArticlePayload = {
      articleId: params.articleId,
      articleDir: params.articleDir,
      workspacePath: params.workspacePath,
      url: params.url,
      skillsDir,
      platform: params.platform,
      trigger: params.trigger,
      scriptError: params.scriptError,
      readabilityError: params.readabilityError,
      fixedParseSuccess: false,  // V2 中不再使用，保留兼容
    };
    const task: AgentTask = {
      id: uuidv4(),
      type: TaskType.PARSE_ARTICLE,
      status: TaskStatus.PENDING,
      payload,
      createdAt: Date.now(),
    };
    void getAgentManager().submitTask(task).catch((err) => {
      console.warn('[article] 提交 PARSE_ARTICLE 任务失败:', err);
    });
  } catch (err) {
    console.warn('[article] 准备 PARSE_ARTICLE 任务失败:', err);
  }
}

// parseArticle 主体
parseArticle: t.procedure
  .input<{ url: string; workspaceId: string }>()
  .action(async ({ input }) => {
    try {
      const workspace = await workspaceJsonService.getById(input.workspaceId);
      if (!workspace) return { error: '工作区不存在' };

      // 1. 抓 HTML（以前在 fetchAndParseArticle 里，现在抽出来单独 await）
      const rawHtml = await articleService.fetchRawHtml(input.url);
      const platform = articleService.detectPlatform(input.url);

      // 2. 先尝试平台脚本
      let scriptAttempt: articleService.ScriptParseAttempt | null = null;
      if (platform) {
        scriptAttempt = await articleService.tryPlatformScript({
          platform,
          url: input.url,
          html: rawHtml,
        });
        if (scriptAttempt.ok) {
          const meta = await articleService.saveArticleFromScript({
            workspacePath: workspace.path,
            url: input.url,
            rawHtml,
            title: scriptAttempt.title!,
            content: scriptAttempt.content!,
            author: scriptAttempt.author ?? null,
            siteName: scriptAttempt.siteName ?? null,
            excerpt: scriptAttempt.excerpt ?? null,
            language: scriptAttempt.language ?? null,
          });
          await articleService.updateArticleParseStatus(workspace.path, meta.id, 'script_ok');
          appendParseHistoryFromMain(workspace.path, {
            timestamp: new Date().toISOString(),
            articleId: meta.id,
            url: input.url,
            platform,
            trigger: 'auto',
            triggeredAi: false,
            parseStatus: 'script_ok',
            durationMs: scriptAttempt.durationMs,
          });
          return { article: meta };
        }
      }

      // 3. Readability 兜底
      try {
        const result = await articleService.fetchAndParseArticle(input.url, { rawHtml });
        await articleService.saveArticle(workspace.path, result);
        await articleService.updateArticleParseStatus(workspace.path, result.meta.id, 'fixed');
        appendParseHistoryFromMain(workspace.path, {
          timestamp: new Date().toISOString(),
          articleId: result.meta.id,
          url: input.url,
          platform,
          trigger: 'auto',
          triggeredAi: false,
          parseStatus: 'fixed',
          durationMs: 0,
        });
        return { article: result.meta };
      } catch (readabilityError) {
        // 4. Readability 也失败 → 起 AI 任务
        const articleId = uuidv4();
        const articleDir = await articleService.saveRawHtmlStub({
          workspacePath: workspace.path,
          articleId,
          url: input.url,
          rawHtml,
        });
        await articleService.updateArticleParseStatus(workspace.path, articleId, 'ai_parsing');
        submitAiParseTask({
          articleId,
          articleDir,
          workspacePath: workspace.path,
          url: input.url,
          platform,
          trigger: scriptAttempt && !scriptAttempt.ok ? 'script_failed' : 'parse_failed',
          scriptError: scriptAttempt && !scriptAttempt.ok
            ? { type: scriptAttempt.errorType ?? 'Unknown', message: scriptAttempt.errorMessage ?? '' }
            : undefined,
          readabilityError: String(readabilityError),
        });
        // 返回一个 stub meta（让前端立刻看到占位）
        return {
          article: {
            id: articleId,
            url: input.url,
            title: '(AI 解析中...)',
            author: null,
            siteName: null,
            excerpt: null,
            wordCount: 0,
            fetchedAt: Date.now(),
            language: null,
            parseStatus: 'ai_parsing' as const,
          },
        };
      }
    } catch (error) {
      console.error('解析文章失败:', error);
      return { error: String(error) };
    }
  }),
```

**Step 4: 实现三个新的 articleService 函数（在 article-service.ts 追加）**

```typescript
/** 仅抓 HTML，不做解析（V2 主流程用） */
export async function fetchRawHtml(url: string): Promise<string> {
  // 把当前 fetchAndParseArticle 前半段的 fetch 部分抽出来
  // 具体实现参照原代码的抓取逻辑
}

/** 让 fetchAndParseArticle 支持预传 rawHtml（避免重复抓取） */
// 在签名上追加 options: { rawHtml?: string }，内部优先用传入的

/** 保存平台脚本直接输出的文章（创建文章目录、写 meta/content/raw） */
export async function saveArticleFromScript(params: {
  workspacePath: string;
  url: string;
  rawHtml: string;
  title: string;
  content: string;
  author: string | null;
  siteName: string | null;
  excerpt: string | null;
  language: string | null;
}): Promise<ArticleMeta>;

/** AI 介入时：仅创建文章目录和 raw.html，不写 content.md（AI 稍后写） */
export async function saveRawHtmlStub(params: {
  workspacePath: string;
  articleId: string;
  url: string;
  rawHtml: string;
}): Promise<string>;  // 返回 articleDir 绝对路径
```

具体实现根据 article-service.ts 现有保存逻辑调整。必要时直接复用 `saveArticle`，只是传入不同字段。

**Step 5: appendParseHistoryFromMain 辅助**

在 `electron/main/tipc/article.ts` 顶部追加：

```typescript
import { withFileLock } from '../services/safe-json.js';
import fsModule from 'fs/promises';

async function appendParseHistoryFromMain(workspacePath: string, entry: Record<string, unknown>) {
  // 写入的是全局 skillsDir 的 history.jsonl，不是 workspace 下
  const skillsDir = getArticleParserSkillsDir();
  const historyPath = path.join(skillsDir, 'history.jsonl');
  const line = JSON.stringify(entry) + '\n';
  try {
    await withFileLock(historyPath, async () => {
      await fsModule.appendFile(historyPath, line, 'utf-8');
    });
  } catch (err) {
    console.warn('[article] 写 history 失败:', err);
  }
}
```

注意 `withFileLock` 如果当前 safe-json.ts 没导出该 API，跟 Worker 端的 `appendParseHistory` 对齐（或直接 append 不加锁，冲突概率低）。

**Step 6: 编译**

Run: `bun run build:electron`
Expected: 无 TS 报错

**Step 7: 手动验证**

Run: `bun run dev`（两个终端）
导入一篇微信文章 → 应该走 script_ok 路径（Badge 变"脚本解析"）
导入一篇 non-wechat 的普通博客 → 走 fixed 路径

**Step 8: Commit**

```bash
git add electron/main/tipc/article.ts electron/main/services/article-service.ts electron/main/agents/task-types.ts types/article.ts
git commit -m "feat(article): 主流程 V2 — 脚本优先 + Readability 兜底 + AI 失败才介入"
```

---

### Task 4.4: 改造 Worker handleParseArticleTask

**Files:**
- Modify: `electron/main/agents/agent-worker.ts:699-873`

**Step 1: 简化 prompt，指向 Skill**

把原有的 `buildQualityCheckPrompt` 和 `buildFullParsePrompt` 合并为一个简单 prompt：

```typescript
function buildV2ParsePrompt(p: {
  articleId: string;
  articleDir: string;
  url: string;
  platform: string | null;
  skillsDir: string;
  trigger: string;
  scriptError?: { type: string; message: string };
  readabilityError?: string;
}): string {
  return `你是文章解析器。article-parser Skill 已加载，请按 Skill 中的调试循环工作。

**任务上下文：**
- articleId: ${p.articleId}
- articleDir: ${p.articleDir}
- url: ${p.url}
- platform: ${p.platform || '(未识别)'}
- skillsDir: ${p.skillsDir}
- trigger: ${p.trigger}
${p.scriptError ? `- 脚本错误：${p.scriptError.type} — ${p.scriptError.message}` : ''}
${p.readabilityError ? `- Readability 错误：${p.readabilityError}` : ''}

现在按 SKILL.md 定义的步骤完成解析。
所有工具参数路径都要传入完整绝对路径。`;
}
```

**Step 2: 修改 handleParseArticleTask 调用 query() 时加载 Skill**

把 `query()` 的 options 追加：

```typescript
plugins: [{
  type: 'local',
  path: payload.skillsDir,
}],
```

这会让 SDK 把 `.dogear/skills/article-parser/` 当作 local plugin 加载，其中的 `SKILL.md` 就生效了。

**Step 3: allowedTools 扩展**

```typescript
allowedTools: [
  'mcp__dogear-article-parse__ReadRawHtml',
  'mcp__dogear-article-parse__ReadCurrentContent',
  'mcp__dogear-article-parse__ReadParserRules',
  'mcp__dogear-article-parse__SaveParsedArticle',
  'mcp__dogear-article-parse__ListPlatformScripts',
  'mcp__dogear-article-parse__ReadPlatformScript',
  'mcp__dogear-article-parse__RunPlatformScript',
  'mcp__dogear-article-parse__UpdatePlatformScript',
  'mcp__dogear-article-parse__ReadParseHistory',
],
```

删除 `UpdateParserRule`（已弃用）。

**Step 4: PostToolUse hook 跟踪脚本改动**

把当前只跟踪 `SaveParsedArticle` 和 `UpdateParserRule` 的 hook 改为跟踪新工具：

```typescript
PostToolUse: [{
  hooks: [async (input: any) => {
    const { tool_name } = input;
    if (tool_name === 'mcp__dogear-article-parse__SaveParsedArticle') {
      articleSaved = true;
    } else if (tool_name === 'mcp__dogear-article-parse__UpdatePlatformScript') {
      const ti = input.tool_input || {};
      scriptUpdated = `platforms/${ti.platform}.py`;
    }
    return { continue: true };
  }],
}],
```

新增变量 `let scriptUpdated: string | null = null;`，并在 history.jsonl 记录里替换 `ruleUpdated` 为 `scriptUpdated`。

**Step 5: history.jsonl schema 扩展**

appendParseHistory 的 entry 改为 V2 格式：

```typescript
{
  timestamp: ...,
  articleId: ...,
  url: ...,
  platform: ...,
  trigger: payload.trigger,
  triggeredAi: true,
  scriptUpdated,                  // 替代 ruleUpdated
  articleSaved,
  parseStatus: finalStatus,
  durationMs: Date.now() - startedAt,
  // 可选：tokens、error
}
```

**Step 6: 删除 buildQualityCheckPrompt/buildFullParsePrompt 两个旧函数**

**Step 7: 编译 + 手动验证**

Run: `bun run build:electron && bun run dev`

造一个触发 AI 介入的场景：故意给一个无 platform 的小博客页面且 Readability 抽不出正文 → 应该看到 Badge 从 `ai_parsing` 跳到 `ai_enhanced` 或 `quality_warning`。

**Step 8: Commit**

```bash
git add electron/main/agents/agent-worker.ts
git commit -m "feat(worker): handleParseArticleTask V2 — 加载 Skill + 精简 prompt + 跟踪脚本改动"
```

---

## Phase 5: 主会话集成（AgentChat 也能加载 Skill）

**目标：** 让 QueryBasedSession 默认注册 article-parse MCP Server 和 article-parser Skill。

### Task 5.1: QueryBasedSession 注册 Skill 和 MCP

**Files:**
- Modify: `electron/main/agents/query-based-session.ts`

**Step 1: 读取现有 MCP 注册代码**

Run: `grep -n "mcpServers\|plugins\|skills" electron/main/agents/query-based-session.ts`

**Step 2: 在 query() options 里追加 article-parse MCP Server 和 plugin**

```typescript
const { createArticleParseMcpServer } = await import('./tools/article-parse-tools.js');
const { getArticleParserSkillsDir } = await import('../services/article-parser-skills-service.js');

// 在构造 options 处追加
mcpServers: {
  ...existingMcpServers,
  'dogear-article-parse': createArticleParseMcpServer(),
},
plugins: [
  ...(existingPlugins || []),
  { type: 'local', path: getArticleParserSkillsDir() },
],
```

**Step 3: 确认权限白名单**

`permissionRules.allow` 或默认 allowedTools 里追加 5 个新工具（参考 Task 4.4 Step 3 的列表）。

**Step 4: 编译 + 手动验证**

Run: `bun run build:electron && bun run dev`

在主 AgentChat 里说："列出所有平台脚本"
Expected: AI 调 `ListPlatformScripts` 返回 wechat 等

**Step 5: Commit**

```bash
git add electron/main/agents/query-based-session.ts
git commit -m "feat(session): 主会话默认加载 article-parser Skill 和 MCP 工具"
```

---

## Phase 6: 前端解析历史面板

**目标：** 加一个设置页 Tab 或者弹窗，让用户看 history.jsonl 的内容。

### Task 6.1: 新增 IPC 方法 getParseHistory

**Files:**
- Modify: `electron/main/tipc/article.ts`

**Step 1: 追加 procedure**

```typescript
getParseHistory: t.procedure
  .input<{ limit?: number }>()
  .action(async ({ input }) => {
    try {
      const limit = input.limit ?? 50;
      const skillsDir = getArticleParserSkillsDir();
      const historyPath = path.join(skillsDir, 'history.jsonl');
      const raw = await fs.readFile(historyPath, 'utf-8').catch(() => '');
      const lines = raw.split('\n').filter((l) => l.trim()).slice(-limit);
      const entries = lines.map((l) => {
        try { return JSON.parse(l); } catch { return { raw: l }; }
      });
      return { entries: entries.reverse() };  // 最新在前
    } catch (error) {
      return { entries: [], error: String(error) };
    }
  }),
```

添加必要的 `import fs from 'fs/promises'`、`import path from 'path'`。

**Step 2: 前端 client 类型**

`types/electron-api.ts` 里 getParseHistory 返回类型会被 tipc 自动推断，但前端调用处需要知道字段。不强制在 types 里声明。

**Step 3: Commit**

```bash
git add electron/main/tipc/article.ts
git commit -m "feat(tipc): getParseHistory RPC"
```

---

### Task 6.2: 新增 ArticleParseHistoryPanel 组件

**Files:**
- Create: `components/ArticleParseHistoryPanel.tsx`

**Step 1: 写组件**

```tsx
import { useState, useEffect } from 'react';
import { client } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

interface ParseHistoryEntry {
  timestamp: string;
  articleId: string;
  url: string;
  platform?: string | null;
  trigger?: string;
  triggeredAi?: boolean;
  scriptUpdated?: string | null;
  articleSaved?: boolean;
  parseStatus?: string;
  durationMs?: number;
  error?: string;
}

export function ArticleParseHistoryPanel() {
  const [entries, setEntries] = useState<ParseHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await client.getParseHistory({ limit: 100 });
      setEntries(res.entries || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">文章解析历史</h2>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={'mr-2 h-4 w-4' + (loading ? ' animate-spin' : '')} />
          刷新
        </Button>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无历史记录。</p>
      ) : (
        <div className="space-y-2">
          {entries.map((e, idx) => (
            <div key={idx} className="border rounded p-3 text-sm space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-muted-foreground">
                  {new Date(e.timestamp).toLocaleString()}
                </span>
                <span className="text-xs">
                  {e.triggeredAi ? '🤖 AI 介入' : '⚡ 直出'}
                  {e.scriptUpdated ? ` · 🔧 ${e.scriptUpdated}` : ''}
                </span>
              </div>
              <div className="truncate">
                <span className="font-medium">{e.platform || '(未识别)'}</span>
                <span className="mx-2">·</span>
                <span className="text-muted-foreground">{e.url}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                状态：{e.parseStatus || '-'} · 触发：{e.trigger || '-'} · 耗时：{e.durationMs ?? 0}ms
                {e.error ? ` · ❌ ${e.error}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add components/ArticleParseHistoryPanel.tsx
git commit -m "feat(ui): ArticleParseHistoryPanel 组件"
```

---

### Task 6.3: 挂到设置页

**Files:**
- Modify: `app/settings/page.tsx`

**Step 1: 追加一个 Tab**

找到现有 Tab 定义，追加 `{ key: 'parse-history', label: '解析历史' }`。Tab 内容渲染 `<ArticleParseHistoryPanel />`。

**Step 2: 验证**

Run: `bun run dev`
打开设置页 → 切到"解析历史"Tab → 能看到之前测试的记录

**Step 3: Commit**

```bash
git add app/settings/page.tsx
git commit -m "feat(ui): 设置页新增「解析历史」Tab"
```

---

### Task 6.4: ParseStatusBadge 支持新状态 script_ok

**Files:**
- Modify: `components/ArticlePreview.tsx`（或 ParseStatusBadge 所在文件）

**Step 1: 找到 Badge 组件**

Run: `grep -n "ParseStatusBadge\|parseStatus" components/`

**Step 2: 追加 case**

在 status switch 里追加：

```tsx
case 'script_ok':
  return <Badge variant="secondary">⚡ 脚本解析</Badge>;
```

**Step 3: Commit**

```bash
git add components/ArticlePreview.tsx
git commit -m "feat(ui): ParseStatusBadge 支持 script_ok 状态"
```

---

## Phase 7: 手动验收 + 合并回主分支

### Task 7.1: 端到端手动测试

**Step 1: 场景 1 — 微信长文**

导入 `https://mp.weixin.qq.com/s/...`
Expected: Badge 显示"⚡ 脚本解析"，历史记录 `triggeredAi: false`, `parseStatus: 'script_ok'`

**Step 2: 场景 2 — 普通博客**

导入一个 `detectPlatform` 返回 null 的博客
Expected: Badge 显示"已解析"（fixed），历史记录 `triggeredAi: false`, `parseStatus: 'fixed'`

**Step 3: 场景 3 — 故意触发 AI**

临时把 `platforms/wechat.py` 的 `extract` 改成 `raise ValueError('forced')`
导入一篇微信文章 → 脚本失败后走 Readability → 因为微信 Readability 经常抽不干净，应该进入 AI 任务
Expected: Badge 经历 ai_parsing → ai_enhanced 或 quality_warning；history.jsonl 有 `triggeredAi: true` 和可能的 `scriptUpdated`

测完恢复 wechat.py。

**Step 4: 场景 4 — 主会话改脚本**

AgentChat 里说："列出平台脚本" → 应调 ListPlatformScripts
再说："帮我看看 wechat.py" → 应调 ReadPlatformScript

**Step 5: 清理测试数据**

移除测试文章等。无需 commit。

---

### Task 7.2: 合并回 master

**Step 1: 跑 lint + build**

Run: `bun run lint && bun run build`
Expected: 两个命令都通过

**Step 2: 最终 commit（若有遗漏）**

Run: `git status`
如有未提交改动，整理成一个尾部 commit。

**Step 3: 切回主仓库**

使用 ExitWorktree 工具 action=keep（暂不删 worktree，先合并）

```
ExitWorktree(action: "keep")
```

**Step 4: 合并**

```bash
cd c:/dogear
git merge feature/article-parser-v2 --no-ff -m "feat(article-parser): Skill V2 — Python 脚本化 + 自进化"
```

**Step 5: 删除 worktree**

```bash
cd c:/dogear
git worktree remove .worktrees/article-parser-v2
git branch -d feature/article-parser-v2
```

（如果想保留分支做参考，跳过 `git branch -d`）

---

## 附录：遗留问题处置

1. **SDK 的 `skills: string[]` vs `plugins: [{ type: 'local', path }]`**
   - 实施 Phase 4/5 前先实际用两种方式跑一次看哪种能正确加载 SKILL.md
   - 优先 `plugins`，因为它支持带 MCP 工具的完整 Skill 包
   - 如果 `plugins` 方式有问题，回退到 `skills` + 在 prompt 中手动附 SKILL.md 内容

2. **Windows 下 Python 线程超时**
   - `threading.Thread(daemon=True)` 无法强制杀死，但 daemon 保证进程退出时一起结束
   - 极端情况下（比如无限循环占满 CPU）整个 Python 进程可能僵死 → python-bridge 的 30s 超时 + 崩溃重启兜底
   - 如果 Phase 1 测试确实有问题，考虑改用 `multiprocessing` 子进程实现超时

3. **Readability 失败判定**
   - 当前 articleService 的 fetchAndParseArticle 用 throw 表示失败；Phase 4 靠 try/catch 捕获
   - 但有些情况 Readability 不 throw 只是返回空正文 → Task 4.3 需要检查 `wordCount < 100` 也当作失败，进 AI 分支

4. **前端 stub meta 的处理**
   - Task 4.3 里 AI 触发时 return 了一个 stub article；需要前端能正确处理"标题变化"——当 AI 完成后，parseStatus 事件会触发 re-fetch，标题自然更新
   - 验证时观察这个过程是否流畅

5. **tipc/index.ts 路由注册**
   - Task 3 和 6 新增的 tipc procedure 已经挂在 articleRouter 上，路由注册点无需改动

---

## 执行完毕后

**总改动文件清单：**

Python 端：
- `python/requirements.txt`
- `python/main.py`
- `python/article_parser/__init__.py` (新)
- `python/article_parser/sdk.py` (新)
- `python/article_parser/runner.py` (新)
- `python/tests/test_article_parser_runner.py` (新)

主进程 TS：
- `electron/main/services/stock/python-bridge.ts`
- `electron/main/services/article-service.ts`
- `electron/main/services/article-parser-skills-service.ts`
- `electron/main/tipc/article.ts`
- `electron/main/agents/task-types.ts`
- `electron/main/agents/agent-worker.ts`
- `electron/main/agents/tools/article-parse-tools.ts`
- `electron/main/agents/query-based-session.ts`

前端：
- `types/article.ts`
- `components/ArticlePreview.tsx`
- `components/ArticleParseHistoryPanel.tsx` (新)
- `app/settings/page.tsx`

文档：
- `docs/plans/2026-04/2026-04-18/article-parser-skill-v2-design.md`
- `docs/plans/2026-04/2026-04-18/article-parser-skill-v2-implementation.md`

总计 **≈ 18 个文件变更**，预期 18-22 commit。
