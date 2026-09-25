import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { useSettingsStore } from '@/stores/settings-store';
import { DEFAULT_WEB_AI_SITES, type WebAiSite } from '@/types/settings';

function resolveSites(webAiSites: WebAiSite[] | undefined): WebAiSite[] {
  return webAiSites && webAiSites.length > 0 ? webAiSites : DEFAULT_WEB_AI_SITES;
}

let layoutRevision = Date.now() * 1000;

function nextLayoutRevision(): number {
  layoutRevision += 1;
  return layoutRevision;
}

function matchSiteUrl(url: string, sites: WebAiSite[]): string | null {
  return sites.find((s) => url === s.url || url.startsWith(s.url))?.url ?? null;
}

export function WebAiPanel() {
  const [siteUrl, setSiteUrl] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const sites = resolveSites(useSettingsStore((s) => s.settings.webAiSites));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const currentSites = resolveSites(useSettingsStore.getState().settings.webAiSites);
      try {
        const state = await client.getWebAiState();
        if (cancelled) return;
        if (state) {
          setSiteUrl(matchSiteUrl(state.url, currentSites) ?? state.url);
          return;
        }
      } catch (err) {
        console.error('读取网页 AI 状态失败:', err);
        if (cancelled) return;
        setSiteUrl(currentSites[0].url);
        setSelectedSiteId(currentSites[0].id);
        return;
      }
      if (cancelled) return;
      setSelectedSiteId(currentSites[0].id);
      setSiteUrl(currentSites[0].url);
      client
        .openWebAiSite({ url: currentSites[0].url })
        .then((snapshot) => setSiteUrl(matchSiteUrl(snapshot.url, currentSites) ?? snapshot.url))
        .catch((err) => console.error('打开网页 AI 失败:', err));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 当前选中站点被删后兜底切到列表第一项
  useEffect(() => {
    if (!selectedSiteId || sites.some((s) => s.id === selectedSiteId)) return;
    const first = sites[0];
    setSelectedSiteId(first.id);
    setSiteUrl(first.url);
    client
      .openWebAiSite({ url: first.url })
      .then((snapshot) => setSiteUrl(matchSiteUrl(snapshot.url, sites) ?? snapshot.url))
      .catch((err) => console.error('切换网页 AI 站点失败:', err));
  }, [sites, selectedSiteId]);

  const switchSite = (site: WebAiSite) => {
    setSelectedSiteId(site.id);
    setSiteUrl(site.url);
    client
      .openWebAiSite({ url: site.url })
      .then((snapshot) => setSiteUrl(matchSiteUrl(snapshot.url, sites) ?? snapshot.url))
      .catch((err) => console.error('切换网页 AI 站点失败:', err));
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 flex items-center gap-1 h-[42px] px-2 border-b bg-muted/30">
        <Globe className="w-3.5 h-3.5 text-muted-foreground mr-1 shrink-0" />
        {sites.map((site) => (
          <button
            key={site.id}
            title={site.url}
            onClick={() => switchSite(site)}
            className={cn(
              'h-7 px-2.5 rounded-md text-xs transition-colors cursor-pointer',
              siteUrl === site.url
                ? 'bg-background font-medium border shadow-sm'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground border border-transparent',
            )}
          >
            {site.name}
          </button>
        ))}
      </div>
      <WebAiSurface />
    </div>
  );
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

  return <div ref={ref} className="relative flex-1 min-h-0 bg-background" />;
}
