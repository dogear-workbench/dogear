import React from 'react';

/**
 * 块内命中编号器：同一逻辑块跨多个 markdown 元素渲染时编号连续累进，
 * 保证渲染端 mark id 与 useMessageSearch 的 hitIndexInBlock 对齐
 */
export interface MatchNumbering {
  take: () => number;
}

export function createMatchNumbering(): MatchNumbering {
  let n = 0;
  return { take: () => n++ };
}

/**
 * 将文本中所有 query 匹配替换为 <mark> 元素，大小写不敏感
 * baseId: match id 前缀，格式 `${messageId}-${blockIndex}`
 * numbering: 块内编号器（缺省时本段文本内从 0 计），match id = `${baseId}-${序号}`
 * activeMatchId: 当前激活的 match id，用橙色加深
 */
export function highlightText(
  text: string,
  query: string,
  baseId: string,
  activeMatchId: string | null,
  numbering?: MatchNumbering
): React.ReactNode {
  if (!query.trim() || !text) return text;
  const q = query.toLowerCase();
  const counter = numbering ?? createMatchNumbering();
  const parts: React.ReactNode[] = [];
  let lastEnd = 0;
  const lower = text.toLowerCase();
  let idx = 0;
  let markSeq = 0;
  while ((idx = lower.indexOf(q, idx)) !== -1) {
    if (idx > lastEnd) parts.push(text.slice(lastEnd, idx));
    const matchId = `${baseId}-${counter.take()}`;
    const isActive = matchId === activeMatchId;
    parts.push(
      React.createElement('mark', {
        key: `mark-${markSeq}`,
        'data-match-id': matchId,
        className: isActive
          ? 'bg-orange-400 text-white rounded px-0.5 ring-2 ring-orange-600 dark:bg-orange-500/60 dark:ring-orange-400'
          : 'bg-yellow-200 text-foreground rounded px-0.5 dark:bg-yellow-400/30 dark:text-yellow-50',
      }, text.slice(idx, idx + q.length))
    );
    lastEnd = idx + q.length;
    idx += q.length;
    markSeq++;
  }
  if (lastEnd < text.length) parts.push(text.slice(lastEnd));
  return parts.length === 0 ? text : parts;
}
