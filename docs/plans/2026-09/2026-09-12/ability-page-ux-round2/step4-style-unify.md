---
step: 4
title: 渲染字号统一与收尾验证
status: done
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

- [x] `SegmentBlock`：`<pre>` → `MarkdownRenderer` + `text-sm`，模板为空时占位文案；删除 font-mono 等宽展示
- [x] `SystemBehaviorDetail` 段区（若 Step 3 未覆盖）：Step 3 已完成 MarkdownRenderer，本步零改动
- [x] 全能力页清扫：`app/settings/` 范围 Grep `text-\[\d+px\]`，逐个换 `text-xs` / `text-sm`（code 标签等继承场景用 `text-[0.9em]` 相对值）
- [x] 一致性核对：代码级核对通过（GUI 人工核对无法执行，留主会话）
- [x] 全量验证：`bun run lint` / `bun run build` / `bunx tsc --noEmit` / `bun test` 全绿
- [x] 行为冒烟：按任务说明改为代码级测试（新建 tool-registration-smoke.test.ts，9 测试 31 断言全过）
- [x] `docs/codebase-map.md` 同步（7 处小节）
- [ ] commit（主会话负责，本子会话不 commit）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 清扫范围按 step4 计划文字「app/settings/ 全范围」执行，除能力页四文件外连同一并清了 SubAgentTab（3 处）/ WorkspaceManagementTab（7 处）/ page.tsx 行内 code（1 处，用计划指定的 text-[0.9em] 相对值）共 11 处非能力页存量；data-center/ 下还有 5 处 text-[10px] 不在 app/settings/ 范围未动。
  - SystemBehaviorDetail 段区 Step 3 已是 MarkdownRenderer + 标准档位，本步零改动。
  - 行为冒烟三项按任务说明改为代码级测试：新建 electron/main/agents/tool-registration-smoke.test.ts，new PiSession 后直接调 buildMainAgentToolDefs/buildSubAgentToolDefs 私有方法（括号索引访问），activeAbilities 用真实 resolveAbilities 生成；9 测试 31 断言全过。
  - 连带：delegation-test-mocks.ts electronStub 补 WebContentsView/session/nativeImage/Notification/Tray 五 key + app.on no-op（pi-session import 树拉进 browser/stock 模块，named import 链接需要；纯增量，delegation 测试不受影响）。
  - AbilityTab 实际 2 处 text-[Npx]（派发消息盘点说 3 处，grep 全量核实为 2 处）。
- 改动文件清单：
  - app/settings/ability/AbilityPackDetailPage.tsx：SegmentBlock `<pre> text-[11px] font-mono` → div + MarkdownRenderer + text-sm（空模板「（模板为空）」text-xs 占位，对齐 CoreProfileView 空态模式）；头部两处 text-[10px] → text-xs
  - app/settings/ability/AbilityMountsSection.tsx：8 处 text-[10px]/text-[11px] → text-xs
  - app/settings/ability/AbilityPackCard.tsx：3 处 text-[10px] → text-xs
  - app/settings/AbilityTab.tsx：2 处 text-[10px] → text-xs
  - app/settings/page.tsx：行内 code text-[10px] → text-[0.9em]
  - app/settings/SubAgentTab.tsx：3 处、WorkspaceManagementTab.tsx：7 处 text-[10px] → text-xs
  - electron/main/agents/tool-registration-smoke.test.ts（新建）：纯净模式常驻组断言 + browser 包总闸 gate 三态 + 子会话双闸与 reference 拆组五态
  - electron/main/agents/delegation-test-mocks.ts：electronStub 补 5 key + app.on
  - docs/codebase-map.md：AbilityTab/ability 目录/tipc ability.ts/pi-session/ability-registry/extension-tools/reference-tools 七小节同步
- 验证：bun run lint 0 errors / 84 warnings（全部既有 any，与 Step 3 持平）；bun run build（Vite + electron）通过；bunx tsc --noEmit 通过；bun test 298 pass / 0 fail / 1 skip（既有交互 shell skip），含新冒烟 9 pass；一致性核对（代码级）：app/settings/ Grep text-\[\d+px\] = 0，字号机制 lib/setup-settings-sync.ts 写 root font-size（100%/120%/135%），Tailwind rem 档位全量受控。

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - 冒烟测试模式：测试文件静态 import delegation-test-mocks.js（顶层同步注册进程级 electron/tipc stub，禁止再 mock 第二份），业务模块（pi-session.js）只能动态 import；需要新场景时沿用 mainGroups/subGroups helper
- 下个 step 该从哪里继续：本轮四步全部完成，无下个 step；commit 由主会话执行（排除 package.json 版本号 bump 与 tmp/）
- 待办或已知限制：
  - GUI 人工冒烟（dev 起页面核对字号观感、设置页切字体大小全页缩放）本环境无法执行，代码级核对已过，留主会话确认
  - data-center/ 下 5 处 text-[10px]（scheduler/usage-panel）不在本计划范围，未动
