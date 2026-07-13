---
step: 1
title: Python PDF 解析器 + Bridge RPC
status: done
---

## 目标
Python 侧能读 PDF 出 markdown（叙述文本 + 表格），主进程能通过 `python-bridge.ts` 调用。命令行喂一个测试 PDF，能看到结构化输出。

## 依赖上下文（接力棒输入）
- 项目已有 Python bridge：`electron/main/services/stock/python-bridge.ts`（现在为 stock 分析工具服务）
- 已有 Python workspace 目录：`python_workspace/`（现有 stock 计算层），可仿照它的模块组织新建 `announcements/` 子目录
- 依赖库：需要装 `pdfplumber`（MIT），加到 `python_workspace/requirements.txt`
- 全局决策：Service 层返回 `{ok, data|error}` 契约；Python bridge 调用异常视为解析失败

## 计划改动

- [ ] `python_workspace/requirements.txt` 加 `pdfplumber>=0.11`
- [ ] `python_workspace/announcements/__init__.py`（空文件占位）
- [ ] `python_workspace/announcements/parser.py`：
  - `parse_pdf(path: str) -> dict`
  - 返回结构：`{"pages": [{"page": 1, "text": "...", "tables": [[["a","b"],["c","d"]], ...]}]}`
  - 内部逻辑：`with pdfplumber.open(path) as pdf: for page in pdf.pages: extract_text() + extract_tables()`
  - 空表格过滤（extract_tables 会返回空列表和无内容行）
- [ ] `python_workspace/announcements/markdown.py`：
  - `to_markdown(parsed: dict) -> str`（纯函数，方便单独测试）
  - 页头 `## Page N` + 文本段落 + 表格 markdown 化（GFM `| a | b |` 格式）
  - 表格里 `None`/空字符串填为空格；多行单元格换行符 → `<br>`
- [ ] `python-bridge.ts` 新增方法：`parseAnnouncementPdf(pdfPath: string): Promise<{ok, data?: {markdown: string}, error?: string}>`
  - 走现有 JSON-RPC 通道，method 名 `parse_announcement_pdf`
- [ ] Python 主入口文件（若已有 dispatcher，加一个 case；若各方法独立注册，加注册）——**先看 python-bridge.ts 现有的分发逻辑，跟着做**

## 验证

- [ ] 手工准备一份短公告 PDF 放 `/tmp` 或项目临时目录
- [ ] 命令行跑 `bun run node -e "const b = await import('./electron/main/services/stock/python-bridge.ts'); console.log(await b.parseAnnouncementPdf('/path/to/test.pdf'))"`
  （或用现有 python-bridge 的调试脚本）
- [ ] 输出应包含：`## Page 1` 头 + 文本 + 至少一个表格 markdown 化
- [ ] `bun run build:electron` 通过（主进程 TS 无错）
- [ ] `bun run lint` 通过

## 实施回填

### 实际改动
- 与计划差异：计划里写的 `python_workspace/announcements/`，项目实际 Python 目录是 `python/`（`python-bridge.ts` 的 `getPythonDir()` 硬编码指向它，`python_workspace/` 不存在）。实施时改为 `python/announcements/`，与 `python/core/`、`python/article_parser/` 平级，无功能性偏差。
- 改动文件清单：
  - `python/requirements.txt`（追加 `pdfplumber>=0.11`）
  - `python/announcements/__init__.py`（新增空包）
  - `python/announcements/parser.py`（新增 `parse_pdf`）
  - `python/announcements/markdown.py`（新增 `to_markdown`）
  - `python/main.py`（import + handler + `METHOD_HANDLERS["parse_announcement_pdf"]`）
  - `electron/main/services/stock/python-bridge.ts`（末尾新增 `parseAnnouncementPdf` 导出函数）

### 给下一步的接力棒
- `parseAnnouncementPdf(path)` 签名：
  ```typescript
  export async function parseAnnouncementPdf(
    pdfPath: string,
  ): Promise<{ ok: true; data: { markdown: string } } | { ok: false; error: string }>
  ```
  内部 `pythonBridge.call('parse_announcement_pdf', { path: pdfPath })`，异常一律转 `{ ok: false, error }`，不做兜底。
- Python 侧 markdown 组装策略：
  - 空表格行过滤；空单元格 → 单空格；换行 → `<br>`；`|` → `\|` 转义
  - 行列数不齐按最大列数补齐
  - 首行固定当表头 + `| --- |` 分隔行（不做语义识别）
- 已知限制：
  - 文本层与表格内容重复（pdfplumber 固有行为，正文段落与表格区块会各出一份，未去重）
  - 扫描件不支持（无文本层）
  - 复杂合并单元格表格可能错位
  - RPC 只回 `{markdown: string}`，中间结构不过边界
