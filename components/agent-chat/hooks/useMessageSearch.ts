import { useState, useCallback, useEffect } from 'react';
import type { Message } from '../types';
import { getUserMessageSearchableText } from '../utils';
import { serializeToolField } from '../highlight';

export interface SearchMatch {
  id: string;
  messageId: string;
  // -1=用户消息文本, -2=AI消息content字段, >=0=原始 contentBlocks 索引
  blockIndex: number;
  hitIndexInBlock: number;
}

function toMatch(messageId: string, blockIndex: number, hitIndexInBlock: number): SearchMatch {
  return { id: `${messageId}-${blockIndex}-${hitIndexInBlock}`, messageId, blockIndex, hitIndexInBlock };
}

export function useMessageSearch(stableHistory: Message[], getLiveTail: () => Message[]) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setMatches([]);
    setActiveIndex(0);
  }, []);

  const next = useCallback(() => {
    if (matches.length === 0) return;
    setActiveIndex(i => (i + 1) % matches.length);
  }, [matches.length]);

  const prev = useCallback(() => {
    if (matches.length === 0) return;
    setActiveIndex(i => (i - 1 + matches.length) % matches.length);
  }, [matches.length]);

  // 根据 query 和 messages 重新计算所有匹配位置
  // 防抖：延迟 150ms，避免流式输出期间每帧扫描
  useEffect(() => {
    if (!query.trim()) {
      setMatches([]);
      setActiveIndex(0);
      return;
    }
    const timer = setTimeout(() => {
      const q = query.toLowerCase();
      const result: SearchMatch[] = [];

      const scanText = (text: string, messageId: string, blockIndex: number) => {
        if (!text) return;
        const lower = text.toLowerCase();
        let idx = 0;
        let hit = 0;
        while ((idx = lower.indexOf(q, idx)) !== -1) {
          result.push(toMatch(messageId, blockIndex, hit++));
          idx += q.length;
        }
      };

      const messages = [...stableHistory, ...getLiveTail()];
      messages.forEach((msg) => {
        if (msg.isMeta || msg.isCompactBoundary || msg.isCompactSummary || !msg.id) return;
        const messageId = msg.id;

        // 用户消息: 用统一的 searchable text(与 MessageItem 渲染用的纯文本一致)
        if (msg.role === 'user' && msg.content) {
          scanText(getUserMessageSearchableText(msg.content), messageId, -1);
        }

        // AI 消息 contentBlocks：text/thinking 搜 content 域；tool_use 搜三子域拼接单域（toolName/输入/输出，与卡片展示口径一致）
        if (msg.role === 'assistant' && msg.contentBlocks) {
          msg.contentBlocks.forEach((block, blockIndex) => {
            if (block.type === 'text' || block.type === 'thinking') {
              scanText(block.content || '', messageId, blockIndex);
            } else if (block.type === 'tool_use') {
              const text = [
                block.toolName || '',
                serializeToolField(block.toolInput),
                serializeToolField(block.toolOutput),
              ].filter(Boolean).join('\n');
              scanText(text, messageId, blockIndex);
            }
          });
        }

        // AI 消息无 contentBlocks 时，搜索 content 字段
        if (msg.role === 'assistant' && !msg.contentBlocks && msg.content) {
          scanText(msg.content, messageId, -2);
        }
      });

      setMatches(result);
      setActiveIndex(0);
    }, 150);
    return () => clearTimeout(timer);
  }, [query, stableHistory, getLiveTail]);

  return {
    isOpen,
    query,
    setQuery,
    matches,
    setMatches,
    activeIndex,
    open,
    close,
    next,
    prev,
    activeMatch: matches[activeIndex] ?? null,
  };
}
