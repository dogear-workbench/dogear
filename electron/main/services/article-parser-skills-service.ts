/**
 * 文章解析器 Skill 规则目录管理服务
 *
 * 负责在应用启动时自动初始化 .dogear/skills/article-parser/ 目录，
 * 包含通用解析规则 common.md、平台规则 platforms/wechat.md 和解析历史 history.jsonl。
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

const WECHAT_MD = `# 微信公众号 (mp.weixin.qq.com)

## 域名匹配
- \`mp.weixin.qq.com\`

## 内容提取策略

### 长文章（标准模式）
- Readability 正常提取即可
- 图片使用 \`data-src\` 属性（必须做懒加载修复）

### 短内容（type 9）
微信短内容不在 DOM 中，而是存储在 JS 变量里：
1. 在 \`<script>\` 标签中查找 \`text_page_info\` 变量
2. 正则提取：\`text_page_info:\\s*\\{[\\s\\S]*?content:\\s*JsDecode\\('([\\s\\S]*?)'\\)\`
3. 解码转义序列：\`\\x0a\` → 换行，\`\\x26\` → &，等等
4. 如果 Readability 提取的内容为空但 JS 变量有内容，使用 JS 变量的内容

### 元数据提取
- 标题：\`window.msg_title = '...'\` JS 变量
- 作者：\`nick_name: '...'\` JS 变量
- 站点名：默认为 "微信公众号"

## 注意事项
- 微信文章的 \`<section>\` 标签大量使用 inline style
- 部分样式会导致 Readability 错误判断内容层级
- 图片可能有防盗链，需要保留原始 URL
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

  const commonPath = path.join(skillsDir, 'common.md');
  const wechatPath = path.join(platformsDir, 'wechat.md');
  const historyPath = path.join(skillsDir, 'history.jsonl');

  // 只在文件不存在时写入初始内容
  if (!(await fileExists(commonPath))) {
    await safeFileWrite(commonPath, COMMON_MD);
  }

  if (!(await fileExists(wechatPath))) {
    await safeFileWrite(wechatPath, WECHAT_MD);
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
