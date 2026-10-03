---
step: 7
title: 用户上传图片
status: done
---

## 目标

会话输入框支持图片附件（拖拽/粘贴/按钮三入口择优），主会话（无视觉模型）收到图片时自动转派有视觉的子会话处理。

## 依赖上下文（接力棒输入）

- **依赖 Step 1**：read 图片能力已通（子会话侧识图链路完整）
- 已有的消息链路：`tipc/agent.ts:233` 已处理 Anthropic 形状 base64 image 块 → `pi-session.ts` splitContentBlocks 转 pi-ai ImageContent → 模型（**先实测验证这条用户消息图片链路是否真的通**：派一个用 Flash 的子会话，向它注入带图消息，确认它能看见）
- 模型拓扑：主会话 glm-5.3 无视觉；子会话 GLM-5.3-Flash 有视觉——路由约定（全局决策）：主会话收到图一律转派子会话，不在主会话内尝试
- 输入框现状：会话输入组件（渲染层），需盘点粘贴/拖拽事件现状

## 计划改动

- [ ] 实测用户消息图片链路（tipc→pi-session→Flash），不通则修
- [ ] 渲染层输入框：图片粘贴 + 拖拽 + 附件按钮（至少实现粘贴与按钮，拖拽看成本），图片预览缩略图、大小限制（对齐 step1 上限）、发送时转 base64 image 块
- [ ] 主会话路由：消息含图且当前模型无视觉时——自动转派子会话（任务描述含图与用户意图），会话内呈现转派说明；具体交互（静默转派 vs 询问）实施时定，倾向静默+结果回流呈现
- [ ] 临时会话/子会话收到图：直接进上下文（Flash 有视觉）
- [ ] 验证：真机——输入框粘贴一张图发给主会话，观察转派与识图结果

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 用户消息图片链路实测结论：通，无需修复（splitContentBlocks 抽为 content-blocks.ts 纯函数 + 4 单测；Agent.normalizePromptInput 实机验证 image 块完整进 user message；anthropic-messages 序列化层 image 无条件发送不查 model.input）
  - 粘贴/按钮/预览/发送转 base64 均为存量已实现，本步实际补齐：5MB 上限（useImageAttachment 过滤+toast）+ 拖拽入口（ChatInputArea dragenter/leave 计数器 + 高亮 + onDrop）
  - 「转派子会话」落地为 runOnce(maxTurns=1) 一次性识图（vision-shunt.ts）而非完整子会话：感知任务非协作任务，语义等价（识图由有视觉模型完成）且更轻；静默转派 + `<image_description>` 描述块注入主会话 + status 行呈现过程，失败降级纯文本
  - 视觉能力感知用配置化 supportsVision 标记（piModels 条目，缺省 false 保守），ai.visionModelSelection 可指定识图模型（null=自动取第一个 supportsVision 模型），未硬编码模型 ID
  - ContentBlockItem 补 case 'status' 渲染（计划外必要：status 块原不渲染，转派说明需要载体）
- 改动文件清单：
  - 新：`electron/main/agents/pi-session/content-blocks.ts` + `.test.ts`（splitContentBlocks 纯函数化）、`electron/main/agents/pi-session/vision-shunt.ts`（识图转派）
  - 主进程：`electron/main/tipc/agent.ts`（含图消息拦截→vision-shunt）、`electron/main/agents/pi/provider.ts`（supportsVision → model.input）、`electron/main/agents/pi/run-once.ts`、`electron/main/agents/pi-session/pi-session.ts`、`electron/main/services/settings-types.ts` + `types/settings.ts`（visionModelSelection）
  - 渲染层：`components/agent-chat/ChatInputArea.tsx`（拖拽）、`components/agent-chat/hooks/useImageAttachment.ts`（5MB）、`components/agent-chat/ContentBlockItem.tsx`（status 渲染）、`app/settings/BehaviorTab.tsx` + `ProfilesTab.tsx` + `pi-model-row.tsx`（视觉模型设置 UI）
- 验证：build:electron / build:renderer / bun test 510 pass / eslint 0 errors 均过；真机验证清单在共享区交付文档

### 给下一步的接力棒
- 路由策略最终形态：主会话消息含图且当前模型 supportsVision≠true → vision-shunt 静默识图（runOnce maxTurns=1）→ 描述块注入；子会话/临时会话不拦直接进上下文；识图模型由 ai.visionModelSelection 或首个 supportsVision 模型决定
- 待办或已知限制：①用户需在设置页把 GLM-5.3-Flash 勾「视觉」否则主会话收图只得未配置提示；②历史回放图片缩略图 blob URL 重启失效（描述文本持久）；③识图用量不进会话 usage 统计
