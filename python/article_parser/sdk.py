"""
article_parser_sdk — 暴露给用户平台脚本的 API。

用户脚本只能 from article_parser_sdk import ...，不能 import 其他 stdlib 或三方包。
执行环境由 article_parser/runner.py 强制限制（Task 1.3 实施）。
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
