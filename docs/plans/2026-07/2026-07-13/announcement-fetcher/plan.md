# 公司公告按需抓取 实施计划

**目标**：让 agent 在分析个股时能拉到巨潮资讯公告列表和全文（含表格），首次抓取后本地缓存复用。

**架构思路**：3 层（Agent 工具 → Service → Python 桥接）+ 懒缓存。巨潮为唯一源，pdfplumber 走 Python bridge 解析 PDF。**排除**：定时预抓（属第三阶段）、多源 fallback、纯 Node PDF 方案（表格能力不够）。

**涉及模块**：
- Python：`python_workspace/announcements/parser.py`（新）
- Service：`electron/main/services/stock/announcement-service.ts`（新）+ `python-bridge.ts`（改）
- Agent 工具：`electron/main/agents/tools/stock-announcement-tools.ts`（新）
- 类型：`types/stock.ts`（加类型）
- 存储：`.dogear/stocks/announcements/{market}{code}/`（新目录规范）
- 索引：`.claude/rules/codebase-map.md` 同步

**设计文档**：[../announcement-fetcher-design.md](../announcement-fetcher-design.md)

## 步骤索引

- [x] [Step 1: Python PDF 解析器 + Bridge RPC](./step1-python-parser.md) — pdfplumber 打通 → 命令行喂 PDF 出 markdown
- [ ] [Step 2: 巨潮列表 API + orgId 映射](./step2-cninfo-list-api.md) — Service 能列出任意股票的公告元数据
- [ ] [Step 3: 全文抓取 + 懒缓存](./step3-fetch-cache.md) — readAnnouncement 命中/未命中路径都跑通
- [ ] [Step 4: Agent MCP 工具注册](./step4-agent-tools.md) — 真实会话里 agent 能调 ListAnnouncements / ReadAnnouncement
- [ ] [Step 5: 文档同步收尾](./step5-doc-sync.md) — codebase-map + CLAUDE.md 同步

## 全局决策

**命名规范**：
- 存储目录：`.dogear/stocks/announcements/{market}{code}/`，market 用 `sh`/`sz`/`bj` 小写
- 文件 hash：`sha256(url).slice(0, 16)`（16 位 hex），`<hash>.pdf` + `<hash>.md` 同名成对
- index.json 条目：`{url, title, type, date, hash, cachedAt}`（cachedAt = ISO 时间字符串）

**错误契约**：
- Service 层所有对外方法返回 `{ ok: true, data } | { ok: false, error: string }`
- 巨潮 API 走现有 `stock/rate-limiter.ts` 的令牌桶（新加一个 endpoint entry）
- Python bridge 调用异常 = 视为解析失败，不做 Jina 兜底

**类型放置**：
- 前端可见类型放 `types/stock.ts`
- 主进程用镜像模式（现有 `electron/main/types.ts` 已有其他镜像的模式，跟着做）

**巨潮 API 契约**（Step 2 拍板前的初步共识，实施时以真实响应为准）：
- 列表：`POST http://www.cninfo.com.cn/new/hisAnnouncement/query`
  - Form: `stock={code},{orgId}` + `column=sse|szse|bj` + `category=` + `pageNum` + `pageSize` + `sdate` + `edate`
- OrgId 映射：`GET http://www.cninfo.com.cn/new/data/szse_stock.json` / `sse_stock.json` / `bj_stock.json`
- PDF：`http://static.cninfo.com.cn/finalpage/{date}/{fileId}.PDF`（URL 从列表返回的 `adjunctUrl` 拼）

**验证方式**：不写单测（项目偏好），每步用一个 node -e 或临时脚本跑一遍关键路径 + build + lint。Agent 工具那步在真实会话里手测。
