---
step: 2
title: 设置页模型行 UI
status: done
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

- [x] `types/settings.ts` — 渲染层 ModelProfile.piModels 类型同步加 `contextWindow?: number`（step1 接力棒指出主进程已改、渲染层未同步）
- [x] `lib/pi-model-catalog.ts` — 加两个纯函数：
  - `resolveModelWindow(entry: { id: string; contextWindow?: number }): number` — `entry.contextWindow ?? lookupContextWindow(entry.id) ?? FALLBACK_CONTEXT_WINDOW`
  - `parseContextInput(input: string): number | undefined` — 接受 `'1M'`/`'1.5M'`/`'200K'`/`'1000000'`（大小写不敏感、允许末尾空格），非法返回 undefined
- [x] 新建 `app/settings/pi-model-row.tsx` — `PiModelRow` 组件，props：`{ entry, others, onChange(next: { id; label?; contextWindow? }), onRemove() }`（others 为同清单其他条目，用于查重）：
  - ID 格：受控 input，编辑草稿本地 state；blur/Enter 提交——trim 后为空或与 others 某个 id 相同则回退原值（重复可短暂标红 border 提示），变更成功调 onChange 更新整条（label/contextWindow 随条目保留）
  - 窗口徽标：默认态显示 `formatContextLabel(resolveModelWindow(entry))`；手填生效加「手动」角标（如 `1M · 手动`，颜色区分目录值）；未识别未手填维持现有黄色 `200K · 未识别`；点击进入编辑态（小 input，预填手填值或空，placeholder 示例 `如 1M / 200K / 262144`）——Enter/blur 提交：非空且 `parseContextInput` 合法 → 写 contextWindow；清空 → 删除 contextWindow 字段；非法 → 回退；ESC 取消
  - label 输入框、删除按钮迁移现有逻辑
- [x] `app/settings/page.tsx` — 模型清单 map 处替换为 `<PiModelRow>`，onChange 里 `updateProfileField(id, { piModels: 替换对应条目 })`；删除「未识别按 200K 估算」的旧提示文案（:638 附近，改为手填引导一句）

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
  - PiModelRow 内部定义 `buildEntry(id, label?, contextWindow?)` 工厂函数按需组装字段（undefined 字段不写入 key，保持 JSON 干净、deepEqual dirty 检测准确），label 清空时删字段的现有行为一并迁入
  - 窗口编辑 ESC 后 blur 不再提交（`windowCancelled` ref 防护，防卸载/取消时序双触发）
  - 提示文案：首模型手填后自动压缩阈值行也按 resolveModelWindow 展示（原为纯查表）；未识别引导改为「可在模型行点击窗口徽标手填」
- 改动文件清单：`types/settings.ts`、`lib/pi-model-catalog.ts`、`app/settings/pi-model-row.tsx`（新建）、`app/settings/page.tsx`；详见 `step2-delivery.md`

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `lib/pi-model-catalog.ts` 新增 `resolveModelWindow(entry: { id; contextWindow? }): number` 与 `parseContextInput(input: string): number | undefined`（正则 `^(\d+(?:\.\d+)?)([kKmM]?)$`，trim 后匹配，非正数返回 undefined）
  - `app/settings/pi-model-row.tsx` 导出 `PiModelEntry = { id: string; label?: string; contextWindow?: number }` 与 `PiModelRow`，props `{ entry, others, onChange(next), onRemove() }`
  - 渲染层 `types/settings.ts` 的 piModels 已同步 `contextWindow?: number`，与主进程一致
- 下个 step 该从哪里继续：真机验证清单见 step2-settings-ui.md「验证」段；后续 step 从 step3 文档继续
- 待办或已知限制：
  - ID 编辑提交依赖父级 `key={model.id}` 重建组件同步草稿（当前实现下行为正确，若未来 map 改用 index key 需补草稿同步）
  - 真机 `bun run dev` 交互验证（徽标编辑、ID 回退、usage 按手填窗口计算）未在本 step 执行，需人工过一遍验证清单
