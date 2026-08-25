import { useCallback, useEffect, useRef, useState } from 'react';

interface UseChatScrollOptions {
  scrollAreaRef: React.RefObject<HTMLDivElement | null>;
  isLoading: boolean; // AI 是否在回答中
  /** 消息稳定 ID → turnId 映射（来自 buildTurns），用于虚拟滚动跳转 */
  byMessageId?: Map<string, string>;
  /** 强制某轮进入可见范围（来自 useVirtualTurns），跳转前调用 */
  ensureTurnVisible?: (turnId: string) => void;
}

export interface ScrollOptions {
  align?: 'top-third' | 'top' | 'center'; // 默认 top-third
  behavior?: ScrollBehavior; // 默认 smooth
  flash?: boolean; // 跳转后闪烁目标,默认 false
}

interface UseChatScrollReturn {
  showScrollBtn: boolean;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  scrollToMessage: (messageId: string, opts?: ScrollOptions) => void;
  scrollToElement: (el: HTMLElement, opts?: ScrollOptions) => void;
  handleScroll: () => void;
  isFollowing: () => boolean;
}

/**
 * 聊天区统一滚动控制 hook
 *
 * 状态机: followMode = 'auto' | 'manual'
 * - auto: 任何 DOM 增高(ResizeObserver)都续滚到底
 * - manual: 保留用户当前位置,新内容到达不打扰
 *
 * 进入 auto:
 * - isLoading false→true (新一轮开始,同时触底一次)
 * - scrollToBottom() 调用
 * - 用户主动滚回距底 ≤ 64px (handleScroll 反向提升)
 *
 * 进入 manual:
 * - 用户 wheel 向上 / touchmove 向下拖 / 按 PageUp/ArrowUp/Home (capture 阶段监听,只有用户能触发)
 * - scrollToMessage / scrollToElement (跳转防回弹)
 *
 * 不改变状态: 程序滚动(打 programmaticRef 标志)、ResizeObserver 续滚、isLoading true→false
 *
 * 对齐方式默认 'top-third': 目标第一行落在可见区顶部下方 1/3 处
 */
export function useChatScroll({
  scrollAreaRef,
  isLoading,
  byMessageId,
  ensureTurnVisible,
}: UseChatScrollOptions): UseChatScrollReturn {
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const followModeRef = useRef<'auto' | 'manual'>('manual');
  const programmaticRef = useRef(false);

  const getViewport = useCallback((): HTMLElement | null => {
    return scrollAreaRef.current;
  }, [scrollAreaRef]);

  const setFollowMode = (mode: 'auto' | 'manual') => {
    followModeRef.current = mode;
  };

  const scrollViewportTo = (top: number, behavior: ScrollBehavior) => {
    const vp = getViewport();
    if (!vp) return;
    programmaticRef.current = true;
    if (behavior === 'instant') {
      vp.scrollTop = top;
      requestAnimationFrame(() => { programmaticRef.current = false; });
    } else {
      vp.scrollTo({ top, behavior: 'smooth' });
      setTimeout(() => { programmaticRef.current = false; }, 400);
    }
  };

  // ResizeObserver 随 hook 生命周期存亡，followMode=auto 时续滚
  useEffect(() => {
    const vp = getViewport();
    if (!vp) return;
    const content = vp.firstElementChild;
    if (!content) return;
    const obs = new ResizeObserver(() => {
      if (followModeRef.current === 'auto') {
        scrollViewportTo(vp.scrollHeight, 'instant');
      }
    });
    obs.observe(content);
    return () => obs.disconnect();
  }, [getViewport]);

  // isLoading false→true 时切换到自动跟随并触底一次；true→false 不做任何动作
  useEffect(() => {
    if (isLoading) {
      setFollowMode('auto');
      const vp = getViewport();
      if (vp) scrollViewportTo(vp.scrollHeight, 'instant');
    }
  }, [isLoading, getViewport]);

  // 用户介入判定：wheel/touch/keydown（浏览器因内容增长不会触发这些）
  useEffect(() => {
    const vp = getViewport();
    if (!vp) return;

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) setFollowMode('manual');
    };

    let touchStartY: number | null = null;
    const onTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (touchStartY === null) return;
      const y = e.touches[0]?.clientY ?? 0;
      if (y - touchStartY > 4) setFollowMode('manual');
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!vp.contains(document.activeElement) && document.activeElement !== document.body) return;
      if (['PageUp', 'ArrowUp', 'Home'].includes(e.key)) setFollowMode('manual');
    };

    // capture 阶段监听，避免子组件 stopPropagation 后失效
    vp.addEventListener('wheel', onWheel, { passive: true, capture: true });
    vp.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    vp.addEventListener('touchmove', onTouchMove, { passive: true, capture: true });
    window.addEventListener('keydown', onKeyDown, true);

    return () => {
      vp.removeEventListener('wheel', onWheel, { capture: true });
      vp.removeEventListener('touchstart', onTouchStart, { capture: true });
      vp.removeEventListener('touchmove', onTouchMove, { capture: true });
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [getViewport]);

  const handleScroll = useCallback(() => {
    if (programmaticRef.current) return;
    const vp = getViewport();
    if (!vp) return;
    const distance = vp.scrollHeight - vp.scrollTop - vp.clientHeight;
    setShowScrollBtn(distance >= 50);
    if (followModeRef.current === 'manual' && distance <= 64) {
      setFollowMode('auto');
    }
  }, [getViewport]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      const vp = getViewport();
      if (!vp) return;
      scrollViewportTo(vp.scrollHeight, behavior);
      setFollowMode('auto');
      setShowScrollBtn(false);
    },
    [getViewport],
  );

  const scrollToElement = useCallback(
    (el: HTMLElement, opts?: ScrollOptions) => {
      const vp = getViewport();
      if (!vp || !el) return;
      setFollowMode('manual'); // 取消自动跟随,防止被回弹

      // sticky 元素的 getBoundingClientRect 会返回"粘连后"的位置(≈ viewport 顶部),
      // 会导致向上跳转到 sticky user 消息时算出错误(只挪一点点就不动)。
      // 解决: 临时禁用 sticky,读原位,再恢复。
      const originalPosition = el.style.position;
      el.style.position = 'static';
      const vpRect = vp.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      el.style.position = originalPosition;

      // elTopInContent: 目标元素顶部相对于滚动内容顶部的绝对偏移
      const elTopInContent = elRect.top - vpRect.top + vp.scrollTop;

      const align = opts?.align ?? 'top-third';
      let targetScrollTop: number;
      if (align === 'top') {
        targetScrollTop = elTopInContent;
      } else if (align === 'center') {
        targetScrollTop =
          elTopInContent - vp.clientHeight / 2 + el.offsetHeight / 2;
      } else {
        // top-third: 目标第一行落在可见区顶部下方 1/3 处
        targetScrollTop = elTopInContent - vp.clientHeight / 3;
      }

      scrollViewportTo(Math.max(0, targetScrollTop), opts?.behavior ?? 'smooth');

      if (opts?.flash) {
        el.classList.add('minimap-flash');
        setTimeout(() => el.classList.remove('minimap-flash'), 1200);
      }
    },
    [getViewport],
  );

  const scrollToMessage = useCallback(
    (messageId: string, opts?: ScrollOptions) => {
      const vp = getViewport();
      if (!vp) return;
      const tryScroll = () => {
        const el = vp.querySelector(
          `[data-message-id="${messageId}"]`,
        ) as HTMLElement | null;
        if (el) scrollToElement(el, opts);
      };

      if (byMessageId && ensureTurnVisible) {
        const turnId = byMessageId.get(messageId);
        const el = vp.querySelector(
          `[data-message-id="${messageId}"]`,
        ) as HTMLElement | null;
        if (!el && turnId !== undefined) {
          ensureTurnVisible(turnId);
          requestAnimationFrame(tryScroll);
          return;
        }
      }
      tryScroll();
    },
    [getViewport, scrollToElement, byMessageId, ensureTurnVisible],
  );

  return {
    showScrollBtn,
    scrollToBottom,
    scrollToMessage,
    scrollToElement,
    handleScroll,
    isFollowing: () => followModeRef.current === 'auto',
  };
}
