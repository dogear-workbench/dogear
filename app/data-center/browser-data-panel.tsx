import { useCallback, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { client } from '@/lib/client';
import { useUIStore } from '@/stores/ui-store';
import { useVisiblePolling } from '@/hooks/use-visible-polling';
import { showConfirm } from '@/stores/confirm-store';
import { formatBytes } from './version-backup/backup-meta';
import { domainCnName } from './browser-domain-names';
import { formatDateTimeShort, formatRelativePast } from './history-utils';
import type { TaskBrowserConfig } from '@/electron/main/services/settings-types';

const TASK_BROWSER_LABEL: Record<TaskBrowserConfig['browser'], string> = { chrome: 'Chrome', edge: 'Edge' };

type SiteKnowledgeEntry = Awaited<ReturnType<typeof client.listSiteKnowledge>>[number];
type SiteKnowledgeView = { domain: string; content: string } | null;
type BlocklistEntry = Awaited<ReturnType<typeof client.listBrowserBlocklist>>[number];
type TaskBrowserListResult = Awaited<ReturnType<typeof client.listTaskBrowsers>>;

const POLL_MS = 30_000;

const BLOCK_REASON_LABEL: Record<string, string> = {
  login_required: '登录墙',
  verification_required: '人机验证',
};

function relativeTimeText(ts: number): string {
  return formatRelativePast(ts) || formatDateTimeShort(ts);
}

export function BrowserDataPanel() {
  const [taskBrowser, setTaskBrowser] = useState<TaskBrowserListResult['current']>(null);
  const [knowledge, setKnowledge] = useState<SiteKnowledgeEntry[] | null>(null);
  const [blocklist, setBlocklist] = useState<BlocklistEntry[] | null>(null);
  const [viewing, setViewing] = useState<SiteKnowledgeView>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const viewTokenRef = useRef(0);
  const [busy, setBusy] = useState<string | null>(null);
  const openSettings = useUIStore((s) => s.openSettings);

  const load = useCallback(async () => {
    try {
      const [nextKnowledge, nextBlocklist, nextTaskBrowsers] = await Promise.all([
        client.listSiteKnowledge(),
        client.listBrowserBlocklist(),
        client.listTaskBrowsers(),
      ]);
      setKnowledge(nextKnowledge);
      setBlocklist(nextBlocklist);
      setTaskBrowser(nextTaskBrowsers.current);
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

  const onViewKnowledge = useCallback(async (domain: string) => {
    const token = ++viewTokenRef.current;
    setViewing(null);
    setViewLoading(true);
    try {
      const r = await client.readSiteKnowledge({ domain });
      if (viewTokenRef.current !== token) return;
      setViewing({ domain, content: r.exists ? r.content : '' });
    } catch (e) {
      if (viewTokenRef.current !== token) return;
      toast.error('读取站点档案失败', { description: String(e) });
    } finally {
      if (viewTokenRef.current === token) setViewLoading(false);
    }
  }, []);

  const closeKnowledgeViewer = useCallback(() => {
    viewTokenRef.current += 1;
    setViewing(null);
    setViewLoading(false);
  }, []);

  const onDeleteKnowledge = useCallback(
    async (domain: string) => {
      const ok = await showConfirm(
        `删除 ${domain} 的站点档案`,
        '将删除该站点的全部探索沉淀（含正式地图与探索发现），agent 下次探索将重新积累。',
      );
      if (!ok) return;
      await runAction(`kn-del:${domain}`, async () => {
        const deleted = await client.deleteSiteKnowledge({ domain });
        if (deleted) {
          toast.success(`已删除 ${domain} 的站点档案`);
        } else {
          toast.info('档案不存在，可能已被删除');
        }
      });
    },
    [runAction],
  );

  const onUnblock = useCallback(
    async (domain: string) => {
      const ok = await showConfirm(`解除屏蔽 ${domain}`, '解除后 agent 将恢复访问该站点，搜索结果中也会重新出现它。');
      if (!ok) return;
      await runAction(`unblock:${domain}`, async () => {
        const removed = await client.unblockBrowserDomain({ domain });
        if (removed) {
          toast.success(`已解除 ${domain} 的屏蔽`);
        } else {
          toast.info('条目不存在，可能已被解除');
        }
      });
    },
    [runAction],
  );

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
        </div>

        <p className="text-xs text-muted-foreground flex items-center justify-between gap-2">
          <span>
            任务浏览器：{taskBrowser
              ? `${TASK_BROWSER_LABEL[taskBrowser.browser]} · ${taskBrowser.profileName}`
              : '未配置（扩展断连时不自动拉起浏览器）'}
          </span>
          <button
            type="button"
            className="shrink-0 underline underline-offset-2 hover:text-foreground"
            onClick={openSettings}
          >
            前往设置修改
          </button>
        </p>

        <Card className="py-2">
          <CardContent className="px-2">
            <div className="px-4 py-2 flex items-baseline gap-2">
              <span className="text-xs font-medium text-muted-foreground shrink-0">站点档案</span>
              <span className="text-xs text-muted-foreground/70">agent 探索网站后沉淀的导航知识</span>
            </div>
            {!knowledge ? (
              <div className="px-4 pb-3 pt-1 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                加载中…
              </div>
            ) : knowledge.length === 0 ? (
              <div className="px-4 pb-3 pt-1 text-sm text-muted-foreground">
                暂无站点档案。agent 探索网站时会自动沉淀站点知识，可让 agent 跑一次站点调研（如小红书、知乎）后再来看。
              </div>
            ) : (
              <div className="divide-y border-t">
                {knowledge.map((item) => (
                  <KnowledgeRow key={item.domain} item={item} busy={busy} onView={onViewKnowledge} onDelete={onDeleteKnowledge} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="py-2">
          <CardContent className="px-2">
            <div className="px-4 py-2 flex items-baseline gap-2">
              <span className="text-xs font-medium text-muted-foreground shrink-0">屏蔽的站点</span>
              <span className="text-xs text-muted-foreground/70">浏览器工具不再访问这些站点，搜索结果中也会隐藏；解除后恢复</span>
            </div>
            {!blocklist ? (
              <div className="px-4 pb-3 pt-1 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                加载中…
              </div>
            ) : blocklist.length === 0 ? (
              <div className="px-4 pb-3 pt-1 text-sm text-muted-foreground">
                暂无屏蔽站点。agent 遇到登录墙/人机验证的人工介入卡上可选「屏蔽该网站」，加入后这里可解除。
              </div>
            ) : (
              <div className="divide-y border-t">
                {blocklist.map((item) => (
                  <BlockedRow key={item.domain} item={item} busy={busy} onUnblock={onUnblock} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          站点档案与屏蔽站点仅影响 agent 浏览器工具的行为，不会改动本机浏览器的任何数据。
        </p>
      </div>

      <Dialog open={viewing !== null || viewLoading} onOpenChange={(open) => !open && closeKnowledgeViewer()}>
        <DialogContent className="sm:max-w-3xl max-h-[80vh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-3 border-b">
            <DialogTitle className="font-mono">{viewing?.domain ?? '…'}</DialogTitle>
            <DialogDescription>站点档案全文（正式地图 + 探索发现），agent 导航该站点前会先读它</DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
            {viewLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                加载中…
              </div>
            ) : viewing ? (
              viewing.content ? (
                <MarkdownRenderer content={viewing.content} />
              ) : (
                <div className="py-8 text-center text-sm text-muted-foreground">档案不存在或已被删除</div>
              )
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KnowledgeRow({
  item,
  busy,
  onView,
  onDelete,
}: {
  item: SiteKnowledgeEntry;
  busy: string | null;
  onView: (domain: string) => void;
  onDelete: (domain: string) => void;
}) {
  const cnName = domainCnName(item.domain);
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <button
        type="button"
        className="flex items-center gap-2 min-w-0 flex-1 text-left hover:text-foreground"
        onClick={() => onView(item.domain)}
      >
        {cnName ? (
          <>
            <span className="text-sm font-medium truncate">{cnName}</span>
            <span className="text-xs text-muted-foreground truncate">{item.domain}</span>
          </>
        ) : (
          <span className="text-sm font-medium truncate">{item.domain}</span>
        )}
        <span className="text-xs text-muted-foreground shrink-0">更新于 {relativeTimeText(item.updatedAt)}</span>
        <Badge variant="secondary" className="shrink-0">
          {formatBytes(item.size)}
        </Badge>
      </button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs text-muted-foreground hover:text-destructive shrink-0"
        disabled={busy !== null}
        onClick={() => onDelete(item.domain)}
      >
        {busy === `kn-del:${item.domain}` && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
        删除
      </Button>
    </div>
  );
}

function BlockedRow({
  item,
  busy,
  onUnblock,
}: {
  item: BlocklistEntry;
  busy: string | null;
  onUnblock: (domain: string) => void;
}) {
  const cnName = domainCnName(item.domain);
  const reasonLabel = BLOCK_REASON_LABEL[item.reason] ?? item.reason;
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
        <Badge variant="destructive" className="shrink-0">
          {reasonLabel}
        </Badge>
        <span className="text-xs text-muted-foreground shrink-0">屏蔽于 {relativeTimeText(item.blockedAt)}</span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs text-muted-foreground hover:text-foreground shrink-0"
        disabled={busy !== null}
        onClick={() => onUnblock(item.domain)}
      >
        {busy === `unblock:${item.domain}` && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
        解除
      </Button>
    </div>
  );
}
