import React from 'react';

/**
 * 将文本中所有 query 匹配替换为 <mark> 元素，大小写不敏感
 * baseId: match id 前缀，格式需和 useMessageSearch 中一致
 * activeMatchId: 当前激活的 match id，用橙色加深
 */
export function highlightText(
  text: string,
  query: string,
  baseId: string,
  activeMatchId: string | null
): React.ReactNode {
  if (!query.trim() || !text) return text;
  const q = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let lastEnd = 0;
  const lower = text.toLowerCase();
  let idx = 0;
  let counter = 0;
  while ((idx = lower.indexOf(q, idx)) !== -1) {
    if (idx > lastEnd) parts.push(text.slice(lastEnd, idx));
    const matchId = `${baseId}-${idx}`;
    const isActive = matchId === activeMatchId;
    parts.push(
      React.createElement('mark', {
        key: `mark-${counter}`,
        'data-match-id': matchId,
        style: { background: 'transparent' },
        className: isActive
          ? 'text-orange-600 font-medium'
          : 'text-orange-500',
      }, text.slice(idx, idx + q.length))
    );
    lastEnd = idx + q.length;
    idx += q.length;
    counter++;
  }
  if (lastEnd < text.length) parts.push(text.slice(lastEnd));
  return parts.length === 0 ? text : parts;
}
