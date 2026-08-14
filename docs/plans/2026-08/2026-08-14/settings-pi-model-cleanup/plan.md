# 设置页模型管理 pi 化收尾 实施计划

**目标**：清除设置页及数据层的 Claude Agent SDK 残留（运行时格式选择器、三档模型、非必要流量、过时文案），pi 模型清单支持改名，自动压缩按「百分比阈值 + pi 目录查表」重新接入。

**设计文档**：[../settings-pi-model-cleanup-design.md](../settings-pi-model-cleanup-design.md)（含全部决策依据，执行前先读）

**架构思路**：所有 profile 无条件 pi 化（存量数据由 `migratePiProfiles` 迁移，字段直接删除不保留兼容分支）；`piModels` 改 `{ id, label? }[]` 但 `ModelSelection.tier` 恒存模型 ID（对话数据零改动）；自动压缩利用 `prompt()`/`compact()` 都要求 harness idle 的事实放在 sendMessage 发消息前触发，无竞态。上下文窗口查表扩展到 pi-ai 全部厂商目录。排除的选项：存量 anthropic-sdk profile 的兼容渲染分支（用户确认已全部 pi 化）；按 pi 原生 reserveTokens 固定预留触发（对 1M 窗口模型要到 98% 才触发，改为百分比默认 80%）。

**涉及模块**：`app/settings/page.tsx`、`types/settings.ts`、`electron/main/services/settings-types.ts`、`settings-service.ts`、`agents/pi/provider.ts`、`agents/pi-session/pi-session.ts`、`pi-harness-adapter.ts`、`components/ModelSelector.tsx`、`lib/model-selection.ts`、`app/settings/SubAgentTab.tsx`、`components/agent-chat/usage-badge/*`、`services/usage/usage-extractor.ts`

## 步骤索引

- [x] [Step 1: SDK 痕迹清理](./step1-sdk-cleanup.md) — 删选择器/三档模型/非必要流量/相关类型与分支，migratePiProfiles 无条件 pi 化
- [x] [Step 2: 模型改名](./step2-model-label.md) — piModels 改 `{id, label?}[]`，设置页行内改名，显示链统一 `label ?? id`
- [x] [Step 3: 查表扩展 + 压缩阈值百分比](./step3-context-catalog.md) — 新建 model-catalog 查全部厂商目录，autoCompactWindow 换 autoCompactPercent，usage 徽章改造
- [ ] [Step 4: 自动压缩接入](./step4-auto-compact.md) — adapter 暴露 compact()，pi-session 发消息前按百分比阈值触发压缩

## 全局决策

- **显示名规则**：所有展示处统一 `label ?? id`；`ModelSelection.tier` 永远存模型 ID（pi 请求体 model 字段），label 纯显示，对话数据零改动
- **piModels 数据形状**：`Array<{ id: string; label?: string }>`，同 id 去重保首现顺序；旧 `string[]` 由 normalize 迁移
- **类型双份同步**：`types/settings.ts`（渲染层）与 `electron/main/services/settings-types.ts`（主进程）字段必须同步改，漏一份会运行时错乱
- **每步验收**：`bun run build`（renderer + electron）+ `bun run lint` 通过；主进程改动需 build:electron 后在 `bun run dev` 里实测设置页
- **pi 目录 import 清单**（去重后 10 个，-cn 重复目录不引入）：anthropic、openai、deepseek、zai、moonshotai、minimax、qwen-token-plan、xai、google、kimi-coding
- **行号基准**：step 文档中的行号是 2026-08-14 快照，执行时以内容定位为准
- 不写注释（项目规范）；step 完成后回填「实施回填」一节并勾选本索引
