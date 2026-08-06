import { useCallback, useEffect, useRef, useState } from 'react';
import type { Turn } from '../turns';

const DEFAULT_ESTIMATE_HEIGHT = 400;
const BUFFER_TURNS = 1;

export interface UseVirtualTurnsParams {
  turns: Turn[];
  scrollContainerRef: React.RefObject<HTMLElement | null>;
  estimateTurnHeight?: number;
}

export interface UseVirtualTurnsResult {
  visibleTurnIds: Set<number>;
  turnHeights: Map<number, number>;
  /** 返回缓存的 ref callback，避免每次渲染产生新引用 */
  getTurnRef: (turnId: number) => (el: HTMLElement | null) => void;
  registerTurnElement: (turnId: number, el: HTMLElement | null) => void;
  ensureTurnVisible: (turnId: number) => void;
}

export function useVirtualTurns({
  turns,
  scrollContainerRef,
  estimateTurnHeight = DEFAULT_ESTIMATE_HEIGHT,
}: UseVirtualTurnsParams): UseVirtualTurnsResult {
  const estimate = estimateTurnHeight;

  const heightCacheRef = useRef<Map<number, number>>(new Map());
  const [turnHeights, setTurnHeights] = useState<Map<number, number>>(new Map());
  const [visibleTurnIds, setVisibleTurnIds] = useState<Set<number>>(new Set());

  const forcedVisibleRef = useRef<Set<number>>(new Set());
  const rafIdRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  const elementMapRef = useRef<Map<number, HTMLElement>>(new Map());
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const getViewport = useCallback((): HTMLElement | null => {
    const el = scrollContainerRef.current;
    if (!el) return null;
    return (
      (el.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null) ??
      el
    );
  }, [scrollContainerRef]);

  const recompute = useCallback(() => {
    const vp = getViewport();
    if (!vp || turns.length === 0) {
      setVisibleTurnIds(new Set());
      return;
    }

    const { scrollTop, clientHeight } = vp;
    const cache = heightCacheRef.current;

    const visible = new Set<number>();
    const forced = forcedVisibleRef.current;
    let cumul = 0;
    const viewTop = scrollTop - clientHeight * BUFFER_TURNS;
    const viewBottom = scrollTop + clientHeight + clientHeight * BUFFER_TURNS;

    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      const h = cache.get(turn.turnId) ?? estimate;
      const turnTop = cumul;
      const turnBottom = cumul + h;
      cumul = turnBottom;

      if (turnBottom < viewTop) continue;
      if (turnTop > viewBottom) break;

      visible.add(turn.turnId);
    }

    for (const tid of forced) {
      visible.add(tid);
    }

    setVisibleTurnIds((prev) => {
      if (prev.size === visible.size) {
        let same = true;
        for (const id of visible) {
          if (!prev.has(id)) { same = false; break; }
        }
        if (same) return prev;
      }
      return visible;
    });
  }, [turns, getViewport, estimate]);

  // rAF 合并：同一帧内的多次 flush 请求只执行一次 recompute + setTurnHeights
  const scheduleFlush = useCallback(() => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      if (dirtyRef.current) {
        dirtyRef.current = false;
        setTurnHeights(new Map(heightCacheRef.current));
      }
      recompute();
    });
  }, [recompute]);

  // turns 变化时：为新轮次填预估高度，清掉过期的
  useEffect(() => {
    const cache = heightCacheRef.current;
    const validIds = new Set(turns.map((t) => t.turnId));

    for (const turn of turns) {
      if (!cache.has(turn.turnId)) {
        cache.set(turn.turnId, estimate);
      }
    }
    for (const key of cache.keys()) {
      if (!validIds.has(key)) cache.delete(key);
    }

    dirtyRef.current = true;
    scheduleFlush();
  }, [turns, estimate, scheduleFlush]);

  const measureElement = useCallback((turnId: number, el: HTMLElement) => {
    const h = el.getBoundingClientRect().height;
    const cache = heightCacheRef.current;
    const current = cache.get(turnId);
    if (current === undefined || Math.abs(current - h) > 1) {
      cache.set(turnId, h);
      dirtyRef.current = true;
      scheduleFlush();
    }
  }, [scheduleFlush]);

  const ensureResizeObserver = useCallback(() => {
    if (resizeObserverRef.current) return resizeObserverRef.current;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const turnId = (entry.target as HTMLElement).dataset.virtualTurnId;
        if (turnId === undefined) continue;
        measureElement(Number(turnId), entry.target as HTMLElement);
      }
    });
    resizeObserverRef.current = obs;
    return obs;
  }, [measureElement]);

  const registerTurnElement = useCallback((turnId: number, el: HTMLElement | null) => {
    const elementMap = elementMapRef.current;
    const prev = elementMap.get(turnId);

    if (el) {
      if (prev === el) return;
      el.dataset.virtualTurnId = String(turnId);
      elementMap.set(turnId, el);
      measureElement(turnId, el);
      ensureResizeObserver().observe(el);
    } else {
      if (prev) {
        resizeObserverRef.current?.unobserve(prev);
        elementMap.delete(turnId);
      }
    }
  }, [measureElement, ensureResizeObserver]);

  const ensureTurnVisible = useCallback((turnId: number) => {
    forcedVisibleRef.current.add(turnId);
    recompute();
    requestAnimationFrame(() => {
      forcedVisibleRef.current.delete(turnId);
    });
  }, [recompute]);

  // 缓存 per-turnId 的 ref callback，避免每次渲染产生新引用
  const turnRefCacheRef = useRef<Map<number, (el: HTMLElement | null) => void>>(new Map());
  const getTurnRef = useCallback((turnId: number) => {
    let cb = turnRefCacheRef.current.get(turnId);
    if (!cb) {
      cb = (el: HTMLElement | null) => registerTurnElement(turnId, el);
      turnRefCacheRef.current.set(turnId, cb);
    }
    return cb;
  }, [registerTurnElement]);

  // scroll 事件 → rAF 节流重算
  useEffect(() => {
    const vp = getViewport();
    if (!vp) return;
    const onScroll = () => scheduleFlush();
    vp.addEventListener('scroll', onScroll, { passive: true });
    return () => vp.removeEventListener('scroll', onScroll);
  }, [getViewport, scheduleFlush]);

  // viewport 尺寸变化 → 重算
  useEffect(() => {
    const vp = getViewport();
    if (!vp) return;
    const obs = new ResizeObserver(() => scheduleFlush());
    obs.observe(vp);
    return () => obs.disconnect();
  }, [getViewport, scheduleFlush]);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
    };
  }, []);

  return {
    visibleTurnIds,
    turnHeights,
    getTurnRef,
    registerTurnElement,
    ensureTurnVisible,
  };
}
