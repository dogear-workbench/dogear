---
step: 4
title: 派遣链路 + 主会话增强
status: pending
---

## 目标

CreateSession / CreateSessionBatch 加 `profile` 参数；整个派遣链路把 Profile 配置透传到 PiSession；主会话提示词注入 Profile 索引让模型按描述选择。

## 依赖上下文（接力棒输入）

- Step 2 产出：`SubAgentProfile` 类型、`AppSettings.subAgent.profiles` 结构
- Step 3 产出：PiSessionConfig 新增 `subAgentProfile` 字段、computeSubAgentActiveTools 函数
- 当前 CreateSession 工具定义：`delegation-tools.ts:64-115`，参数为 `{ task, outputPath, title? }`
- 当前 CreateSessionBatch 工具定义：`delegation-tools.ts:117-135`，参数为 `{ items: [{ task, outputPath, title? }] }`
- 当前 startChild 签名：`delegation-bridge.ts:173`，接收 `StartChildOptions`（含 spec）
- 当前 attachConversation 调用：`delegation-bridge.ts:229`
- 当前 PiSession 创建：`conversation-runtime-service.ts:96-119`

## 计划改动

### 4.1 CreateSession / CreateSessionBatch 工具加 profile 参数

- [ ] `delegation-tools.ts`：
  - CreateSession 的 zod schema 加 `profile: z.string().optional().describe('子会话 Profile 名称...')`
  - CreateSessionBatch 的 items schema 同样加 `profile` 字段
  - 调用 `startChild` 时透传 `spec.profile`
  - 更新工具 description 说明 profile 参数用途

### 4.2 delegation-bridge 透传 Profile

- [ ] `delegation-bridge.ts`：
  - `StartChildOptions.spec` 新增 `profile?: string`
  - `startChild()` 中根据 profile name 查找 `settings.subAgent.profiles`：
    - 匹配到 → 取该 Profile
    - 未指定/匹配不到 → 取 id='default' 的 Profile
  - 用 Profile 的 modelSelection / timeoutMinutes 替代旧 `settings.subAgent.modelSelection` / `settings.subAgent.timeoutMinutes`
  - cachePolicy 固定 '5m'（不再从设置读）
  - 通过 conversation.contractMetadata 或其他机制把 profile 传到 attachConversation

### 4.3 conversation-runtime-service 透传

- [ ] `conversation-runtime-service.ts` attachConversation()：
  - 从 conversation 的 contractMetadata 或传入 options 中读取 profile name
  - 查找 settings.subAgent.profiles 得到 SubAgentProfile
  - 传入 `piSessionManager.createSession({ ..., subAgentProfile: profile })`
  - 移除旧的 `cachePolicy: settings.subAgent?.cachePolicy ?? '5m'` → 固定 '5m'

### 4.4 主会话提示词注入 Profile 索引

- [ ] `session-append-templates.ts`：
  - 新增 `buildSubAgentProfileIndex(profiles: SubAgentProfile[]): string` 函数
  - 输出格式（参考 plan.md 全局决策中的示例）
- [ ] `pi-session.ts` start()：
  - 主会话（role='main' && groupId）提示词追加段中，把 `MAIN_AGENT_DELEGATION_APPEND` 替换或增强为包含 Profile 索引的版本
  - 读 `appSettings.subAgent.profiles` 生成索引文本

### 4.5 getSystemPromptSegments 更新

- [ ] `session-append-templates.ts` getSystemPromptSegments()：
  - 更新 main-agent-delegation 段的 template 为包含 Profile 索引的版本（占位文本）
  - 可选：新增 sub-agent-profile-index 段描述

## 验证

- `bun run build:electron` 编译通过
- CreateSession 工具描述中包含 profile 参数说明
- 主会话提示词末尾出现 Profile 索引列表
- 派遣子会话时指定 profile='xxx'，子会话启动后工具集和提示词与该 Profile 一致
- 不指定 profile 时走默认 Profile

## 实施回填（做完后填）

### 实际改动
- （待填）

### 给下一步的接力棒
- Profile 索引注入的代码位置
- delegation-tools 中 CreateSession/CreateSessionBatch 的最终参数 schema
