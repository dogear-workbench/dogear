import { useEffect, useRef } from 'react';

/**
 * 统一可见性感知轮询：挂载且可见时立即执行一次并启动 interval；
 * 文档隐藏时停止 interval，恢复可见时立即执行一次并重启 interval。
 * fn 变化不重置计时（ref 转发），intervalMs 变化会重启周期。
 */
export function useVisiblePolling(fn: () => void | Promise<void>, intervalMs: number): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const start = () => {
      stop();
      timer = setInterval(() => {
        void fnRef.current();
      }, intervalMs);
    };

    const runOnce = () => {
      void fnRef.current();
    };

    const handleVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        runOnce();
        start();
      }
    };

    if (!document.hidden) {
      runOnce();
      start();
    }

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      stop();
    };
  }, [intervalMs]);
}
