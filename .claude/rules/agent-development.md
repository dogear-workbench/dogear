---
paths:
  - "electron/main/agents/**/*.ts"
---

# Agent 开发规则

- 修改 Agent 功能前，先查 `@anthropic-ai/claude-agent-sdk` 包中是否已有实现
  - `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — 接口定义
  - `node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts` — 工具类型
- QueryBasedSession 是当前主要的会话方式，优先在此基础上扩展
- 工具定义在 `tools/` 子目录，技能在 `skills/` 子目录
- Agent 与渲染层通信通过 `renderer-handlers.ts` 中的事件
