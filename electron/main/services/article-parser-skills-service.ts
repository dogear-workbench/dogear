/**
 * 文章解析器 Skill 规则目录管理服务
 *
 * 负责在应用启动时自动初始化 .dogear/skills/article-parser/ 目录（SDK local plugin 格式），
 * 包含 SKILL.md（plugin 入口）、common.md（通用常识）、platforms/wechat.py（微信解析脚本）、history.jsonl。
 * 所有初始化操作是幂等的：文件已存在则不覆盖。
 */

import path from 'path';
import fs from 'fs/promises';
import electron from 'electron';
import { safeFileWrite } from './safe-json.js';

const { app } = electron;

function getConfigDir(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), '.dogear');
  }
  return path.join(process.cwd(), '.dogear');
}

/**
 * 返回文章解析器 Skill 规则目录的绝对路径
 */
export function getArticleParserSkillsDir(): string {
  return path.join(getConfigDir(), 'skills', 'article-parser');
}

// ============================================================
// 初始内容
// ============================================================

const COMMON_MD = `# 通用文章解析规则

## 预处理步骤

### 1. 隐藏元素清理
移除以下 inline style 的元素内容：
- \`visibility: hidden\`
- \`opacity: 0\`
- \`display: none\`
原因：许多平台通过 JS 控制可见性，静态解析时这些元素可能包含干扰内容。

### 2. 图片懒加载修复
常见的懒加载属性（按优先级）：
- \`data-src\` → 复制到 \`src\`
- \`data-original\` → 复制到 \`src\`
- \`data-lazy-src\` → 复制到 \`src\`

### 3. 相对 URL 转绝对 URL
所有 \`<img>\` 和 \`<a>\` 的相对路径需要基于页面 origin 转换为绝对路径。

## 正文识别

### Readability 提取
- 使用 Mozilla Readability 作为主要提取器
- 最小有效正文长度：100 字符（去除空白后）
- 如果提取失败，需要 AI 分析 HTML 结构手动定位正文区域

### 常见正文容器选择器（优先级从高到低）
- \`article\`
- \`[role="main"]\`
- \`.post-content\`, \`.article-content\`, \`.entry-content\`
- \`#content\`, \`.content\`

## 元数据提取

### 标题（按优先级）
1. \`<meta property="og:title">\`
2. \`<title>\` 标签
3. \`<h1>\` 第一个

### 作者（按优先级）
1. \`<meta name="author">\`
2. \`<meta property="article:author">\`
3. 页面内 byline 模式匹配

### 发布日期（按优先级）
1. \`<meta property="article:published_time">\`
2. \`<time>\` 标签的 \`datetime\` 属性
3. 页面内日期模式匹配

## 质量检查标准

一篇成功解析的文章应满足：
- [ ] 标题非空且不是纯 URL
- [ ] 正文长度 > 200 字符
- [ ] 正文不包含大量重复内容（导航栏、侧边栏残留）
- [ ] 图片 URL 可访问（抽查前 3 张）
- [ ] Markdown 格式正确（标题层级、代码块闭合）
`;

const SKILL_MD = `---
name: article-parser
description: 从网络文章 HTML 中提取标题、正文、作者等结构化内容。当用户导入文章失败、解析质量不佳，或用户明确要求调整某平台解析逻辑时使用此 Skill。
---

# 文章解析 Skill

## 何时使用
- 后台 PARSE_ARTICLE 任务触发（脚本或 Readability 解析失败）
- 用户在对话中说"xx 平台解析不对""帮我改下 xx 脚本"

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

// ============================================================
// 初始化
// ============================================================

/**
 * 确保 Skill 规则目录和初始文件存在。
 * 幂等：文件已存在则跳过，不会覆盖 AI 已修改的内容。
 * 在应用启动时调用一次，错误不应阻塞启动。
 */
export async function ensureSkillsInitialized(): Promise<void> {
  const skillsDir = getArticleParserSkillsDir();
  const platformsDir = path.join(skillsDir, 'platforms');

  await fs.mkdir(platformsDir, { recursive: true });

  const skillPath = path.join(skillsDir, 'SKILL.md');
  const commonPath = path.join(skillsDir, 'common.md');
  const wechatPyPath = path.join(platformsDir, 'wechat.py');
  const historyPath = path.join(skillsDir, 'history.jsonl');

  // 幂等：文件已存在则不覆盖（用户/AI 可能已经改过）
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
