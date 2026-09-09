import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ExternalLink,
  MonitorPlay,
  MonitorX,
  RotateCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { useBrowserStore } from '@/stores/browser-store';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { EmbeddedTabSnapshot } from '@/electron/main/services/browser/embedded/types';

// 渲染层全局单调 revision（时间戳起步防 renderer 重载后倒退）：主进程按窗口拒晚到的低 revision 上报
let layoutRevision = Date.now() * 1000;

function nextLayoutRevision(): number {
  layoutRevision += 1;
  return layoutRevision;
}

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

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function BrowserPageView() {
  const tabs = useBrowserStore((s) => s.view.tabs);
  const presentedTabId = useBrowserStore((s) => s.view.presentedTabId);
  if (tabs.length === 0) return null;
  const presented = tabs.find((tab) => tab.tabId === presentedTabId) ?? null;
  return (
    <>
      <PageAddressBar presented={presented} tabs={tabs} />
      <PageSurface />
    </>
  );
}

/**
 * 页面占满面板剩余空间：rAF 链路上报 bounds（ResizeObserver/resize 触发 + mount 立即一次 + 卸载上报 null）。
 * 横幅/错误行等上方布局变化只改位置不改尺寸，ResizeObserver 不触发，用低频兜底对比补齐；
 * rect 未变化时跳过 IPC，不产生冗余上报。
 */
function PageSurface() {
  const ref = useRef<HTMLDivElement | null>(null);
  const presented = useBrowserStore(
    (s) => s.view.tabs.find((tab) => tab.tabId === s.view.presentedTabId) ?? null,
  );

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    let lastReported: string | null | undefined;
    const commit = (bounds: { x: number; y: number; width: number; height: number } | null) => {
      void client.reportPageViewBounds({ revision: nextLayoutRevision(), bounds });
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
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    window.addEventListener('resize', publish);
    const fallback = window.setInterval(measure, 300);
    measure();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      window.clearInterval(fallback);
      window.removeEventListener('resize', publish);
      lastReported = null;
      commit(null);
    };
  }, []);

  return (
    <div ref={ref} className="relative flex-1 min-h-0 bg-background">
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground/60 select-none pointer-events-none">
        {presented ? (
          <>
            <ExternalLink className="w-4 h-4" />
            <span className="text-[10px] truncate max-w-full px-4" title={presented.url}>{presented.url}</span>
          </>
        ) : (
          <>
            <MonitorPlay className="w-4 h-4" />
            <span className="text-[10px] px-4">未呈现页面 · 点右侧标签菜单选择呈现</span>
          </>
        )}
      </div>
    </div>
  );
}

function PageAddressBar({
  presented,
  tabs,
}: {
  presented: EmbeddedTabSnapshot | null;
  tabs: EmbeddedTabSnapshot[];
}) {
  const takeovers = useBrowserStore((s) => s.takeovers);
  const status = useBrowserStore((s) => s.status);
  const ensureViewStateLoaded = useBrowserStore((s) => s.ensureViewStateLoaded);
  const [draft, setDraft] = useState(presented?.url ?? '');
  const [navError, setNavError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(presented?.url ?? '');
    setNavError(null);
  }, [presented?.tabId, presented?.url]);

  useEffect(() => {
    if (!navError) return;
    const timer = window.setTimeout(() => setNavError(null), 5000);
    return () => window.clearTimeout(timer);
  }, [navError]);

  const refresh = () => {
    void ensureViewStateLoaded();
  };

  const runNav = (action: Promise<unknown>) => {
    action.then(refresh).catch((err) => {
      setNavError(err instanceof Error ? err.message : String(err));
      refresh();
    });
  };

  // 接管时记住当前动作流持有者会话，交还后可唤醒；拿不到（空闲/非会话任务）就传 undefined 只解锁
  const holderConversationId =
    status.holder?.kind === 'agent' && status.holder.taskId.startsWith('agent:')
      ? status.holder.taskId.slice('agent:'.length)
      : undefined;

  const toggleTakeover = (tabId: string, taken: boolean) => {
    const action = taken
      ? client.releaseTakeover({ tabId })
      : client.takeOverTab({ tabId, conversationId: holderConversationId });
    void action.then(refresh);
  };

  const presentTab = (tabId: string) => {
    runNav(client.presentEmbeddedTab({ tabId }));
  };

  const dismissTab = () => {
    void client.dismissPresentedTab({}).then(refresh);
  };

  const submitUrl = () => {
    if (!presented) return;
    const url = normalizeUrl(draft);
    if (!url || url === presented.url) return;
    runNav(client.navigatePresentedTab({ tabId: presented.tabId, url }));
  };

  const navDisabled = !presented?.canGoBack;
  const forwardDisabled = !presented?.canGoForward;
  const presentedTakenOver = presented ? takeovers.some((entry) => entry.tabId === presented.tabId) : false;

  const navButtonClass = (disabled: boolean) =>
    cn(
      'shrink-0 h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground transition-colors',
      disabled ? 'opacity-40 cursor-default' : 'hover:text-foreground hover:bg-muted/50 cursor-pointer',
    );

  return (
    <div className="shrink-0 border-b bg-muted/30">
      <div className="flex items-center gap-1 h-[42px] px-2">
        <button
          className={navButtonClass(navDisabled)}
          disabled={navDisabled}
          title="后退"
          onClick={() => presented && runNav(client.goBackPresentedTab({ tabId: presented.tabId }))}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <button
          className={navButtonClass(forwardDisabled)}
          disabled={forwardDisabled}
          title="前进"
          onClick={() => presented && runNav(client.goForwardPresentedTab({ tabId: presented.tabId }))}
        >
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
        <button
          className={navButtonClass(!presented)}
          disabled={!presented}
          title="刷新"
          onClick={() => presented && runNav(client.reloadPresentedTab({ tabId: presented.tabId }))}
        >
          <RotateCw className="w-3.5 h-3.5" />
        </button>
        <input
          className="flex-1 min-w-0 h-7 rounded-md border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-60"
          value={draft}
          disabled={!presented}
          placeholder={presented ? '输入网址回车导航' : '未呈现页面 · 从右侧标签菜单选择'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitUrl();
          }}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="shrink-0 flex items-center gap-1 max-w-44 h-7 px-2 rounded-md border bg-background text-xs cursor-pointer hover:bg-muted/50 transition-colors"
              title="呈现的标签页"
            >
              <span className="min-w-0 truncate">
                {presented ? presented.title || hostOf(presented.url) : '选择页面'}
              </span>
              <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            {tabs.map((tab) => {
              const active = tab.tabId === presented?.tabId;
              const taken = takeovers.some((entry) => entry.tabId === tab.tabId);
              const stateLabel = STATE_LABELS[tab.state];
              return (
                <DropdownMenuItem key={tab.tabId} className="gap-2 cursor-pointer" onSelect={() => presentTab(tab.tabId)}>
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
                  {taken && (
                    <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] leading-4 text-amber-600">接管中</span>
                  )}
                  <button
                    className="shrink-0 rounded border px-1 py-0.5 text-[10px] text-muted-foreground hover:text-amber-600 hover:border-amber-500/50 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleTakeover(tab.tabId, taken);
                    }}
                  >
                    {taken ? '交还' : '接管'}
                  </button>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        {presented ? (
          <>
            <button
              className={cn(
                'shrink-0 h-7 px-2 rounded-md border text-[11px] transition-colors cursor-pointer',
                presentedTakenOver
                  ? 'border-amber-500/60 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20'
                  : 'text-muted-foreground hover:text-amber-600 hover:bg-muted/50',
              )}
              onClick={() => toggleTakeover(presented.tabId, presentedTakenOver)}
            >
              {presentedTakenOver ? '交还' : '接管'}
            </button>
            <button
              className={navButtonClass(false)}
              title="收起页面视图"
              onClick={dismissTab}
            >
              <MonitorX className="w-3.5 h-3.5" />
            </button>
          </>
        ) : null}
      </div>
      {navError && (
        <div className="px-3 py-1 text-[10px] text-red-500 truncate border-t border-red-500/20 bg-red-500/5" title={navError}>
          {navError}
        </div>
      )}
    </div>
  );
}
