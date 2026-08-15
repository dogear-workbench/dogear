---
step: 2
title: 设置页模型行 UI
status: pending
---

## 目标

设置页模型清单行支持：ID 直接编辑（空/重复回退）、窗口徽标点击编辑（K/M 简写、清空恢复查表）、手填生效的视觉标记。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-main-process-window.md] piModels 条目类型已含 `contextWindow?: number`，主进程窗口链路已手填优先
- 当前关键文件状态：
  - `app/settings/page.tsx` — 模型行渲染在 :507-554（ID 只读 span + 窗口徽标 + label 输入框 w-44 + 删除按钮）；`updateProfileField`（:169）是页内局部函数 `(profileId: string, updates: Partial<ModelProfile>) => void`；新增模型草稿 `piModelDrafts`（:79）
  - `lib/pi-model-catalog.ts` — 现有 `lookupContextWindow` / `formatContextLabel` / `FALLBACK_CONTEXT_WINDOW`
- 关键决策回顾：行 UI 抽成独立组件避免 page.tsx 膨胀（该文件已 700+ 行）；编辑草稿态由行组件自持，不进全局 store

## 计划改动

- [ ] `types/settings.ts` — 渲染层 ModelProfile.piModels 类型同步加 `contextWindow?: number`（step1 接力棒指出主进程已改、渲染层未同步）
- [ ] `lib/pi-model-catalog.ts` — 加两个纯函数：
  - `resolveModelWindow(entry: { id: string; contextWindow?: number }): number` — `entry.contextWindow ?? lookupContextWindow(entry.id) ?? FALLBACK_CONTEXT_WINDOW`
  - `parseContextInput(input: string): number | undefined` — 接受 `'1M'`/`'1.5M'`/`'200K'`/`'1000000'`（大小写不敏感、允许末尾空格），非法返回 undefined
- [ ] 新建 `app/settings/pi-model-row.tsx` — `PiModelRow` 组件，props：`{ entry, others, onChange(next: { id; label?; contextWindow? }), onRemove() }`（others 为同清单其他条目，用于查重）：
  - ID 格：受控 input，编辑草稿本地 state；blur/Enter 提交——trim 后为空或与 others 某个 id 相同则回退原值（重复可短暂标红 border 提示），变更成功调 onChange 更新整条（label/contextWindow 随条目保留）
  - 窗口徽标：默认态显示 `formatContextLabel(resolveModelWindow(entry))`；手填生效加「手动」角标（如 `1M · 手动`，颜色区分目录值）；未识别未手填维持现有黄色 `200K · 未识别`；点击进入编辑态（小 input，预填手填值或空，placeholder 示例 `如 1M / 200K / 262144`）——Enter/blur 提交：非空且 `parseContextInput` 合法 → 写 contextWindow；清空 → 删除 contextWindow 字段；非法 → 回退；ESC 取消
  - label 输入框、删除按钮迁移现有逻辑
- [ ] `app/settings/page.tsx` — 模型清单 map 处替换为 `<PiModelRow>`，onChange 里 `updateProfileField(id, { piModels: 替换对应条目 })`；删除「未识别按 200K 估算」的旧提示文案（:638 附近，改为手填引导一句）

## 验证

- `bun run lint` 0 error；`bun run build`（含前端）通过
- 真机 `bun run dev`：
  - glm-5.3 行显示 `200K · 未识别`，点击编辑填 `1M` → 徽标变 `1M · 手动`
  - 清空编辑框 → 恢复 `200K · 未识别`
  - ID 从 glm-5.2 改成 glm-5.3 → 显示名/手填窗口保留；改成空/重复 → 回退原值
  - 存量对话选旧 id 发消息 → 报「模型不在清单里」，重选后正常
  - 手填 1M 后发长对话：usage 徽章窗口按 1M 算、自动压缩阈值按 1M×80% 触发

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
