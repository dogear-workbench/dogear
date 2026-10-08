/**
 * pi Agent 事件 → 前端 ExtendedSessionMessage 转换。
 * 覆盖文本与 thinking 增量，以及工具调用的起止事件。
 */

import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { ExtendedSessionMessage } from '../task-types.js';

/** 从 pi 工具结果的 content 数组里提取纯文本，图像等非文本块静默丢弃（与前端 tool_result 展示口径一致） */
function extractToolResultText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block): block is { type: string; text?: string } => !!block && typeof block === 'object' && (block as { type?: unknown }).type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
}

/** 将 pi 事件转换为既有前端消息。 */
export function convertPiEvent(event: AgentEvent): ExtendedSessionMessage | null {
  if (event.type === 'tool_execution_start') {
    return {
      type: 'tool_use',
      toolName: event.toolName,
      toolInput: event.args,
      toolUseId: event.toolCallId,
      timestamp: Date.now(),
    };
  }

  if (event.type === 'tool_execution_end') {
    return {
      type: 'tool_result',
      toolUseId: event.toolCallId,
      toolOutput: extractToolResultText(event.result?.content),
      isError: event.isError,
      timestamp: Date.now(),
    };
  }

  if (event.type !== 'message_update') return null;

  const ame = event.assistantMessageEvent;
  if (ame.type === 'text_delta') {
    return {
      type: 'text',
      content: ame.delta,
      timestamp: Date.now(),
    };
  }

  if (ame.type === 'thinking_delta') {
    return {
      type: 'thinking',
      content: ame.delta,
      timestamp: Date.now(),
    };
  }

  return null;
}
