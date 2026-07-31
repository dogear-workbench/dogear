/**
 * pi Agent 事件 → 前端 ExtendedSessionMessage 转换
 * 与现有 QueryBasedSession.convertSDKMessage 对应，但只覆盖 pi 目前产出的事件形状。
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

/**
 * Step 1（walking skeleton）只处理文本增量，映射到 type:'text'。
 * Step 3 补上 tool_execution_start/tool_execution_end（Agent 顶层事件，非 assistantMessageEvent）→ tool_use/tool_result。
 * 后续 step 还可以再追加 thinking_delta → thinking。
 */
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

  return null;
}
