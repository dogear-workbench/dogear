import { useState, useCallback } from 'react';

export interface SearchMatch {
  id: string;
  messageIndex: number;
  blockIndex: number; // -1=用户消息文本, -2=AI消息content字段, >=0=contentBlock索引
  textStart: number;
  textEnd: number;
}

export function useMessageSearch() {
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
