---
step: 4
title: 笔记完成态流转
status: done
---

## 目标

让「已完成的任务类笔记」能从主视图收起，不再和活跃笔记混排。**先核实再定做/降级**。

## 依赖上下文（接力棒输入）

- 当前关键文件状态：`electron/main/services/notes/`（note-types.ts / notes-service.ts / notes-store.ts）——`dogear__DeleteNote` 已是软删除进回收站；**执行时先核实**：Note 类型有无状态字段、回收站视图现有交互、笔记卡片有无勾选项（`- [ ]`）支持
- 关键决策回顾：设计文档标注此层「轻做，可降级为不做」——完成的任务不算记忆（记忆准入排除流水账），笔记需要的是收起视图而非转知识
- 判定条件（执行时二选一）：
  - **回收站已能满足**「完成 → 收起 → 偶尔回看」→ 本 step 降级为不做，回填结论即可
  - **不满足**（如回收站=删除语义，用户不敢把"完成"的东西放进去）→ 做最小改动：Note 加 `completedAt?: number`，前端笔记列表加「已完成」过滤分区，完成动作放卡片菜单

## 计划改动（仅当不降级时执行）

> 判定结果：**降级，以下未执行**——回收站为纯删除语义不满足，但任务类内容已由 Task 系统（done 分区收起/回看/移回）承载，Note 实际定位是知识卡片，加 completedAt 属错对象（YAGNI）。

- [ ] `note-types.ts` Note 加 `completedAt?: number`（frontmatter 同名 camelCase）
- [ ] `notes-service.ts` 完成态读写 + 列表过滤参数
- [ ] 笔记前端：列表默认隐藏已完成，顶部入口切换查看；卡片菜单加「标记完成 / 恢复」

## 实施回填（做完后填）

### 实际改动
- 与计划差异：**降级为不做，零代码改动**。判定依据（完整证据链见共享区 step4-delivery.md）：① 回收站字面判定「不满足」（TrashView 仅恢复/彻底删除，purge 有永久删除警告，纯删除语义）；② 但分支 B 前提不成立——任务类内容已有专门系统承载：task-store.ts 于 2026-08-29（4d2dbf62）引入，TaskStatus 八状态含 done，TaskPanel done 组独立分区排最后（「已完成 · N」header），已实现「完成 → 不与活跃混排 → 可回看可移回计划」；③ Note 实际定位是知识卡片（CreateNote 工具语义 + NoteSource 来源身份证），数据核查 20 张卡中 3 张含 `- [ ]` 均为调研/拍板卡内嵌待办清单（文档内容的一部分），无任务卡语义。给 Note 加 completedAt 是错对象，YAGNI。
- 改动文件清单：无

### 给下一步的接力棒
- 关键签名 / 数据结构：无需关注（本 step 未改代码）
- 下个 step 该从哪里继续：plan 四个 step 已全部处理完毕（step1-3 已落地，本 step 降级），无后续 step
- 待办或已知限制：若未来用户提出「手动收起做完的知识卡」诉求，再评估给 Note 加完成态（改动面：note-types + types/note 镜像 → notes-store frontmatter → notes-service 过滤 → TimelinePane/CardItem UI）；另注意回收站与任务回收站已并存于 TrashView（notes/tasks 两段），无需为笔记新建归档视图
