---
step: 5
title: 文档同步收尾
status: pending
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

- [ ] `.claude/rules/codebase-map.md`：
  - 「业务服务」section 加 `stock/announcement-service.ts` 一行
  - 「Agent 框架 → tools/」section 加 `stock-announcement-tools.ts` 一行
  - 「数据存储」section 加 `stocks/announcements/{market}{code}/` 路径规范
  - 「类型定义」section 加 `Announcement` / `AnnouncementDetail`（如果 stock.ts 已有则在现有 stock.ts 行里追加类型名列举）
  - 「关键数据流」section 加一条：**公告抓取**：Agent 调 ListAnnouncements → 巨潮 API 拿列表 → 选一条调 ReadAnnouncement → 缓存命中直读 md / 未命中下载 PDF → Python bridge (pdfplumber) → 写 md + index → 返回
- [ ] Python 若首次引入 `pdfplumber`，在 `python_workspace/README.md`（若有）或环境说明里加装依赖的提示

## 验证

- [ ] Read 一遍 codebase-map.md，确认新增条目位置合理、格式一致
- [ ] `bun run lint` 通过（如果 lint 覆盖 md 的话——一般不）
- [ ] （可选）`/doc-sync` 跑一次看有没有漏

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 完成总结（这是最后一步，直接在 plan.md 末尾写）
- 从计划到实施的偏差汇总：
- 未做的事 / 留给未来的：
