import { useEffect, useRef } from 'react';

/**
 * 拖拽时靠近容器边缘自动滚动
 * 当拖拽元素靠近 ScrollArea viewport 上/下边缘时，自动滚动容器
 *
 * @param getViewport - 获取滚动容器 DOM 元素的函数
 * @param options.edgeSize - 触发滚动的边缘区域大小（默认 40px）
 * @param options.maxSpeed - 最大滚动速度（默认 15px/frame）
 */
export function useDragAutoScroll(
  getViewport: () => HTMLElement | null,
  options?: {
    edgeSize?: number;
    maxSpeed?: number;
  },
) {
  const edgeSize = options?.edgeSize ?? 40;
  const maxSpeed = options?.maxSpeed ?? 15;

  const rafId = useRef<number | null>(null);
  const scrollDirection = useRef<'up' | 'down' | null>(null);
  const scrollSpeed = useRef(0);

  useEffect(() => {
    const viewport = getViewport();
    if (!viewport) return;

    // 获取包含 viewport 的最外层容器来监听 dragover
    // 因为 viewport 可能不是直接接收拖拽事件的元素
    const container = viewport.closest('[data-slot="scroll-area"]') || viewport.parentElement || viewport;

    const startScrollLoop = () => {
      if (rafId.current !== null) return;

      const tick = () => {
        const vp = getViewport();
        if (!vp || scrollDirection.current === null) {
          rafId.current = null;
          return;
        }

        if (scrollDirection.current === 'up') {
          vp.scrollTop -= scrollSpeed.current;
        } else {
          vp.scrollTop += scrollSpeed.current;
        }

        rafId.current = requestAnimationFrame(tick);
      };

      rafId.current = requestAnimationFrame(tick);
    };

    const stopScrollLoop = () => {
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
      scrollDirection.current = null;
      scrollSpeed.current = 0;
    };

    const handleDragOver = (e: DragEvent) => {
      const vp = getViewport();
      if (!vp) return;

      const rect = vp.getBoundingClientRect();
      const mouseY = e.clientY;

      const distanceFromTop = mouseY - rect.top;
      const distanceFromBottom = rect.bottom - mouseY;

      if (distanceFromTop < edgeSize && distanceFromTop >= 0) {
        // 靠近顶部，向上滚动
        const ratio = 1 - distanceFromTop / edgeSize;
        scrollDirection.current = 'up';
        scrollSpeed.current = Math.ceil(ratio * maxSpeed);
        startScrollLoop();
      } else if (distanceFromBottom < edgeSize && distanceFromBottom >= 0) {
        // 靠近底部，向下滚动
        const ratio = 1 - distanceFromBottom / edgeSize;
        scrollDirection.current = 'down';
        scrollSpeed.current = Math.ceil(ratio * maxSpeed);
        startScrollLoop();
      } else {
        stopScrollLoop();
      }
    };

    const handleDragEnd = () => {
      stopScrollLoop();
    };

    const handleDrop = () => {
      stopScrollLoop();
    };

    container.addEventListener('dragover', handleDragOver as EventListener);
    container.addEventListener('dragend', handleDragEnd);
    container.addEventListener('drop', handleDrop);
    // 拖拽离开容器时也停止
    container.addEventListener('dragleave', (e: Event) => {
      const de = e as DragEvent;
      const rect = container.getBoundingClientRect();
      if (
        de.clientX <= rect.left || de.clientX >= rect.right ||
        de.clientY <= rect.top || de.clientY >= rect.bottom
      ) {
        stopScrollLoop();
      }
    });

    return () => {
      stopScrollLoop();
      container.removeEventListener('dragover', handleDragOver as EventListener);
      container.removeEventListener('dragend', handleDragEnd);
      container.removeEventListener('drop', handleDrop);
    };
  }, [getViewport, edgeSize, maxSpeed]);
}
