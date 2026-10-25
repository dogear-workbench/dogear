"""wechat.py 平台脚本回归：微信公众号两种文章形态（正常图文 / 短内容随笔）。

跑法：
  cd python && python -m pytest tests/test_wechat_platform_script.py -v
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from article_parser import sdk as _sdk
sys.modules['article_parser_sdk'] = _sdk

from article_parser.runner import run_script

WECHAT_PY = ROOT.parent / 'resources' / 'skill-templates' / 'article-parser' / 'platforms' / 'wechat.py'

RICH_HTML = """<html><head><title>测试图文</title></head><body>
<h1 id="activity-name">我的公众号文章标题</h1>
<div class="rich_media_meta_nickname"><span id="js_name">测试公众号</span></div>
<div id="js_content" style="visibility:hidden">
<p>这是第一段正文内容，讲的是一件事。</p>
<img data-src="https://example.com/a.jpg">
<p>这是第二段正文内容，字数要多一些才能超过五十个字符的阈值判定，所以这里再补充一些文字让长度足够通过。</p>
</div></body></html>"""

SHORT_TEXT = '今天天气不错，随手记一笔。出门走了走，看到很多有趣的事情：街角新开了一家书店，门口的猫晒着太阳睡觉，路边的桂花开了，香味飘得很远。回家路上买了杯热咖啡，突然觉得这样的日子很好，记录一下。'

SHORT_HTML = f"""<html><head><title>预加载</title></head><body>
<div id="js_content" style="visibility:hidden"></div>
<script>
window.msg_title = window.title = '一条随笔';
var text_page_info = {{
  create_time: 1700000000,
  content: JsDecode('{chr(92) + 'x0a' + SHORT_TEXT + chr(92) + 'x0a'}'),
  nick_name: JsDecode('测试公众号')
}};
</script></body></html>"""


class WechatPlatformScriptTests(unittest.TestCase):
    """模板 wechat.py 对两种微信文章形态的覆盖（TS 侧短内容特判已删，脚本层是唯一实现）"""

    def run_wechat(self, html: str):
        return run_script(script_path=str(WECHAT_PY), url='https://mp.weixin.qq.com/s/abc123', html=html, timeout_ms=8000)

    def test_template_exists(self):
        self.assertTrue(WECHAT_PY.exists(), f'模板脚本缺失: {WECHAT_PY}')

    def test_rich_article(self):
        r = self.run_wechat(RICH_HTML)
        self.assertTrue(r.ok, f'error={r.error_type}: {r.error_message}')
        self.assertEqual(r.title, '我的公众号文章标题')
        self.assertEqual(r.author, '测试公众号')
        self.assertEqual(r.site_name, '微信公众号')
        self.assertIn('第一段正文内容', r.content)
        self.assertIn('![](https://example.com/a.jpg)', r.content)

    def test_short_content_article(self):
        r = self.run_wechat(SHORT_HTML)
        self.assertTrue(r.ok, f'error={r.error_type}: {r.error_message}')
        self.assertEqual(r.title, '一条随笔')
        self.assertEqual(r.author, '测试公众号')
        self.assertEqual(r.site_name, '微信公众号')
        self.assertIn('随手记一笔', r.content)
        self.assertIn('记录一下', r.content)

    def test_short_content_js_escapes_decoded(self):
        r = self.run_wechat(SHORT_HTML)
        self.assertTrue(r.ok)
        self.assertNotIn(chr(92) + 'x0a', r.content)
        self.assertIn(chr(10), r.content)


if __name__ == '__main__':
    unittest.main()
