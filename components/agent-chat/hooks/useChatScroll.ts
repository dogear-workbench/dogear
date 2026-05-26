import { useCallback, useEffect, useRef, useState } from 'react';

interface UseChatScrollOptions {
  scrollAreaRef: React.RefObject<HTMLDivElement | null>;
  isLoading: boolean; // AI 是否在回答中
}

export interface ScrollOptions {
  align?: 'top-third' | 'top' | 'center'; // 默认 top-third
  behavior?: ScrollBehavior; // 默认 smooth
  flash?: boolean; // 跳转后闪烁目标,默认 false
}

interface UseChatScrollReturn {
  showScrollBtn: boolean;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  scrollToMessage: (messageIndex: number, opts?: ScrollOptions) => void;
  scrollToElement: (el: HTMLElement, opts?: ScrollOptions) => void;
  handleScroll: () => void;
}

/**
 * 聊天区统一滚动控制 hook
 *
 * 行为约定:
 * - AI 回答期间(isLoading=true): 自动跟随底部,用户向上滚立即停止跟随
 * - AI 回答结束后: 完全交还控制权给用户,不再有任何自动滚动
 * - scrollToMessage / scrollToElement: 立即关闭跟随,确保跳转不被回弹
 * - 对齐方式默认 'top-third': 目标第一行落在可见区顶部下方 1/3 处
 */
export function useChatScroll({
  scrollAreaRef,
  isLoading,
}: UseChatScrollOptions): UseChatScrollReturn {
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  // Task 1: 新状态机基础——followModeRef 是目标状态，followRef 是向下兼容的镜像（Task 4 删除）
  const followModeRef = useRef<'auto' | 'manual'>('manual');
  const programmaticRef = useRef(false);
  // followRef 保留兼容语义：true ↔ followModeRef='auto'，Task 4 删除
  const followRef = useRef(false);

  const getViewport = useCallback((): HTMLElement | null => {
    return (
      (scrollAreaRef.current?.querySelector(
        '[data-radix-scroll-area-viewport]',
      ) as HTMLElement | null) ?? null
    );
  }, [scrollAreaRef]);

  const setFollowMode = (mode: 'auto' | 'manual') => {
    followModeRef.current = mode;
    followRef.current = mode === 'auto';
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

  // AI 回答期间启用自动跟随;结束时立即关闭
  useEffect(() => {
    if (!isLoading) {
      setFollowMode('manual');
      return;
    }
    setFollowMode('auto');
    const vp = getViewport();
    if (!vp) return;
    scrollViewportTo(vp.scrollHeight, 'instant'); // 进入回答态立即触底一次
    const content = vp.firstElementChild;
    if (!content) return;
    const obs = new ResizeObserver(() => {
      if (followModeRef.current === 'auto') {
        scrollViewportTo(vp.scrollHeight, 'instant');
      }
    });
    obs.observe(content);
    return () => obs.disconnect();
  }, [isLoading, getViewport]);

  // Task 2-3 会重写：用户介入判定迁移到 wheel/touch/keydown，本函数只负责 UI 标志
  const handleScroll = useCallback(() => {
    const vp = getViewport();
    if (!vp) return;
    const distance = vp.scrollHeight - vp.scrollTop - vp.clientHeight;
    const atBottom = distance <= 4;
    setShowScrollBtn(distance >= 50);
    if (isLoading) {
      setFollowMode(atBottom ? 'auto' : 'manual');
    }
  }, [getViewport, isLoading]);

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
    (messageIndex: number, opts?: ScrollOptions) => {
      const vp = getViewport();
      if (!vp) return;
      const el = vp.querySelector(
        `[data-message-id="msg-${messageIndex}"]`,
      ) as HTMLElement | null;
      if (!el) return;
      scrollToElement(el, opts);
    },
    [getViewport, scrollToElement],
  );

  return {
    showScrollBtn,
    scrollToBottom,
    scrollToMessage,
    scrollToElement,
    handleScroll,
  };
}
