import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { Message } from '../types';
import { getUserMessageSearchableText } from '../utils';
import { serializeToolField } from '../highlight';

export interface SearchMatch {
  id: string;
  messageId: string;
  // -1=用户消息文本, -2=AI消息content字段, >=0=原始 contentBlocks 索引
  blockIndex: number;
  hitIndexInBlock: number;
  // 折叠容器块（user 消息/tool_use/thinking）为 true：步进按块跳；正文块逐 mark 走
  coarse: boolean;
}

export interface SearchUnit {
  firstMatchIndex: number;
  matchCount: number;
}

function toMatch(messageId: string, blockIndex: number, hitIndexInBlock: number, coarse: boolean): SearchMatch {
  return { id: `${messageId}-${blockIndex}-${hitIndexInBlock}`, messageId, blockIndex, hitIndexInBlock, coarse };
}

function buildUnits(ms: SearchMatch[]): SearchUnit[] {
  const result: SearchUnit[] = [];
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i];
    const prev = i > 0 ? ms[i - 1] : null;
    const last = result[result.length - 1];
    // 同块 matches 在扫描序中天然连续，coarse 命中与前一命中同块时并入其所在单位（该单位必为同块 coarse 单位）
    if (m.coarse && prev && prev.messageId === m.messageId && prev.blockIndex === m.blockIndex) {
      last.matchCount++;
    } else {
      result.push({ firstMatchIndex: i, matchCount: 1 });
    }
  }
  return result;
}

function unitIndexOfMatch(units: SearchUnit[], matchIndex: number): number {
  for (let u = units.length - 1; u >= 0; u--) {
    if (units[u].firstMatchIndex <= matchIndex) return u;
  }
  return 0;
}

// 剥离 markdown 渲染端不显示的内容（fenced 代码块、html 注释），与渲染端计数口径对齐；
// 替换为换行而非空串，避免前后文本拼接产生跨界假匹配
function stripUnsearchable(text: string): string {
  return text
    .replace(/^([`~]{3,})[^\n]*\n[\s\S]*?^\1+[^\n]*(?:\n|$)/gm, '\n')
    .replace(/^([`~]{3,})[^\n]*\n[\s\S]*$/gm, '\n')
    .replace(/<!--[\s\S]*?-->/g, '\n')
    .replace(/<!--[\s\S]*$/g, '\n');
}

export function useMessageSearch(stableHistory: Message[], getLiveTail: () => Message[]) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  // 重扫保持激活位置：区分 query 变化（重置）与消息流更新触发重扫（恢复）
  const lastQueryRef = useRef('');
  const activeSnapshotRef = useRef<{ index: number; match: SearchMatch | null }>({ index: 0, match: null });

  useEffect(() => {
    activeSnapshotRef.current = { index: activeIndex, match: matches[activeIndex] ?? null };
  }, [matches, activeIndex]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setMatches([]);
    setActiveIndex(0);
  }, []);

  const units = useMemo(() => buildUnits(matches), [matches]);
  const activeUnitIndex = useMemo(
    () => (units.length === 0 ? 0 : unitIndexOfMatch(units, activeIndex)),
    [units, activeIndex],
  );

  const next = useCallback(() => {
    if (units.length === 0) return;
    setActiveIndex(i => units[(unitIndexOfMatch(units, i) + 1) % units.length].firstMatchIndex);
  }, [units]);

  const prev = useCallback(() => {
    if (units.length === 0) return;
    setActiveIndex(i => units[(unitIndexOfMatch(units, i) - 1 + units.length) % units.length].firstMatchIndex);
  }, [units]);

  // 根据 query 和 messages 重新计算所有匹配位置
  // 防抖：延迟 150ms，避免流式输出期间每帧扫描
  useEffect(() => {
    if (!query.trim()) {
      lastQueryRef.current = '';
      setMatches([]);
      setActiveIndex(0);
      return;
    }
    const timer = setTimeout(() => {
      const q = query.toLowerCase();
      const result: SearchMatch[] = [];

      const scanText = (text: string, messageId: string, blockIndex: number, coarse: boolean) => {
        if (!text) return;
        const lower = text.toLowerCase();
        let idx = 0;
        let hit = 0;
        while ((idx = lower.indexOf(q, idx)) !== -1) {
          result.push(toMatch(messageId, blockIndex, hit++, coarse));
          idx += q.length;
        }
      };

      const messages = [...stableHistory, ...getLiveTail()];
      messages.forEach((msg) => {
        if (msg.isMeta || msg.isCompactBoundary || msg.isCompactSummary || !msg.id) return;
        const messageId = msg.id;

        // 用户消息: 用统一的 searchable text(与 MessageItem 渲染用的纯文本一致)；折叠域（含注入卡），coarse 跳
        if (msg.role === 'user' && msg.content) {
          scanText(getUserMessageSearchableText(msg.content), messageId, -1, true);
        }

        // AI 消息 contentBlocks：text/thinking 搜 content 域；tool_use 搜三子域拼接单域（toolName/输入/输出，与卡片展示口径一致）
        if (msg.role === 'assistant' && msg.contentBlocks) {
          msg.contentBlocks.forEach((block, blockIndex) => {
            if (block.type === 'text' || block.type === 'thinking') {
              const raw = block.content || '';
              scanText(block.type === 'text' ? stripUnsearchable(raw) : raw, messageId, blockIndex, block.type === 'thinking');
            } else if (block.type === 'tool_use') {
              const text = [
                block.toolName || '',
                serializeToolField(block.toolInput),
                serializeToolField(block.toolOutput),
              ].filter(Boolean).join('\n');
              scanText(text, messageId, blockIndex, true);
            }
          });
        }

        // AI 消息无 contentBlocks 时，搜索 content 字段（正文 markdown 不折叠，mark 级）
        if (msg.role === 'assistant' && !msg.contentBlocks && msg.content) {
          scanText(msg.content, messageId, -2, false);
        }
      });

      setMatches(result);
      // query 未变（仅消息流更新触发重扫）时保持激活位置：同 id → 同块首个 → clamp
      if (lastQueryRef.current !== query) {
        setActiveIndex(0);
      } else {
        const { index: prevIndex, match: prevMatch } = activeSnapshotRef.current;
        let restored = prevMatch ? result.findIndex((m) => m.id === prevMatch.id) : -1;
        if (restored === -1 && prevMatch) {
          restored = result.findIndex((m) => m.messageId === prevMatch.messageId && m.blockIndex === prevMatch.blockIndex);
        }
        if (restored === -1) restored = Math.min(prevIndex, result.length - 1);
        // 恢复后对齐所在 unit 首，保证 activeIndex 永不落在 coarse 块中间
        const restoredUnits = buildUnits(result);
        setActiveIndex(restoredUnits.length ? restoredUnits[unitIndexOfMatch(restoredUnits, Math.max(0, restored))].firstMatchIndex : 0);
      }
      lastQueryRef.current = query;
    }, 150);
    return () => clearTimeout(timer);
  }, [query, stableHistory, getLiveTail]);

  return {
    isOpen,
    query,
    setQuery,
    matches,
    setMatches,
    units,
    activeUnitIndex,
    activeIndex,
    open,
    close,
    next,
    prev,
    activeMatch: matches[activeIndex] ?? null,
  };
}
