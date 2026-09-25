import { useEffect, useLayoutEffect, useRef } from 'react';
import { client } from '@/lib/client';
import { useSettingsStore } from '@/stores/settings-store';
import { useSessionStore } from '@/stores/session-store';
import { resolveSelectedSite, resolveWebAiSites } from './WebAiSiteMenu';

let layoutRevision = Date.now() * 1000;

function nextLayoutRevision(): number {
  layoutRevision += 1;
  return layoutRevision;
}

export function WebAiPanel() {
  const sites = resolveWebAiSites(useSettingsStore((s) => s.settings.webAiSites));
  const selectedSiteId = useSessionStore((s) => s.webAiSelectedSiteId);
  const setWebAiSelectedSiteId = useSessionStore((s) => s.setWebAiSelectedSiteId);

  // 挂载恢复：主进程有存量页面则同步选中站点（不重新导航），无则按归一化选中站点打开
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const currentSites = resolveWebAiSites(useSettingsStore.getState().settings.webAiSites);
      const fallback = resolveSelectedSite(currentSites, useSessionStore.getState().webAiSelectedSiteId);
      try {
        const state = await client.getWebAiState();
        if (cancelled) return;
        if (state) {
          const matched = currentSites.find((s) => state.url === s.url || state.url.startsWith(s.url));
          if (matched) setWebAiSelectedSiteId(matched.id);
          return;
        }
      } catch (err) {
        console.error('读取网页 AI 状态失败:', err);
        if (cancelled) return;
        setWebAiSelectedSiteId(fallback.id);
        return;
      }
      if (cancelled) return;
      setWebAiSelectedSiteId(fallback.id);
      client
        .openWebAiSite({ url: fallback.url })
        .catch((err) => console.error('打开网页 AI 失败:', err));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 当前选中站点被删后兜底切到归一化第一项（挂在组件内 = embedded tab 活着才导航）
  useEffect(() => {
    if (!selectedSiteId || sites.some((s) => s.id === selectedSiteId)) return;
    const first = resolveSelectedSite(sites, selectedSiteId);
    setWebAiSelectedSiteId(first.id);
    client
      .openWebAiSite({ url: first.url })
      .catch((err) => console.error('切换网页 AI 站点失败:', err));
  }, [sites, selectedSiteId]);

  return <WebAiSurface />;
}

/**
 * 页面占位容器：rAF 链路上报 bounds（ResizeObserver/resize 触发 + mount 立即一次 + 卸载上报 null）；
 * tab 切 display:none 时 bounds 归零上报 null → 主进程 detach（embedded tab 保留），切回重新 attach。
 * Radix 弹层遮挡时上报隐藏画面（WebContentsView 浮于一切 DOM 之上）。
 */
function WebAiSurface() {
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    let lastReported: string | null | undefined;
    const commit = (bounds: { x: number; y: number; width: number; height: number } | null) => {
      void client.reportWebAiBounds({ revision: nextLayoutRevision(), bounds });
    };
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const hidden = rect.width < 1 || rect.height < 1;
      const key = hidden
        ? null
        : `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}`;
      if (key === lastReported) return;
      lastReported = key;
      commit(
        key
          ? {
              x: Math.round(rect.left),
              y: Math.round(rect.top),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            }
          : null,
      );
    };
    const publish = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    const detectOverlay = (): boolean => {
      const viewRect = el.getBoundingClientRect();
      if (viewRect.width < 1 || viewRect.height < 1) return false;
      const overlays = document.querySelectorAll(
        '[data-radix-popper-content-wrapper], [role="dialog"], [role="alertdialog"]',
      );
      for (const node of overlays) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.getAttribute('role') === 'tooltip' || node.querySelector('[role="tooltip"]')) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        const intersects =
          rect.left < viewRect.right && rect.right > viewRect.left && rect.top < viewRect.bottom && rect.bottom > viewRect.top;
        if (intersects) return true;
      }
      return false;
    };
    let overlayHidden = false;
    let overlayFrame = 0;
    const syncOverlay = (force = false) => {
      if (overlayFrame) return;
      overlayFrame = requestAnimationFrame(() => {
        overlayFrame = 0;
        const hidden = detectOverlay();
        if (!force && hidden === overlayHidden) return;
        overlayHidden = hidden;
        void client.reportWebAiOverlay({ hidden });
      });
    };
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    window.addEventListener('resize', publish);
    const overlayObserver = new MutationObserver(() => syncOverlay());
    overlayObserver.observe(document.body, { childList: true, subtree: true });
    const fallback = window.setInterval(measure, 300);
    measure();
    syncOverlay(true);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      if (overlayFrame) cancelAnimationFrame(overlayFrame);
      observer.disconnect();
      overlayObserver.disconnect();
      window.clearInterval(fallback);
      window.removeEventListener('resize', publish);
      lastReported = null;
      commit(null);
    };
  }, []);

  return <div ref={ref} className="relative h-full min-h-0 bg-background" />;
}
