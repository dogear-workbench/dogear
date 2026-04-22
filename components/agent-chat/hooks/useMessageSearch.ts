import { useState, useCallback, useEffect } from 'react';
import type { Message } from '../types';

export interface SearchMatch {
  id: string;
  messageIndex: number;
  blockIndex: number; // -1=用户消息文本, -2=AI消息content字段, >=0=contentBlock索引
  textStart: number;
  textEnd: number;
}

export function useMessageSearch(messages: Message[]) {
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

      messages.forEach((msg, messageIndex) => {
        if (msg.isMeta || msg.isCompactBoundary || msg.isCompactSummary) return;

        // 用户消息：去除 XML 引用标签后匹配纯文本
        if (msg.role === 'user' && msg.content) {
          const pureText = msg.content
            .replace(/<referenced_articles>[\s\S]*?<\/referenced_articles>/g, '')
            .replace(/<quoted_snippet[^>]*>[\s\S]*?<\/quoted_snippet>/g, '')
            .replace(/<command-[a-z-]+>[\s\S]*?<\/command-[a-z-]+>/g, '')
            .replace(/^\n+/, '').trim();
          let idx = 0;
          const lower = pureText.toLowerCase();
          while ((idx = lower.indexOf(q, idx)) !== -1) {
            result.push({ id: `${messageIndex}-u-${idx}`, messageIndex, blockIndex: -1, textStart: idx, textEnd: idx + q.length });
            idx += q.length;
          }
        }

        // AI 消息 contentBlocks：只搜索 text 和 thinking 类型
        if (msg.role === 'assistant' && msg.contentBlocks) {
          msg.contentBlocks.forEach((block, blockIndex) => {
            if (block.type !== 'text' && block.type !== 'thinking') return;
            // text 块用 content，thinking 块也用 content
            const text = (block as { content?: string }).content || '';
            if (!text) return;
            const lower = text.toLowerCase();
            let idx = 0;
            while ((idx = lower.indexOf(q, idx)) !== -1) {
              result.push({ id: `${messageIndex}-${blockIndex}-${idx}`, messageIndex, blockIndex, textStart: idx, textEnd: idx + q.length });
              idx += q.length;
            }
          });
        }

        // AI 消息无 contentBlocks 时，搜索 content 字段
        if (msg.role === 'assistant' && !msg.contentBlocks && msg.content) {
          const lower = msg.content.toLowerCase();
          let idx = 0;
          while ((idx = lower.indexOf(q, idx)) !== -1) {
            result.push({ id: `${messageIndex}-c-${idx}`, messageIndex, blockIndex: -2, textStart: idx, textEnd: idx + q.length });
            idx += q.length;
          }
        }
      });

      setMatches(result);
      setActiveIndex(0);
    }, 150);
    return () => clearTimeout(timer);
  }, [query, messages]);

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
