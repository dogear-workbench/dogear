import { useCallback, useMemo, useState } from 'react';
import { ChevronDown, HardDrive, Loader2, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { client } from '@/lib/client';
import { useVisiblePolling } from '@/hooks/use-visible-polling';
import { showConfirm } from '@/stores/confirm-store';
import { formatBytes } from './version-backup/backup-meta';
import { domainCnName } from './browser-domain-names';

type BrowserDataOverview = Awaited<ReturnType<typeof client.listBrowserData>>;

const POLL_MS = 30_000;
const AGENT_RISK_HINT = '若 agent 正在跑浏览器任务，可能受影响。';

export function BrowserDataPanel() {
  const [overview, setOverview] = useState<BrowserDataOverview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [othersOpen, setOthersOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setOverview(await client.listBrowserData());
    } catch {
      // 轮询场景静默失败避免 toast 刷屏；失败时保持上次状态
    }
  }, []);

  useVisiblePolling(load, POLL_MS);

  const runAction = useCallback(
    async (key: string, action: () => Promise<void>) => {
      setBusy(key);
      try {
        await action();
      } catch (e) {
        toast.error('操作失败', { description: String(e) });
      } finally {
        setBusy(null);
        load();
      }
    },
    [load],
  );

  const onLogout = useCallback(
    async (domain: string) => {
      const ok = await showConfirm(`登出 ${domain}`, `将清除该域名的全部 Cookie（登录态），站点数据保留。${AGENT_RISK_HINT}`);
      if (!ok) return;
      await runAction(`logout:${domain}`, async () => {
        const r = await client.logoutBrowserDomain({ domain });
        toast.success(`已登出 ${domain}`, { description: `清除 Cookie ${r.removedCookies} 条` });
      });
    },
    [runAction],
  );

  const onClearDomain = useCallback(
    async (domain: string) => {
      const ok = await showConfirm(
        `清除 ${domain} 的全部数据`,
        `将删除该域名的 Cookie、本地存储、IndexedDB 等全部站点数据，下次访问回到未登录状态。${AGENT_RISK_HINT}`,
      );
      if (!ok) return;
      await runAction(`clear:${domain}`, async () => {
        const r = await client.clearBrowserDomainData({ domain });
        toast.success(`已清除 ${domain}`, { description: `清除 Cookie ${r.removedCookies} 条 · 涉及 ${r.origins.length} 个源` });
      });
    },
    [runAction],
  );

  const onClearCache = useCallback(async () => {
    const ok = await showConfirm('清理浏览器缓存', `将清空全局浏览器分区的 HTTP 缓存（约 ${formatBytes(overview?.cacheSize ?? 0)}），不影响登录态。${AGENT_RISK_HINT}`);
    if (!ok) return;
    await runAction('cache', async () => {
      await client.clearBrowserCache();
      toast.success('缓存已清理');
    });
  }, [overview, runAction]);

  const onClearAll = useCallback(async () => {
    const ok = await showConfirm(
      '清除全部浏览器数据',
      '将清空全局浏览器分区的全部数据：所有网站的登录态、本地存储、IndexedDB、缓存全部删除，所有站点回到未登录状态。若 agent 正在跑浏览器任务，正在进行的任务可能中断。',
    );
    if (!ok) return;
    await runAction('all', async () => {
      const r = await client.clearAllBrowserData();
      toast.success('已清除全部浏览器数据', { description: `清除 Cookie ${r.removedCookies} 条` });
    });
  }, [runAction]);

  const sorted = useMemo(() => {
    if (!overview) return [];
    return [...overview.domains].sort(
      (a, b) =>
        Number(b.hasLoginHint) - Number(a.hasLoginHint) ||
        b.cookieCount - a.cookieCount ||
        a.domain.localeCompare(b.domain),
    );
  }, [overview]);
  const loggedIn = useMemo(() => sorted.filter((d) => d.hasLoginHint), [sorted]);
  const others = useMemo(() => sorted.filter((d) => !d.hasLoginHint), [sorted]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-6 space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">全局浏览器数据</h2>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => load()} disabled={busy !== null}>
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onClearCache()} disabled={busy !== null}>
              {busy === 'cache' ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 mr-1" />}
              清理缓存
            </Button>
            <Button variant="destructive" size="sm" onClick={() => onClearAll()} disabled={busy !== null}>
              {busy === 'all' ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 mr-1" />}
              全部清除
            </Button>
          </div>
        </div>

        <Card className="py-4">
          <CardContent className="px-6 grid grid-cols-3 gap-4">
            <StatBlock label="分区磁盘占用" value={overview ? formatBytes(overview.diskUsage) : '…'} />
            <StatBlock label="HTTP 缓存" value={overview ? formatBytes(overview.cacheSize) : '…'} />
            <StatBlock
              label="站点 / Cookie"
              value={overview ? `${overview.domains.length} 站 · ${overview.totalCookies} 条` : '…'}
            />
          </CardContent>
        </Card>

        <Card className="py-2">
          <CardContent className="px-2">
            {!overview ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                加载中…
              </div>
            ) : overview.domains.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">暂无站点数据，登录任意网站后出现在这里</div>
            ) : (
              <>
                <div className="px-4 py-2 text-xs font-medium text-muted-foreground">已登录站点</div>
                {loggedIn.length === 0 ? (
                  <div className="px-4 pb-3 pt-1 text-sm text-muted-foreground">暂无登录态站点</div>
                ) : (
                  <div className="divide-y">
                    {loggedIn.map((item) => (
                      <DomainRow key={item.domain} item={item} busy={busy} onLogout={onLogout} onClear={onClearDomain} />
                    ))}
                  </div>
                )}
                {others.length > 0 && (
                  <Collapsible open={othersOpen} onOpenChange={setOthersOpen}>
                    <CollapsibleTrigger className="w-full flex items-center gap-2 border-t px-4 py-2.5 text-left hover:bg-muted/50">
                      <ChevronDown className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform ${othersOpen ? '' : '-rotate-90'}`} />
                      <span className="text-sm shrink-0">其他域名</span>
                      <Badge variant="secondary" className="shrink-0">
                        {others.length}
                      </Badge>
                      <span className="text-xs text-muted-foreground truncate">多为页面嵌入的第三方域（统计 / CDN 等），非直接访问的站点</span>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="divide-y border-t">
                        {others.map((item) => (
                          <DomainRow key={item.domain} item={item} busy={busy} onLogout={onLogout} onClear={onClearDomain} />
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <HardDrive className="w-3 h-3" />
          agent 内嵌浏览器与「网页 AI」共用同一分区，这里的登出/清除对两者同时生效。
        </p>
      </div>
    </div>
  );
}

function DomainRow({
  item,
  busy,
  onLogout,
  onClear,
}: {
  item: BrowserDataOverview['domains'][number];
  busy: string | null;
  onLogout: (domain: string) => void;
  onClear: (domain: string) => void;
}) {
  const cnName = domainCnName(item.domain);
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="flex items-center gap-2 min-w-0">
        {cnName ? (
          <>
            <span className="text-sm font-medium truncate">{cnName}</span>
            <span className="text-xs text-muted-foreground truncate">{item.domain}</span>
          </>
        ) : (
          <span className="text-sm font-medium truncate">{item.domain}</span>
        )}
        {item.hasLoginHint && (
          <Badge variant="outline" className="gap-1 text-green-600 border-green-600/40 shrink-0">
            <ShieldCheck className="w-3 h-3" />
            登录态
          </Badge>
        )}
        <Badge variant="secondary" className="shrink-0">
          {item.cookieCount} Cookie
        </Badge>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Button variant="outline" size="sm" className="h-7 text-xs" disabled={busy !== null} onClick={() => onLogout(item.domain)}>
          {busy === `logout:${item.domain}` && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
          登出
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs text-destructive hover:text-destructive"
          disabled={busy !== null}
          onClick={() => onClear(item.domain)}
        >
          {busy === `clear:${item.domain}` && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
          清除数据
        </Button>
      </div>
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-base font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}
