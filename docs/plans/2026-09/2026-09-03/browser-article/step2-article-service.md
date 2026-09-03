---
step: 2
title: readArticle 核心服务
status: pending
---

## 目标

`browser-article-service.ts`：浏览器渲染 + 展开启发式 + 登录墙检测 + 渲染后 DOM 走 Readability 出 markdown 落盘。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1] BrowserManager 就绪，`acquire(taskMeta)` 签名与队列语义
- 当前关键文件状态：`article-service.ts` 的 `fetchAndParseArticle`（约 320 行起）后半段是「linkedom DOM → Readability → Turndown → meta 组装」管线，其中含 hidden 样式清理、懒加载图片 src 修复、相对路径图片转绝对
- 关键决策：渲染后 HTML 拿回 Node 侧跑 Readability（复用现有管线，不向页面注入 readability 脚本）；微信短内容正则 hack 在浏览器渲染后大概率不再需要，但保留管线兼容

## 计划改动

- [ ] `article-service.ts` 小重构：把 `fetchAndParseArticle` 的「DOM 预处理 + Readability + Turndown + 结果组装」抽成可导出纯函数（输入 document 或 html + url，输出解析结果或抛错），原函数行为不变仍走 linkedom
- [ ] 新建 `electron/main/services/browser/browser-article-service.ts`：
  - `readArticleWithBrowser(url): Promise<{ ok: true, meta } | { ok: false, errorClass, message }>`，errorClass ∈ `need_login | timeout | parse_empty | browser_crash`
  - 流程：acquire → `goto(url, waitUntil: 'domcontentloaded')` → 网络空闲/正文出现等待策略（轮询正文容器字数，上限 15s）→ 登录墙检测 → 展开启发式 → `page.content()` → 喂重构后的解析纯函数 → `saveArticle`（parseStatus `fixed`）
  - 登录墙检测：URL 跳转到已知登录 pattern（如 `passport.*`、`/login`、`accounts.*`）或 DOM 出现密码输入框 + 正文容器缺失；命中时调 `BrowserManager.bringToFront()` 并返回 `need_login`（前端流程在 step3 接）
  - 展开启发式：白名单文本匹配（展开/全文/更多/阅读全文/继续阅读/下一页），候选按钮点击后比较正文容器字数，变长才保留、最多点 3 个候选；结果不变长则放弃并在 meta excerpt 附 quality 提示
  - 每个动作点（navigate/click/wait/parse）发轻量事件回调 `onAction`（step5 的动作流数据源，本步先接 console/debug）
- [ ] 解析后空结果：沿用 `trimmedTextLength > 100` 阈值逻辑，低于阈值返回 `parse_empty`

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：翻页拼接未做（待 step6 基线决定）
