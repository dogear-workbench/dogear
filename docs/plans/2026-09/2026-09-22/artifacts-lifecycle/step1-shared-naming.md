---
step: 1
title: shared 命名规范化
status: done
---

## 目标

SaveSharedNote 写入共享区时文件名自动补 `YYYYMMDD-` 日期前缀，从源头消除 `step1-delivery.md` ×60 的重名辨识问题。

## 依赖上下文（接力棒输入）

- 当前关键文件状态：`electron/main/agents/tools/group-tools.ts:80` 是 SaveSharedNote 工具定义（relPath + content 两个参数）；实际写文件的服务在 `electron/main/services/group-shared-service.ts`（执行时先读该文件确认写入函数签名）
- 关键决策回顾：前缀在**工具 handler 层**规范化（不 deeper 改 service——用户手动经 tipc 写共享区的路径若也存在则同样处理，执行时核实 tipc 层有无共享区写入口）

## 计划改动

- [x] 在 SaveSharedNote handler 内对 relPath 规范化：取 basename，若不以 `YYYYMMDD-`（当天日期）开头则补前缀；目录部分与扩展名保持不变（`ideas/x.md` → `ideas/20260922-x.md`）
- [x] 已带当日（或任意日期格式 `^\d{8}-`）前缀的不再重复补
- [x] 工具 description 补一句「文件名自动带日期前缀」，让 agent 知情避免它自己再拼
- [x] 若 `agents/session-append-templates.ts:80` 的交付路径提示与实际落盘名可能不一致，在提示文案中说明前缀行为

## 实施回填（做完后填）

### 实际改动
- 与计划差异：helper 落在 group-shared-service.ts 导出（纯函数）供工具层与 tipc 层复用；zod 示例顺带修正（原示例 `ideas/2026-06-25.md` 不匹配 `^\d{8}-` 会被误加前缀）
- 改动文件清单：
  - `electron/main/services/group-shared-service.ts`：新增 `ensureDatedRelPath(relPath, date?)` 导出纯函数
  - `electron/main/agents/tools/group-tools.ts`：SaveSharedNote description/zod describe 补前缀说明，handler 过 `ensureDatedRelPath` 后写入并返回实际路径
  - `electron/main/tipc/group.ts`：writeSharedFile 写入口同样处理（渲染层暂无调用方，无 UI 依赖）
  - `electron/main/agents/session-append-templates.ts:80`：交付路径提示补前缀行为说明
- 验收：lint 0 errors / build:electron exit 0 / 契约测试 4 pass；详细交付见共享区 20260922-step1-delivery.md

### 给下一步的接力棒
- 关键签名 / 数据结构：`ensureDatedRelPath(relPath: string, date = new Date()): string`（group-shared-service.ts 导出，无副作用）
- 下个 step 该从哪里继续：shared 批量清理或后续治理步骤；若需 claim 与实际落盘一致，claimOutputPath/previewClaim 层也应过 `ensureDatedRelPath`（当前仍用原始 relPath 做 file_exists 检查，claimed_by_other 内存检查仍有效）
- 待办或已知限制：claim 层 file_exists 检查对带前缀写入基本不命中（同日防覆盖由 SaveSharedNote 覆盖语义兜底）
