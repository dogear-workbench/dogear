import { isSdkInjectedUserMessage, isInjectedUserMessage } from './utils';
import type { Message } from './types';

export interface Turn {
  turnId: string;
  /** 吸顶的用户消息稳定 ID；null = 无头轮（开头 assistant / 折叠后的 boundary 段） */
  headerId: string | null;
  /** 头是否注入类消息：task-execution，或无人值守语境（上一轮也无人话头）下开轮的交付/终态/续跑注入 */
  headerInjected: boolean;
  /** 本轮所有被渲染消息的稳定 ID，按顺序，含 header */
  memberIds: string[];
}

export interface BuildTurnsResult {
  turns: Turn[];
  /** 消息稳定 ID → turnId（仅含被渲染的消息） */
  byMessageId: Map<string, string>;
  /** 消息稳定 ID → 原始扁平下标（渲染/预览反查消息对象用） */
  indexById: Map<string, number>;
}

function isHeader(msg: Message): boolean {
  return (
    msg.role === 'user' &&
    !msg.isMeta &&
    !msg.isCompactBoundary &&
    !msg.isCompactSummary &&
    !isSdkInjectedUserMessage(msg.content) &&
    !isInjectedUserMessage(msg.content)
  );
}

/**
 * 轮次头优先级：真人消息 > task-execution 注入 > 无人值守语境下的其他注入
 * （交付/终态/续跑注入只在上一轮头也是注入类、或尚无轮时才开新轮——
 * 有人值守会话中它们仍并入当前真人轮，吸顶与小地图真人语义不变）。
 */
export function buildTurns(
  messages: Message[],
  opts: { collapsed: boolean },
): BuildTurnsResult {
  const turns: Turn[] = [];
  const byMessageId = new Map<string, string>();
  const indexById = new Map<string, number>();

  let hiddenUntilIdx = -1;
  if (opts.collapsed) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].isCompactBoundary) {
        hiddenUntilIdx = i;
        break;
      }
    }
  }

  messages.forEach((msg, i) => {
    if (i < hiddenUntilIdx) return; // 折叠隐藏区，不渲染

    const id = msg.id ?? `idx-${i}`;
    indexById.set(id, i);
    const isTaskExec = msg.role === 'user' && msg.content.includes('<task-execution>');
    const isInjectedEvent = msg.role === 'user' && isInjectedUserMessage(msg.content);
    if (isHeader(msg)) {
      turns.push({ turnId: `turn-${id}`, headerId: id, headerInjected: false, memberIds: [id] });
    } else if (isTaskExec) {
      turns.push({ turnId: `turn-${id}`, headerId: id, headerInjected: true, memberIds: [id] });
    } else if (isInjectedEvent && (turns.length === 0 || turns[turns.length - 1].headerInjected)) {
      turns.push({ turnId: `turn-${id}`, headerId: id, headerInjected: true, memberIds: [id] });
    } else if (turns.length === 0) {
      turns.push({ turnId: `turn-${id}`, headerId: null, headerInjected: false, memberIds: [id] });
    } else {
      turns[turns.length - 1].memberIds.push(id);
    }
    byMessageId.set(id, turns[turns.length - 1].turnId);
  });

  return { turns, byMessageId, indexById };
}
