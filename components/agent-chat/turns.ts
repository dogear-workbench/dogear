import { isSdkInjectedUserMessage, isInjectedUserMessage } from './utils';
import type { Message } from './types';

export interface Turn {
  turnId: string;
  /** 吸顶的用户消息稳定 ID；null = 无头轮（开头 assistant / 折叠后的 boundary 段） */
  headerId: string | null;
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
    if (isHeader(msg)) {
      turns.push({ turnId: `turn-${id}`, headerId: id, memberIds: [id] });
    } else if (turns.length === 0) {
      turns.push({ turnId: `turn-${id}`, headerId: null, memberIds: [id] });
    } else {
      turns[turns.length - 1].memberIds.push(id);
    }
    byMessageId.set(id, turns[turns.length - 1].turnId);
  });

  return { turns, byMessageId, indexById };
}
