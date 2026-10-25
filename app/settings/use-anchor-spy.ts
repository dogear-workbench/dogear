import { useEffect, useRef, useState } from 'react';

export interface AnchorGroup {
  id: string;
  label: string;
}

/**
 * 滚动容器取法依赖调用方结构：rootRef 直接挂在滚动容器元素上（右栏 overflow-y-auto）
 */
export function useAnchorSpy(groups: ReadonlyArray<AnchorGroup>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState(groups[0]?.id ?? '');
  const lockRef = useRef(false);
  const unlockTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const container = rootRef.current;
    if (!container) return;
    let raf = 0;
    const spy = () => {
      raf = 0;
      if (lockRef.current) return;
      const base = container.getBoundingClientRect().top;
      let current = groups[0]?.id ?? '';
      for (const g of groups) {
        const el = document.getElementById(g.id);
        if (el && el.getBoundingClientRect().top - base <= 80) current = g.id;
      }
      if (container.scrollHeight - container.scrollTop - container.clientHeight < 8) {
        current = groups[groups.length - 1]?.id ?? current;
      }
      setActiveId(current);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(spy);
    };
    const onScrollEnd = () => {
      lockRef.current = false;
      window.clearTimeout(unlockTimer.current);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    container.addEventListener('scrollend', onScrollEnd);
    spy();
    return () => {
      container.removeEventListener('scroll', onScroll);
      container.removeEventListener('scrollend', onScrollEnd);
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(unlockTimer.current);
    };
  }, [groups]);

  const scrollTo = (id: string) => {
    const container = rootRef.current;
    const el = document.getElementById(id);
    if (!container || !el) return;
    setActiveId(id);
    lockRef.current = true;
    window.clearTimeout(unlockTimer.current);
    unlockTimer.current = window.setTimeout(() => {
      lockRef.current = false;
    }, 1000);
    const top = container.scrollTop + el.getBoundingClientRect().top - container.getBoundingClientRect().top - 16;
    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  };

  return { rootRef, activeId, scrollTo };
}
