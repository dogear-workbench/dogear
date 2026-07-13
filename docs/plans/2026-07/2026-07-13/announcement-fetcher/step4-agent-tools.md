---
step: 4
title: Agent MCP 工具注册
status: pending
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

- [ ] `electron/main/agents/tools/stock-announcement-tools.ts` 新建：
  - Tool 1：`ListAnnouncements`
    - 参数：`{ code: string, market?: 'sh'|'sz'|'bj', since?: string, types?: string[], limit?: number }`
    - market 未传时用 `inferMarket(code)`（Step 2 已实现的私有函数考虑升级为公开）
    - 返回：markdown 列表（`- YYYY-MM-DD [类型] 标题 (URL)`），方便 agent 直接消费
    - description 明确说：这是拉列表元数据，读全文用 ReadAnnouncement 并把这里返回的 URL 传进去
  - Tool 2：`ReadAnnouncement`
    - 参数：`{ url: string, code: string, market: 'sh'|'sz'|'bj' }`
    - 返回：markdown 全文
    - description 提示：URL 必须是 ListAnnouncements 返回过的，直接粘不要拼；超长公告 agent 自行判断是否分段消化
- [ ] 文件末尾调 `registerTools()` 注册元数据（参考现有 stock-tools.ts）
- [ ] `electron/main/agents/tools/tool-registry.ts` 或工具 barrel import 里加入新文件（看现有怎么串起来的，跟着做）
- [ ] `.claude/rules/agent-development.md` 若有工具清单，同步（可能不需要，看现况）

## 验证

- [ ] `bun run dev` 启动应用
- [ ] 新建对话，输入："帮我查一下贵州茅台（600519）最近有什么公告"
- [ ] Agent 应调 `ListAnnouncements`，返回列表
- [ ] 追问 "看下最新那条业绩相关的" → Agent 应调 `ReadAnnouncement` 并总结内容
- [ ] 检查设置页 → 子会话派遣 Tab（或工具列表）能看到两个新工具
- [ ] 第二次读同一条公告，响应明显更快（缓存命中）
- [ ] `bun run build` 通过（前后端都 build）
- [ ] `bun run lint` 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 工具 description 的最终措辞（会影响 agent 调用行为）：
- 改动文件清单：

### 给下一步的接力棒
- 两个工具名 + 参数最终形式：
- Agent 实际调用效果（好用 / 有问题 / 需要迭代描述）：
- 已知问题（agent 会不会误用、URL 拼错等）：
