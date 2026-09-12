---
step: 2
title: 挂载矩阵
status: pending
---

## 目标

详情页右栏「挂载情况」从工作区实例反查改为会话场景加载矩阵。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-backend-ownership.md] 包结构已重划（会话组包已存在、协作包含子会话契约段等）
- 关键决策回顾：工作区维度整个删掉；「子会话·默认」= 系统预设定死全开、标注不可改；其余 Profile 显示真实勾选状态；单元格 = ✓/✗ + 一句话原因

## 计划改动

- [ ] `electron/main/tipc/ability.ts`：getAbilityMounts 改造为场景矩阵——行 = 主会话（固定）/ 子会话·默认（固定，标记系统预设）/ 各 Profile（读 settings.subAgent.profiles）/ 任务执行会话（固定）；列数据 = 该能力在各场景的加载结果 + 原因（包开关默认或 override / Profile 勾选 / 场景规则如「任务会话只注组头」）；RESIDENT_GROUP_IDS 等常量随 step1 结果对齐
- [ ] `app/settings/ability/AbilityMountsSection.tsx`：重写为矩阵渲染（场景行 + 状态徽标 + 原因），删除工作区列表
- [ ] `app/settings/ability/AbilityPackDetailPage.tsx` / 系统行为详情：接入矩阵；会话组包、系统行为卡同样适用
- [ ] bunx tsc --noEmit / lint / build 全过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
