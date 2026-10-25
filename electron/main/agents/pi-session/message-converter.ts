/**
 * pi durable 事件 → 前端 ExtendedSessionMessage 转换。
 * 覆盖文本与 thinking 增量，以及工具调用的起止事件。
 * durable 事件名：tool_execution_start/tool_execution_end（0.99.2 为 tool_start/tool_end）、
 * message_update.changes（0.99.2 为 message_update.event 单事件）。
 * 一次调用可能产出多条消息（durable 的 message_update 携带增量批次），返回数组。
 *
 * 前端流式协议是纯 append（ExtendedSessionMessage 无块序概念），而 durable 的 changes 混有
 * 增量（*_delta）与块快照（*_start/block，块当前全量）：快照由批次聚合或字段 set（如 anthropic
 * thinking 流完的 signature 赋值）触发，会出现在流式中段。快照必须按「已发送长度」折算成差量
 * 再发：等量快照差量为零不发（否则 thinking 全文被当增量重插到 text 之后，打碎后续 append）；
 * 首见快照差量即全文。记账按 entry 生命周期重置（run_start / message_end）。
 */

import type { PiHarnessAgentEvent } from './pi-harness-adapter.js';
import type { ExtendedSessionMessage } from '../task-types.js';

type StreamBlockType = 'text' | 'thinking';

type FinalBlock = { type: string; text?: string; thinking?: string };

/** 终态 assistant entry 的文本/思考块（保留原 contentIndex，toolCall 等其他块不参与流式差量） */
function finalStreamBlocks(content: unknown): Array<{ contentIndex: number; blockType: StreamBlockType; text: string }> {
  if (!Array.isArray(content)) return [];
  const out: Array<{ contentIndex: number; blockType: StreamBlockType; text: string }> = [];
  content.forEach((block, contentIndex) => {
    if (!block || typeof block !== 'object') return;
    const b = block as FinalBlock;
    if (b.type === 'text') out.push({ contentIndex, blockType: 'text', text: b.text ?? '' });
    else if (b.type === 'thinking') out.push({ contentIndex, blockType: 'thinking', text: b.thinking ?? '' });
  });
  return out;
}

/** 从 pi 工具结果的 content 数组里提取纯文本，图像等非文本块静默丢弃（与前端 tool_result 展示口径一致） */
function extractToolResultText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block): block is { type: string; text?: string } => !!block && typeof block === 'object' && (block as { type?: unknown }).type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
}

export interface MessageConverter {
  convert(event: PiHarnessAgentEvent): ExtendedSessionMessage[];
}

/** 每会话一个转换器：持有各流式块的已发送长度记账 */
export function createMessageConverter(): MessageConverter {
  const sentLengths = new Map<string, number>();

  const applyDelta = (blockType: StreamBlockType, contentIndex: number, delta: string): ExtendedSessionMessage => {
    const key = `${blockType}:${contentIndex}`;
    sentLengths.set(key, (sentLengths.get(key) ?? 0) + delta.length);
    return { type: blockType, content: delta, timestamp: Date.now() };
  };

  const applySnapshot = (blockType: StreamBlockType, contentIndex: number, snapshot: string): ExtendedSessionMessage | null => {
    const key = `${blockType}:${contentIndex}`;
    const sent = sentLengths.get(key) ?? 0;
    if (snapshot.length <= sent) return null;
    const diff = snapshot.slice(sent);
    sentLengths.set(key, snapshot.length);
    return { type: blockType, content: diff, timestamp: Date.now() };
  };

  // durable 尾部 partial（stopped 后的 pending）可能静默不提交，流式增量不保证覆盖到终态；
  // message_end 按终态 entry 无条件补差量，零 partial（全文只在终态）与尾部缺块同被兑住
  const reconcileFinal = (content: unknown): ExtendedSessionMessage[] => {
    const out: ExtendedSessionMessage[] = [];
    for (const { contentIndex, blockType, text } of finalStreamBlocks(content)) {
      const msg = applySnapshot(blockType, contentIndex, text);
      if (msg) out.push(msg);
    }
    return out;
  };

  return {
    convert(event: PiHarnessAgentEvent): ExtendedSessionMessage[] {
      if (event.type === 'run_start') {
        sentLengths.clear();
      } else if (event.type === 'message_end') {
        // assistant 终态先补差量再清记账；tool-result 无文本块只需重置
        let finalMessages: ExtendedSessionMessage[] | null = null;
        if (event.entry.kind === 'pi.assistant') {
          const message = event.entry.model?.[0];
          if (message !== undefined && 'content' in message) finalMessages = reconcileFinal(message.content);
        }
        sentLengths.clear();
        if (finalMessages !== null) return finalMessages;
      }

      if (event.type === 'tool_execution_start') {
        return [{
          type: 'tool_use',
          toolName: event.toolName,
          toolInput: event.args,
          toolUseId: event.toolCallId,
          timestamp: Date.now(),
        }];
      }

      if (event.type === 'tool_execution_end') {
        // 模型发起的调用结果在 entry（pi.tool-result）的 ToolResultMessage 上；faulted/orphaned 的调用无 entry
        const message = event.entry?.model?.[0];
        const toolResult = message !== undefined && 'role' in message && message.role === 'toolResult' ? message : undefined;
        return [{
          type: 'tool_result',
          toolUseId: event.toolCallId,
          toolOutput: extractToolResultText(toolResult?.content),
          isError: toolResult?.isError ?? true,
          timestamp: Date.now(),
        }];
      }

      if (event.type !== 'message_update') return [];

      // 同批输出按 contentIndex 稳定排序：durable 的 changes 顺序跟随文档 op 顺序（如 signature set
      // 先于末尾增量，会把块 0 的差量排在块 1 的 text_start 之后），前端按「最后块类型」append，
      // 顺序错位会错插块打碎后续增量，排序后块 0 恒在块 1 前
      const outputs: Array<{ message: ExtendedSessionMessage; contentIndex: number }> = [];
      const push = (message: ExtendedSessionMessage | null, contentIndex: number) => {
        if (message) outputs.push({ message, contentIndex });
      };

      for (const change of event.changes) {
        // 'message'（generation 整体替换，仅 retry 重置时出现）前端流式无法表达重置，丢弃
        // （终态 message_end 仍完整落盘，重载历史即正确）；toolcall_* 走 tool_execution_* 独立事件，不在此处理
        if (change.type === 'text_delta') {
          push(applyDelta('text', change.contentIndex, change.delta), change.contentIndex);
        } else if (change.type === 'thinking_delta') {
          push(applyDelta('thinking', change.contentIndex, change.delta), change.contentIndex);
        } else if (change.type === 'text_start') {
          if (change.block.type === 'text') push(applySnapshot('text', change.contentIndex, change.block.text), change.contentIndex);
        } else if (change.type === 'thinking_start') {
          if (change.block.type === 'thinking') push(applySnapshot('thinking', change.contentIndex, change.block.thinking), change.contentIndex);
        } else if (change.type === 'block') {
          if (change.block.type === 'text') push(applySnapshot('text', change.contentIndex, change.block.text), change.contentIndex);
          else if (change.block.type === 'thinking') push(applySnapshot('thinking', change.contentIndex, change.block.thinking), change.contentIndex);
        }
      }
      return outputs
        .map((item, i) => ({ ...item, i }))
        .sort((a, b) => a.contentIndex - b.contentIndex || a.i - b.i)
        .map((item) => item.message);
    },
  };
}
