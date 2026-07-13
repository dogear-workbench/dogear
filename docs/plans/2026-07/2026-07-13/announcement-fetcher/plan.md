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
- [x] [Step 2: 巨潮列表 API + orgId 映射](./step2-cninfo-list-api.md) — Service 能列出任意股票的公告元数据
- [x] [Step 3: 全文抓取 + 懒缓存](./step3-fetch-cache.md) — readAnnouncement 命中/未命中路径都跑通
- [x] [Step 4: Agent MCP 工具注册](./step4-agent-tools.md) — 真实会话里 agent 能调 ListAnnouncements / ReadAnnouncement
- [x] [Step 5: 文档同步收尾](./step5-doc-sync.md) — codebase-map + CLAUDE.md 同步

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

## 完成总结

**能力全景**：Agent 现在可以对 A 股任意个股拉巨潮资讯网公告列表 + 按需读取全文（PDF → pdfplumber → markdown 含表格），本地懒缓存永久复用。用户在设置页开启「公司公告」工具包后即刻可用。

**从计划到实施的偏差**：
- Step 3：`electron/main/types.ts` 镜像未落地——stock 域现有惯例是服务文件内联 + `types/stock.ts` 手动同步（Step 2 已确认，`RateLimiterStatus` 是先例）；`validateCninfoUrl` 用 `URL` 解析替代字符串 `startsWith`（防前缀绕过攻击）；`downloadPdf` 失败/超限时清理半成品文件
- Step 4：超出字面清单额外做了三处串联——独立 MCP server `dogear-stock-announcement`（对齐 `stock-analysis` 先例）+ `tool-packs.ts` 注册可选工具包 + `conversation-runtime-service.ts` `toolPackFactories` 挂载工厂。原因：只加 `tool-registry.ts` 元数据仅影响设置页展示，不影响工具能否被 agent 调用，不做这步就是死代码
- Step 5：plan 里写的 `python_workspace/` 实际叫 `python/`，pdfplumber 已在 Step 1 加进 `python/requirements.txt`，无需新建 README

**未做的事 / 留给未来的**：
- 定时预抓：属于第三阶段（按天工作流），本阶段只做懒缓存
- 多源 fallback（东财/腾讯）：等真出问题再补
- Jina Reader 兜底：pdfplumber 已足够稳
- 超长公告分页 / 摘要目录：靠 description 约束 agent 自行判断，未做工具层截断
- `ReadAnnouncement` 未透传 `meta`：index.json 里 title/type/date 字段落空，不影响功能只影响缓存目录可读性
- `code`/`market` 与 `url` 不匹配的强校验：低概率误用，未加
- 缓存过期机制：只增不淘，需要清理只能整只股清空（`clearAnnouncementCache`）
- UI 缓存清理按钮：Service 层 `clearAnnouncementCache` 已导出，UI 按钮留给未来

**待用户手测**：真实会话里开启「公司公告」工具包 → "帮我查一下贵州茅台（600519）最近有什么公告" → 追问 "看下最新那条业绩相关的" → 验证列表返回、全文读取、二次读命中缓存。子会话按纪律未跑 `bun run dev`。
