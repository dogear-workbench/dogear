import { isSdkInjectedUserMessage } from './utils';
import type { Message } from './types';

export interface Turn {
  turnId: number;
  /** 吸顶的用户消息下标；null = 无头轮（开头 assistant / 折叠后的 boundary 段） */
  headerIdx: number | null;
  /** 本轮所有被渲染消息的原始扁平下标，按顺序，含 header */
  memberIdxs: number[];
}

export interface BuildTurnsResult {
  turns: Turn[];
  /** 原始扁平下标 → turnId（仅含被渲染的消息） */
  turnByIndex: Map<number, number>;
}

function isHeader(msg: Message): boolean {
  return (
    msg.role === 'user' &&
    !msg.isMeta &&
    !msg.isCompactBoundary &&
    !msg.isCompactSummary &&
    !isSdkInjectedUserMessage(msg.content)
  );
}

export function buildTurns(
  messages: Message[],
  opts: { collapsed: boolean },
): BuildTurnsResult {
  const turns: Turn[] = [];
  const turnByIndex = new Map<number, number>();
  let currentTid = -1;

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

    if (isHeader(msg)) {
      currentTid += 1;
      turns.push({ turnId: currentTid, headerIdx: i, memberIdxs: [i] });
    } else if (currentTid === -1) {
      currentTid = 0;
      turns.push({ turnId: 0, headerIdx: null, memberIdxs: [i] });
    } else {
      turns[turns.length - 1].memberIdxs.push(i);
    }
    turnByIndex.set(i, currentTid);
  });

  return { turns, turnByIndex };
}
