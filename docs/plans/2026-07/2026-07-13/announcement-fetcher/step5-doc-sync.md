---
step: 5
title: 文档同步收尾
status: done
---

## 目标
把新增模块登记到 codebase-map，让未来 Agent（包括你自己开新会话）能通过索引找到这些文件。

## 依赖上下文（接力棒输入）
- Step 1-4 已让整套能力可用
- `.claude/rules/codebase-map.md` 是主索引，改动内容需要在此登记：
  - 新增 Service：announcement-service.ts
  - 新增 Agent 工具文件：stock-announcement-tools.ts
  - 新增数据存储路径：`.dogear/stocks/announcements/{market}{code}/`
  - 新增类型：Announcement / AnnouncementDetail / AnnouncementType
  - Python 侧：python_workspace/announcements/
- `.claude/CLAUDE.md` 主 README——一般不用改（内容偏架构约定，不列具体模块）

## 计划改动

- [x] `.claude/rules/codebase-map.md`：类型定义 stock.ts 行追加 5 个新类型；业务服务 stock/ 加 announcement-service.ts 一行；Agent 框架 tools/ 加 stock-announcement-tools.ts 一行；数据存储加 `stocks/announcements/{market}{code}/` + `stocks/cninfo-org-map.json` 两行；关键数据流加「公司公告抓取」一条
- [x] `.claude/rules/agent-development.md`：「按业务域分文件」列表加 stock-announcement-tools.ts
- [x] Python 依赖：`python/requirements.txt` 里 `pdfplumber>=0.11` 已在 Step 1 加入，无需重复
- 说明：plan 提到的 `python_workspace/` 实际叫 `python/`，没有 README.md 单独文档，pdfplumber 装依赖只需 `pip install -r python/requirements.txt`，够了

## 验证

- [ ] Read 一遍 codebase-map.md，确认新增条目位置合理、格式一致
- [ ] `bun run lint` 通过（如果 lint 覆盖 md 的话——一般不）
- [ ] （可选）`/doc-sync` 跑一次看有没有漏

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 完成总结按计划写入了 plan.md 末尾，本文件不再重复
  - Python 依赖同步走 Step 1 已加的 requirements.txt，未新建独立 README
- 改动文件清单：
  - `.claude/rules/codebase-map.md` — 5 处编辑（类型 / 服务 / 工具 / 存储 / 数据流各一处）
  - `.claude/rules/agent-development.md:57` — 「按业务域分文件」列表末尾追加 stock-announcement-tools.ts
  - `docs/plans/2026-07/2026-07-13/announcement-fetcher/plan.md` — Step 5 打勾 + 末尾追加「完成总结」章节

### 完成总结
详见 plan.md 末尾「完成总结」章节。
