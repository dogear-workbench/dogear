"""
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
