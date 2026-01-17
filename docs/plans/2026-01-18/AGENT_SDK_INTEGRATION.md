# Dogear Agent SDK 集成说明

## 架构概述

```
[调试窗口/主窗口]
       ↓
[IPC 通信]
       ↓
[Agent Manager] ←→ [Agent Workers]
       ↓
[Chat Skill]
       ↓
[@anthropic-ai/claude-agent-sdk 的 query 函数]
       ↓
[Claude Agent 进程 (Claude Code CLI)]
```

## 关键组件

### 1. SDK 导出 (lib/sdk/index.ts)

直接从 `@anthropic-ai/claude-agent-sdk` 重新导出 `query` 函数:

```typescript
export { query } from '@anthropic-ai/claude-agent-sdk';
```

### 2. Agent Worker (electron/main/agents/)

Agent Worker 使用 `@anthropic-ai/claude-agent-sdk` 的 `query` 函数:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

// 使用 query 函数
const agentQuery = query({
  prompt: '用户消息',
  options: {
    systemPrompt: '系统提示词',
    model: 'claude-sonnet-4-5-20250929'
  }
});

// query 是一个异步生成器
for await (const message of agentQuery) {
  if (message.type === 'assistant') {
    console.log('助手响应:', message.message.content);
  } else if (message.type === 'result') {
    console.log('任务完成');
    break;
  }
}
```

### 3. 调试窗口 (app/debug/page.tsx)

调试窗口通过 IPC 与 Agent Manager 通信:

```typescript
// 发送消息
await window.electronDebug.sendAgentMessage('你好');

// 监听响应
window.electronDebug.onAgentMessage((message) => {
  console.log('收到消息:', message);
});
```

## 使用流程

### 在 Chat Skill 中使用

1. **接收用户消息**
2. **调用 `query` 函数**
3. **迭代响应消息**
4. **返回结果给 Agent Manager**

```typescript
export async function executeChatSkill(params: ChatSkillParams) {
  const agentQuery = query({
    prompt: params.messages[params.messages.length - 1].content,
    options: {
      systemPrompt: buildSystemPrompt(params.context)
    }
  });

  let fullResponse = '';
  for await (const message of agentQuery) {
    if (message.type === 'assistant') {
      fullResponse = message.message.content;
    } else if (message.type === 'result') {
      break;
    }
  }

  return { response: fullResponse, timestamp: Date.now() };
}
```

### 在调试窗口中测试

1. **打开调试窗口**(自动在开发环境打开)
2. **输入消息**
3. **查看 Agent 响应**

## 消息类型

`query` 函数返回的消息类型:

- `SDKAssistantMessage`: 助手响应
- `SDKUserMessage`: 用户消息
- `SDKSystemMessage`: 系统消息
- `SDKResultMessage`: 最终结果
- `SDKPartialAssistantMessage`: 部分消息(流式)

## 配置选项

常用的 `query` 选项:

```typescript
{
  systemPrompt: string | { type: 'text', text: string };
  model: string;
  temperature: number;
  maxTokens: number;
  includePartialMessages: boolean; // 启用流式
  // ... 更多选项见文档
}
```

## 注意事项

1. **query 函数会启动 Claude Agent 进程**,需要确保系统已安装 Claude Code CLI
2. **每个 Agent Worker 可以独立调用 query**
3. **调试窗口显示所有对话**,方便开发调试
4. **生产环境不显示调试窗口**

## 故障排查

### Claude Code CLI 未找到

确保已安装 Claude Code CLI:
```bash
npm install -g @anthropic-ai/claude-code
```

### 查询超时

检查网络连接和 API 密钥配置。

### Workers 状态异常

查看 Agent Manager 日志:
```typescript
await window.electronAPI.agent.getStatus();
```
