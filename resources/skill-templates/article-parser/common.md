# 通用文章解析规则

## 预处理步骤

### 1. 隐藏元素清理
移除以下 inline style 的元素内容：
- `visibility: hidden`
- `opacity: 0`
- `display: none`
原因：许多平台通过 JS 控制可见性，静态解析时这些元素可能包含干扰内容。

### 2. 图片懒加载修复
常见的懒加载属性（按优先级）：
- `data-src` → 复制到 `src`
- `data-original` → 复制到 `src`
- `data-lazy-src` → 复制到 `src`

### 3. 相对 URL 转绝对 URL
所有 `<img>` 和 `<a>` 的相对路径需要基于页面 origin 转换为绝对路径。

## 正文识别

### Readability 提取
- 使用 Mozilla Readability 作为主要提取器
- 最小有效正文长度：100 字符（去除空白后）
- 如果提取失败，需要 AI 分析 HTML 结构手动定位正文区域

### 常见正文容器选择器（优先级从高到低）
- `article`
- `[role="main"]`
- `.post-content`, `.article-content`, `.entry-content`
- `#content`, `.content`

## 元数据提取

### 标题（按优先级）
1. `<meta property="og:title">`
2. `<title>` 标签
3. `<h1>` 第一个

### 作者（按优先级）
1. `<meta name="author">`
2. `<meta property="article:author">`
3. 页面内 byline 模式匹配

### 发布日期（按优先级）
1. `<meta property="article:published_time">`
2. `<time>` 标签的 `datetime` 属性
3. 页面内日期模式匹配

## 质量检查标准

一篇成功解析的文章应满足：
- [ ] 标题非空且不是纯 URL
- [ ] 正文长度 > 200 字符
- [ ] 正文不包含大量重复内容（导航栏、侧边栏残留）
- [ ] 图片 URL 可访问（抽查前 3 张）
- [ ] Markdown 格式正确（标题层级、代码块闭合）
