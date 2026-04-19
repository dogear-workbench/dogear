"""文章解析用户脚本 SDK 入口。"""
from .sdk import soup, Result, extract_js_var, html_to_markdown

__all__ = ['soup', 'Result', 'extract_js_var', 'html_to_markdown']
