---
step: 3
title: 重叠软警告
status: done
---

## 目标

保存任务时检测「规则重叠导致同刻双跑」，`showConfirm` 软警告（不阻断）。

## 依赖上下文（接力棒输入）

- 前置 step 产出：UI 可编辑全部定点形态，`monthly_at` / `interval.weekdays` 数据可产生
- 关键文件现状：`app/settings/scheduler/TaskEditor.tsx`（保存入口，`useSchedulerStore` 的 save/upsert 路径）、`stores/confirm-store.ts` 的 `showConfirm(title, description?)` 返回 Promise<boolean>
- 关键决策回顾：只检测定点类（daily_at × daily_at / daily_at × monthly_at / monthly_at × monthly_at）与完全重复；daily_at × monthly_at 同 at 即报（每月 N 号必落某天）；interval / window 与定点的碰巧重叠不检测

## 计划改动

- [x] `app/settings/scheduler/utils.ts` 新增 `findTriggerOverlaps(triggers: Trigger[]): string[] | null`（或放 `overlap-check.ts`，若 utils 超 300 行则拆）：返回重叠描述数组用于警告文案，无重叠返回 null。规则：
  - 完全重复：两条同类型且参与判定的字段全等（daily_at 比 at+weekdays 归一化、monthly_at 比 at+daysOfMonth 归一化、interval 比 minutes+weekdays）
  - daily_at × daily_at：at 相同 && weekdays 归一化（undefined→[0..6]）交集非空
  - daily_at × monthly_at：at 相同
  - monthly_at × monthly_at：at 相同 && daysOfMonth 交集（`'last'` 参与交集）
- [x] `TaskEditor.tsx` 保存流程：`findTriggerOverlaps` 命中时 `showConfirm('存在重叠的时间规则', '以下规则会在某些时刻同时触发，任务将执行两次：…')`，用户确认 false 则中止保存，true 继续
- [x] 实测（GUI 无法启动，改为临时 bun 脚本验证检测函数 19 个 case 全 PASS 后删除 + 代码级 walkthrough，详见共享区 step3-delivery.md）：每天 08:00 + 每周一 08:00 → 警告；每月 1 号 08:00 + 每天 08:00 → 警告；间隔 + 定点不报；确认后可保存、取消则不保存

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无实质差异。检测函数放 utils.ts（现约 165 行，远低于 300 拆分线）；多条重叠在警告文案中用「；」连接而非换行（ConfirmDialog 的 description 为纯文本渲染，无 whitespace-pre-line，`\n` 会被折叠成空格）；daily_at / monthly_at 的「完全重复」是各自交集判定的子集，被交集规则自然覆盖，无需单独分支
- 改动文件清单：
  - `app/settings/scheduler/utils.ts`：新增私有 `normalizeWeekdays` / `weekdaysIntersect` / `sameWeekdays` / `daysOfMonthIntersect` + 导出 `findTriggerOverlaps(triggers: Trigger[]): string[] | null`（文案复用同文件 describeTrigger）
  - `app/settings/scheduler/TaskEditor.tsx`：`handleSave` 在 validateDraft 通过后、setSaving 前插入重叠检测 + showConfirm；新增两个 import（showConfirm / findTriggerOverlaps）

### 给下一步的接力棒
- 关键签名 / 数据结构：`findTriggerOverlaps(triggers: Trigger[]): string[] | null`——返回「describeTrigger(a) × describeTrigger(b)」格式的重叠对描述；只筛 daily_at / monthly_at / interval 参与，interval 仅完全重复（minutes + weekdays 归一化全等）报
- 下个 step 该从哪里继续：无后续 step，本 feature 全部完成（Step 1 主进程、Step 2 编辑 UI、Step 3 软警告）
- 待办或已知限制：建议用户 GUI 实测三组场景（见 step3-delivery.md）；重叠警告仅在保存路径触发，计划内的行为
