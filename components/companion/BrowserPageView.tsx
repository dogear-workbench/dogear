import { useEffect, useRef } from 'react';
import { ExternalLink, MonitorPlay, MonitorX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { useBrowserStore } from '@/stores/browser-store';
import type { EmbeddedTabSnapshot } from '@/electron/main/services/browser/embedded/types';

const REPORT_DEBOUNCE_MS = 120;

const STATE_LABELS: Partial<Record<EmbeddedTabSnapshot['state'], string>> = {
  loading: '加载中',
  login_required: '需登录',
  verification_required: '需验证',
  rate_limited: '限流',
  crashed: '已崩溃',
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function BrowserPageView() {
  const tabs = useBrowserStore((s) => s.view.tabs);
  const presentedTabId = useBrowserStore((s) => s.view.presentedTabId);
  const ensureViewStateLoaded = useBrowserStore((s) => s.ensureViewStateLoaded);
  const placeholderRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void ensureViewStateLoaded();
  }, [ensureViewStateLoaded]);

  useEffect(() => {
    const el = placeholderRef.current;
    if (!presentedTabId || !el) return;
    let timer: number | undefined;
    const report = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      void client.reportPageViewBounds({
        bounds: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      });
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(report, REPORT_DEBOUNCE_MS);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    window.addEventListener('resize', schedule);
    report();
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      void client.reportPageViewBounds({ bounds: null });
    };
  }, [presentedTabId]);

  if (tabs.length === 0) return null;

  const presented = tabs.find((tab) => tab.tabId === presentedTabId) ?? null;

  const presentTab = (tabId: string) => {
    void client.presentEmbeddedTab({ tabId }).then(() => ensureViewStateLoaded());
  };
  const dismissTab = () => {
    void client.dismissPresentedTab({}).then(() => ensureViewStateLoaded());
  };

  return (
    <div className="border-b bg-muted/20 shrink-0">
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <MonitorPlay className="w-3 h-3" />
        页面视图
        <span className="text-muted-foreground/60 normal-case tracking-normal">（呈现给用户看，不影响 agent 操作目标）</span>
      </div>
      {presented ? (
        <div className="px-3 pb-2">
          <div
            ref={placeholderRef}
            className="relative w-full h-52 rounded-md border bg-background overflow-hidden"
          >
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground/60 select-none">
              <ExternalLink className="w-4 h-4" />
              <span className="text-[10px] truncate max-w-full px-4" title={presented.url}>{presented.url}</span>
            </div>
          </div>
          <button
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            onClick={dismissTab}
          >
            <MonitorX className="w-3 h-3" />
            收起页面视图
          </button>
        </div>
      ) : null}
      <div className="pb-1">
        {tabs.map((tab) => {
          const active = tab.tabId === presentedTabId;
          const stateLabel = STATE_LABELS[tab.state];
          return (
            <div
              key={tab.tabId}
              className={cn(
                'flex items-center gap-2 px-3 py-1 hover:bg-muted/50 transition-colors',
                active && 'bg-primary/5',
              )}
            >
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  tab.state === 'loading' ? 'bg-orange-500 animate-pulse' : active ? 'bg-primary' : 'bg-muted-foreground/40',
                )}
              />
              <span className="flex-1 min-w-0 truncate text-xs" title={`${tab.title || hostOf(tab.url)}\n${tab.url}`}>
                {tab.title || hostOf(tab.url)}
              </span>
              {stateLabel && (
                <span className="shrink-0 rounded bg-muted px-1 text-[10px] leading-4 text-muted-foreground">{stateLabel}</span>
              )}
              {active ? (
                <button
                  className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
                  onClick={dismissTab}
                >
                  收起
                </button>
              ) : (
                <button
                  className="shrink-0 text-[10px] text-muted-foreground hover:text-primary cursor-pointer"
                  onClick={() => presentTab(tab.tabId)}
                >
                  呈现
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
