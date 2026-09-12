---
step: 4
title: 渲染字号统一与收尾验证
status: pending
---

## 目标

能力页整体风格对齐应用常用页面：段全文 Markdown 渲染、全页清固定像素字号（受字体大小设置控制）、全量验证与冒烟。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step3-detail-layout.md] 的实施回填（新组件结构、residentToolGroups 数据形状）
- 关键现状：
  - `AbilityPackDetailPage.tsx` 的 `SegmentBlock`：`<pre> text-[11px] font-mono`（约 28 行）——Step 3 改布局时若未动此处，本步改渲染
  - 全能力页固定像素字号分布：`AbilityPackCard.tsx` / `AbilityPackSidebar.tsx` / `AbilityMountsSection.tsx` / `SystemBehaviorDetail.tsx` / `AbilityTab.tsx` 的 `text-[10px]` / `text-[11px]`（Grep `text-\[\d+px\]` 限定 app/settings 逐个清）
  - 字号缩放机制：root font-size（100%/120%/135%），rem 档位自动受控，无需额外接线
- 关键决策回顾：段全文只保留渲染态不做源码切换；徽标/辅助文字 text-xs、正文 text-sm

## 计划改动

- [ ] `SegmentBlock`：`<pre>` → `MarkdownRenderer` + `text-sm`，模板为空时占位文案；删除 font-mono 等宽展示
- [ ] `SystemBehaviorDetail` 段区（若 Step 3 未覆盖）：同样改 MarkdownRenderer
- [ ] 全能力页清扫：`app/settings/` 范围 Grep `text-\[\d+px\]`，逐个换 `text-xs` / `text-sm`（code 标签等继承场景可用 `text-[0.9em]` 相对值）；同步检查 padding/间距观感
- [ ] 一致性核对：设置页字体大小切 small/medium/large，能力页首页/各类型详情页/系统行为页全部同步缩放，无固定不变的区域
- [ ] 全量验证：`bun run lint` / `bun run build` / `bunx tsc --noEmit` / `bun test`
- [ ] 行为冒烟（参照上一轮三模式冒烟脚本思路，可 mock 或真开会话）：
  - 纯净模式（全部包关）：主会话仍有 dogear-history 检索组与 dogear-tasks（绑定工作区时）、无协作组、无 extension
  - 默认模式：browser 包关 → extension 不注册；browser 包开 → 主会话 extension 注册
  - 子会话：browser 包开 + Profile extension=true → extension 注册；reference=false → 无组协作引用但有检索组
- [ ] `docs/codebase-map.md` 同步（能力页新组件、常驻工具区、RuleFileEditor 形态、SYSTEM_BEHAVIORS 2 条）
- [ ] commit（排除 package.json 版本号 bump 与 tmp/）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
