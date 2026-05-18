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
  const followRef = useRef(false);

  const getViewport = useCallback((): HTMLElement | null => {
    return (
      (scrollAreaRef.current?.querySelector(
        '[data-radix-scroll-area-viewport]',
      ) as HTMLElement | null) ?? null
    );
  }, [scrollAreaRef]);

  // AI 回答期间启用自动跟随;结束时立即关闭
  useEffect(() => {
    if (!isLoading) {
      followRef.current = false;
      return;
    }
    followRef.current = true;
    const vp = getViewport();
    if (!vp) return;
    vp.scrollTop = vp.scrollHeight; // 进入回答态立即触底一次
    const content = vp.firstElementChild;
    if (!content) return;
    const obs = new ResizeObserver(() => {
      if (followRef.current) {
        vp.scrollTop = vp.scrollHeight;
      }
    });
    obs.observe(content);
    return () => obs.disconnect();
  }, [isLoading, getViewport]);

  // 滚动时更新 showScrollBtn;回答期间同步更新 followRef
  const handleScroll = useCallback(() => {
    const vp = getViewport();
    if (!vp) return;
    const atBottom = vp.scrollHeight - vp.scrollTop - vp.clientHeight < 50;
    setShowScrollBtn(!atBottom);
    if (isLoading) {
      followRef.current = atBottom;
    }
  }, [getViewport, isLoading]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      const vp = getViewport();
      if (!vp) return;
      if (behavior === 'instant') {
        vp.scrollTop = vp.scrollHeight;
      } else {
        vp.scrollTo({ top: vp.scrollHeight, behavior: 'smooth' });
      }
      followRef.current = true;
      setShowScrollBtn(false);
    },
    [getViewport],
  );

  const scrollToElement = useCallback(
    (el: HTMLElement, opts?: ScrollOptions) => {
      const vp = getViewport();
      if (!vp || !el) return;
      followRef.current = false; // 取消自动跟随,防止被回弹

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

      vp.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: opts?.behavior ?? 'smooth',
      });

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
