"""runner.py 的单元测试。

跑法（任一）：
  cd python && python3 -m pytest tests/test_article_parser_runner.py -v
  cd python && python3 -m unittest tests.test_article_parser_runner
"""
import sys
import unittest
from pathlib import Path

# 让测试能找到 python/ 下的模块（__file__ 是 .../python/tests/xxx.py）
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

LEGAL_INFINITE_LOOP = """
from article_parser_sdk import Result

def extract(ctx):
    while True:
        pass
"""

DICT_RETURN_SCRIPT = """
def extract(ctx):
    return {'title': 'T', 'content': 'x' * 100, 'author': 'A'}
"""

NO_EXTRACT_SCRIPT = """
def other_function(ctx):
    pass
"""


def _run(src, **kw):
    return run_script(script_content=src, url='https://example.com', html='<html></html>', **kw)


class RunnerTests(unittest.TestCase):

    def test_ok_script(self):
        r = _run(OK_SCRIPT)
        self.assertTrue(r.ok, f'error={r.error_message}')
        self.assertEqual(r.title, 'Hello')
        self.assertEqual(len(r.content), 100)

    def test_missing_title(self):
        r = _run(MISSING_TITLE_SCRIPT)
        self.assertFalse(r.ok)
        self.assertEqual(r.error_type, 'ValueError')
        self.assertIn('title', r.error_message)

    def test_short_content(self):
        r = _run(SHORT_CONTENT_SCRIPT)
        self.assertFalse(r.ok)
        self.assertIn('过短', r.error_message)

    def test_crash_script(self):
        r = _run(CRASH_SCRIPT)
        self.assertFalse(r.ok)
        self.assertEqual(r.error_type, 'ValueError')
        self.assertIn('boom', r.error_message)
        self.assertIsNotNone(r.traceback)

    def test_banned_import(self):
        r = _run(BANNED_IMPORT_SCRIPT)
        self.assertFalse(r.ok)
        self.assertEqual(r.error_type, 'ScriptSecurityError')

    def test_banned_call(self):
        r = _run(BANNED_CALL_SCRIPT)
        self.assertFalse(r.ok)
        self.assertEqual(r.error_type, 'ScriptSecurityError')

    def test_timeout(self):
        r = _run(LEGAL_INFINITE_LOOP, timeout_ms=200)
        self.assertFalse(r.ok)
        self.assertEqual(r.error_type, 'TimeoutError')

    def test_dict_return(self):
        r = _run(DICT_RETURN_SCRIPT)
        self.assertTrue(r.ok)
        self.assertEqual(r.title, 'T')
        self.assertEqual(r.author, 'A')

    def test_no_extract_function(self):
        r = _run(NO_EXTRACT_SCRIPT)
        self.assertFalse(r.ok)
        self.assertEqual(r.error_type, 'AttributeError')


if __name__ == '__main__':
    unittest.main()
