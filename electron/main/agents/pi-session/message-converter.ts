/**
 * pi Agent 事件 → 前端 ExtendedSessionMessage 转换
 * 与现有 QueryBasedSession.convertSDKMessage 对应，但只覆盖 pi 目前产出的事件形状。
 */

import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { ExtendedSessionMessage } from '../task-types.js';

/**
 * Step 1（walking skeleton）只处理文本增量，映射到 type:'text'。
 * 后续 step 在这里追加 case：
 * - toolcall_start/toolcall_end → tool_use
 * - thinking_delta → thinking
 * - agent 侧 tool_execution_start/tool_execution_end（AgentEvent 顶层类型，非 assistantMessageEvent）→ tool_use/tool_result
 */
export function convertPiEvent(event: AgentEvent): ExtendedSessionMessage | null {
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
