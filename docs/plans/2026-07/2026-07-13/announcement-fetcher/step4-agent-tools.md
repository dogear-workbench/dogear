---
step: 4
title: Agent MCP 工具注册
status: done
---

## 目标
真实 Agent 会话里，输入"帮我看看茅台最近有什么公告"，agent 能调 `ListAnnouncements` 拿列表 + 选择性调 `ReadAnnouncement` 拿全文，并把内容说清楚。

## 依赖上下文（接力棒输入）
- Step 2 已提供 `listAnnouncements(code, market, opts)`
- Step 3 已提供 `readAnnouncement(url, code, market, meta?)`
- 现有工具注册范式：`electron/main/agents/tools/tool-registry.ts` + 各 `stock-*.ts` 工具文件末尾调 `registerTools()`
- 现有工具文件参考：`stock-tools.ts`（SearchStock/GetStockQuote/GetKLineData 等）—— 完全跟着它的风格来
- 全局决策：错误返给 agent 用文本描述，不要 throw

## 计划改动

- [x] `electron/main/agents/tools/stock-announcement-tools.ts` 新建：
  - Tool 1：`ListAnnouncements`
    - 参数：`{ code: string, market?: 'sh'|'sz'|'bj', since?: string, types?: string[], limit?: number }`
    - market 未传时用 `inferMarket(code)`（Step 2 已实现的私有函数考虑升级为公开）
    - 返回：markdown 列表（`- YYYY-MM-DD [类型] 标题 (URL)`），方便 agent 直接消费
    - description 明确说：这是拉列表元数据，读全文用 ReadAnnouncement 并把这里返回的 URL 传进去
  - Tool 2：`ReadAnnouncement`
    - 参数：`{ url: string, code: string, market: 'sh'|'sz'|'bj' }`
    - 返回：markdown 全文
    - description 提示：URL 必须是 ListAnnouncements 返回过的，直接粘不要拼；超长公告 agent 自行判断是否分段消化
- [x] 文件末尾调 `registerTools()` 注册元数据（参考现有 stock-tools.ts）
- [x] `electron/main/agents/tools/tool-registry.ts` 或工具 barrel import 里加入新文件（看现有怎么串起来的，跟着做）
- [ ] `.claude/rules/agent-development.md` 若有工具清单，同步（子会话未改 `.claude/**`，交由主会话决定，详见 shared/step4-delivery.md）

## 验证

- [ ] `bun run dev` 启动应用（子会话未跑，交由用户手测）
- [ ] 新建对话，输入："帮我查一下贵州茅台（600519）最近有什么公告"
- [ ] Agent 应调 `ListAnnouncements`，返回列表
- [ ] 追问 "看下最新那条业绩相关的" → Agent 应调 `ReadAnnouncement` 并总结内容
- [ ] 检查设置页 → 子会话派遣 Tab（或工具列表）能看到两个新工具
- [ ] 第二次读同一条公告，响应明显更快（缓存命中）
- [x] `bun run build` 通过（前后端都 build）
- [x] `bun run lint` 通过（0 errors，83 warnings，与 Step 3 完全一致，无新增）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：新增了一个**未在计划字面清单中**、但对工具"实际可用"必需的串联动作——新建了 MCP server `dogear-stock-announcement`（独立于 `dogear-stock`，跟 `dogear-stock-analysis` 同规格），并把它注册为新的可选工具包 `stock-announcement`（`electron/main/services/tool-packs.ts` + `electron/main/services/conversation-runtime-service.ts` 的 `toolPackFactories`）。原因：`conversation-runtime-service.ts` 里 MCP server 是否真正挂载到会话、`allowedTools` 是否放行，完全由 `OPTIONAL_TOOL_PACKS` 数组驱动（`tool-pack-guide.ts` 的系统提示词导览、设置页工具包开关也都自动读这个数组）；只加 `tool-registry.ts` 的元数据只影响"设置页工具列表展示"，不影响工具是否真的能被 agent 调用。若不做这步，两个新工具会显示在工具清单里但永远不会被挂载到任何会话，等于死代码。这属于计划里"看现有怎么串起来的，跟着做"的范围，未改动 `announcement-service.ts` 内部结构，也未跨出 stock 域。
- 工具 description 的最终措辞：见下方"两个工具的最终参数 schema + description"章节。
- 改动文件清单：
  - `electron/main/agents/tools/stock-announcement-tools.ts`（新建，148 行）— 两个工具 + `registerTools()` 元数据（`stock-announcement-tools.ts:20-23`）
  - `electron/main/agents/tools/tool-registry.ts:33` — `SERVER_LABELS` 加 `'dogear-stock-announcement': '公司公告'`
  - `electron/main/agents/tools/tool-registry.ts:97` — `serverOrder` 加 `'dogear-stock-announcement'`（排在 stock-analysis 之后）
  - `electron/main/services/tool-packs.ts:56-63` — `OPTIONAL_TOOL_PACKS` 新增 `stock-announcement` 条目
  - `electron/main/services/conversation-runtime-service.ts:11` — import `createAnnouncementTools`
  - `electron/main/services/conversation-runtime-service.ts:112-115` — `toolPackFactories` 新增 `'stock-announcement'` 工厂

### 给下一步的接力棒
- 两个工具名 + 参数最终形式：`ListAnnouncements({ code, market?, since?, types?, limit? })`、`ReadAnnouncement({ url, code, market })`，详见 shared/step4-delivery.md 的 zod 源码片段。
- Agent 实际调用效果：未做真实会话手测（子会话按要求不跑 `bun run dev`），效果需用户在真实会话验证。
- 已知问题：详见 shared/step4-delivery.md「已知问题 / 潜在误用点」。
