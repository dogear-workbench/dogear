---
step: 2
title: 死代码删除
status: pending
---

## 目标
删除调研确认零引用的死文件与临时产物（微信 UI 死链已随 Step 1 删除，不在本步）。

## 依赖上下文（接力棒输入）
- 调研报告：共享区 `20260926-dead-code-report.md` 第一节（每项均有引用验证证据）
- ⚠️ 绝不可删清单（报告第三节）：agent-worker.ts（字符串路径加载 Worker）、delegation-test-mocks.ts、useTranscriptState 纯函数群、types/*.d.ts、python/core/snapshot.py、python/article_parser/

## 计划改动

### A. shadcn 未用组件（3 文件）
- [ ] `components/ui/hover-card.tsx`（依赖从未安装）
- [ ] `components/ui/sheet.tsx`
- [ ] `components/ui/tooltip.tsx` + package.json 移除 `@radix-ui/react-tooltip` + `bun install` 刷 lockfile

### B. electron 死文件（5 文件）
- [ ] `electron/main/services/group-helpers.ts`（前端用的是 components/group-list/utils.ts）
- [ ] `electron/main/services/memory/transcript-cleaner.ts`（薄转发，调用方已直连）
- [ ] `electron/main/services/memory/source-fidelity.ts`
- [ ] `electron/main/services/stock-analysis-skills-service.ts`（5 行转发残留）
- [ ] `electron/main/services/workspace-service.ts`（旧架构遗留，书籍功能产物）

### C. 渲染层遗留类型（3 文件）
- [ ] `types/ai.ts` / `types/agents.ts` / `types/index.ts`（0 引用，活类型在 electron-api.ts / task-types.ts）

### D. 临时产物目录（磁盘清理，均 gitignore）
- [ ] `tmp/` 全删
- [ ] `reports/` 全删
- [ ] `data/` 删目录 + .gitignore 移除 `/data` 与 `data/dogear.db` 旧 SQLite 条目
- [ ] `claude_code_doc_md/` 删（全局决策默认处置）

### E. 微清理
- [ ] `lib/hotkey-registry.ts` 的 HOTKEY_DEFS / HotkeyDef / HotkeyEntry 三个导出去掉 export 关键字（过度导出）
- [ ] `electron/main/services/skill-loader.ts` 注释里「白嫖框」口头叫法残留改为正式名称

### F. 收尾验证
- [ ] 每删一类跑 lint + 双侧 tsc，确认无悬空 import
- [ ] 手动启动冒烟：文章库、会话、设置页正常打开
