---
step: 1
title: 列表层级翻转
status: done
---

## 目标
话题标题升格为列表主视觉，形成「话题强、会话弱」的层级差；不破坏会话行任何现有信息。

## 依赖上下文（接力棒输入）
- 前置 step 产出：无（首步）
- 当前关键文件状态：`components/group-list/GroupCard.tsx` 话题标题 span 约 141 行 `text-xs text-muted-foreground truncate`；话题卡容器约 113-121 行（hover:bg-muted/30、isSelected bg-muted/40）
- 关键决策回顾：会话行（ConversationRow）**原地不动**——不缩字号、不动图标/按钮浮层，层级差仅由话题变强形成。用户明确担心信息爆炸，克制优先。

## 计划改动
- [ ] `components/group-list/GroupCard.tsx` 话题标题：`text-xs text-muted-foreground` → `text-[13px] text-foreground font-medium`，保留 truncate
- [ ] 同文件话题卡选中/hover 容器感增强：selected 态左侧 2px 主色竖条（`border-l-2 border-primary` 或等价实现）+ 现有 bg 态保留；具体样式以视觉目测定稿
- [ ] 目测 `RecentVirtualGroup.tsx` / `SmartSection.tsx` / `ManualSection.tsx` 分区标题与话题卡的层级关系，若分区标题视觉权重盖过话题标题则同步调（预期不需要动）
- [ ] 会话行回归检查：打开列表确认图标（Network/展开箭头/操作按钮）、双层高亮、计数徽章全部无变化

## 实施回填（做完后填）

### 实际改动
- 与计划差异：选中竖条未用 border-l-2（会压缩内容区导致图标偏移 2px），改用绝对定位 `absolute left-0 h-4 w-0.5 bg-primary rounded-full`，纯视觉覆盖不动布局；计划里写明「或等价实现」
- 分区标题（RecentVirtualGroup/SmartSection 为 `text-xs font-semibold` 组织标签）确认不动：12px semibold 组织标签 vs 13px medium 内容条目形成编辑风层级对比，符合设计意图
- 改动文件清单：`components/group-list/GroupCard.tsx`（+2/-1：话题标题 `text-[13px] text-foreground font-medium truncate`；选中态左侧 2px 主色竖条）

### 给下一步的接力棒
- 关键签名 / 数据结构：无新增接口，纯样式改动；GroupCard 话题标题在 GroupCard.tsx:165，选中竖条在 GroupCard.tsx:116
- 下个 step 该从哪里继续：step2-edit-diff.md，Edit 差分纯函数 + FileChangeRenderer
- 待办或已知限制：验证靠 bun run dev 人工目测（无人值守未做）；话题标题 13px medium vs 会话行 14px 常规，层级差靠颜色+字重而非字号压制，如目测不够强可微调
