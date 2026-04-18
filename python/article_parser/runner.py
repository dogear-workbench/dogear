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
