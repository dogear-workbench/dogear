import { useCallback, useMemo, useState } from 'react';
import { ChevronDown, HardDrive, Info, Loader2, RefreshCw, Trash2 } from 'lucide-react';
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
import { formatDateTimeShort, formatRelativePast } from './history-utils';

type BrowserDataOverview = Awaited<ReturnType<typeof client.listBrowserData>>;
type LoginAccountView = BrowserDataOverview['loginAccounts'][number];
type DomainData = BrowserDataOverview['domains'][number];

const POLL_MS = 30_000;
const AGENT_RISK_HINT = '若 agent 正在跑浏览器任务，可能受影响。';

const EVIDENCE_LABEL: Record<LoginAccountView['evidence'], string> = {
  'oauth-callback': 'OAuth 回调',
  'login-post': '登录请求',
  'init-heuristic': 'Cookie 检测',
  'init-webai-storage': '站点数据检测',
};

function lastLoginText(ts: number): string {
  return formatRelativePast(ts) || formatDateTimeShort(ts);
}

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
      const ok = await showConfirm(
        `登出 ${domain}`,
        `将在本地清除该站全部会话数据（Cookie、本地存储、IndexedDB），不通知服务器，站点可能仍认为你在线。${AGENT_RISK_HINT}`,
      );
      if (!ok) return;
      await runAction(`logout:${domain}`, async () => {
        const r = await client.logoutLoginAccount({ domain });
        toast.success(`已登出 ${domain}`, { description: `清除 Cookie ${r.removedCookies} 条 · 涉及 ${r.origins.length} 个源` });
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

  const onRemove = useCallback(
    async (domain: string) => {
      const ok = await showConfirm(`移除 ${domain} 的登录记录`, '仅将该站点移出「我的登录」清单，不删除任何站点数据，实际登录态保持不变。');
      if (!ok) return;
      await runAction(`remove:${domain}`, async () => {
        const removed = await client.removeLoginAccount({ domain });
        if (removed) {
          toast.success(`已移除 ${domain} 的登录记录`);
        } else {
          toast.info('清单中无此条目');
        }
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

  const others = useMemo(() => {
    if (!overview) return [];
    const loginSet = new Set(overview.loginAccounts.map((a) => a.domain));
    return overview.domains.filter((d) => !loginSet.has(d.domain));
  }, [overview]);
  const empty = overview !== null && overview.loginAccounts.length === 0 && others.length === 0;

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
              label="登录站点 / Cookie"
              value={overview ? `${overview.loginAccounts.length} 站 · ${overview.totalCookies} 条` : '…'}
            />
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Info className="w-3 h-3 shrink-0" />
          登录状态由系统自动检测，可能不准确；误报可点条目上的「移除」。
        </p>

        <Card className="py-2">
          <CardContent className="px-2">
            {!overview ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                加载中…
              </div>
            ) : empty ? (
              <div className="py-8 text-center text-sm text-muted-foreground">暂无站点数据，用浏览器访问任意网站后出现在这里</div>
            ) : (
              <>
                <div className="px-4 py-2 flex items-baseline gap-2">
                  <span className="text-xs font-medium text-muted-foreground shrink-0">我的登录</span>
                  <span className="text-xs text-muted-foreground/70">在该浏览器分区中检测到的登录账号</span>
                </div>
                {overview.loginAccounts.length === 0 ? (
                  <div className="px-4 pb-3 pt-1 text-sm text-muted-foreground">暂无检测到的登录，在浏览器或网页 AI 中登录网站后出现在这里</div>
                ) : (
                  <div className="divide-y">
                    {overview.loginAccounts.map((item) => (
                      <LoginRow key={item.domain} item={item} busy={busy} onLogout={onLogout} onClear={onClearDomain} onRemove={onRemove} />
                    ))}
                  </div>
                )}
                {others.length > 0 && (
                  <Collapsible open={othersOpen} onOpenChange={setOthersOpen}>
                    <CollapsibleTrigger className="w-full flex items-center gap-2 border-t px-4 py-2.5 text-left hover:bg-muted/50">
                      <ChevronDown className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform ${othersOpen ? '' : '-rotate-90'}`} />
                      <span className="text-sm shrink-0">其他站点数据</span>
                      <Badge variant="secondary" className="shrink-0">
                        {others.length}
                      </Badge>
                      <span className="text-xs text-muted-foreground truncate">未检测到登录，多为页面嵌入的第三方域（统计 / CDN 等）</span>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="divide-y border-t">
                        {others.map((item) => (
                          <OtherDomainRow key={item.domain} item={item} busy={busy} onClear={onClearDomain} />
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

function LoginRow({
  item,
  busy,
  onLogout,
  onClear,
  onRemove,
}: {
  item: LoginAccountView;
  busy: string | null;
  onLogout: (domain: string) => void;
  onClear: (domain: string) => void;
  onRemove: (domain: string) => void;
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
        <Badge variant="outline" className="shrink-0 text-muted-foreground">
          {EVIDENCE_LABEL[item.evidence]}
        </Badge>
        <span className="text-xs text-muted-foreground shrink-0">最近登录 {lastLoginText(item.lastLoginAt)}</span>
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
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground hover:text-destructive"
          disabled={busy !== null}
          onClick={() => onRemove(item.domain)}
        >
          {busy === `remove:${item.domain}` && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
          移除
        </Button>
      </div>
    </div>
  );
}

function OtherDomainRow({ item, busy, onClear }: { item: DomainData; busy: string | null; onClear: (domain: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm truncate">{item.domain}</span>
        <Badge variant="secondary" className="shrink-0">
          {item.cookieCount} Cookie
        </Badge>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs text-destructive hover:text-destructive shrink-0"
        disabled={busy !== null}
        onClick={() => onClear(item.domain)}
      >
        {busy === `clear:${item.domain}` && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
        清除数据
      </Button>
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
