import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { client } from '@/lib/client';
import { resolveModelLabel } from '@/lib/model-selection';
import { useConfirmStore } from '@/stores/confirm-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useVisiblePolling } from '@/hooks/use-visible-polling';
import type { ModelSelection } from '@/types/settings';
import type { Workspace } from '@/types/electron-api';

interface GroupDigestSummary {
  groupId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sessionCount: number;
  workspaceId: string;
}

interface GroupDigestSource { sessionId: string; uuid: string; }

interface GroupDigestItem {
  kind: string;
  text: string;
  sources: GroupDigestSource[];
}

interface GroupDigestKeyOutput {
  path: string;
  oneLine: string;
  sessionId?: string;
}

interface GroupDigestCard {
  groupId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sourcesSeen: Array<{ sessionId: string; conversationId: string; mtime: number }>;
  summary: string;
  items: GroupDigestItem[];
  keyOutputs: GroupDigestKeyOutput[];
}

const KIND_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  决策: 'default',
  想法: 'secondary',
  注意: 'outline',
  搁置: 'outline',
};

interface DigestsPanelProps {
  workspaces: Workspace[];
}

export function DigestsPanel({ workspaces }: DigestsPanelProps) {
  const [workspaceId, setWorkspaceId] = useState<string>('all');
  const isAll = workspaceId === 'all';
  const confirm = useConfirmStore((s) => s.confirm);
  const settings = useSettingsStore((s) => s.settings);
  const [list, setList] = useState<GroupDigestSummary[]>([]);
  const [selected, setSelected] = useState<GroupDigestCard | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [digestModel, setDigestModel] = useState<ModelSelection | null>(null);

  const wsNameById = useMemo(
    () => new Map(workspaces.map((w) => [w.id, w.name])),
    [workspaces],
  );

  useEffect(() => {
    client.getDigestModelSelection().then((r) => {
      if ('selection' in r) setDigestModel(r.selection ?? null);
    }).catch(() => {});
  }, []);

  const loadList = useCallback(async (notify: boolean) => {
    try {
      const r = await client.listGroupDigests(isAll ? {} : { workspaceId });
      if ('digests' in r && r.digests) {
        setList(r.digests as GroupDigestSummary[]);
      } else if (notify) {
        toast.error('加载组卡失败', { description: 'error' in r ? r.error : undefined });
      }
    } catch (e) {
      if (notify) toast.error('加载组卡失败', { description: String(e) });
    }
  }, [isAll, workspaceId]);

  useVisiblePolling(() => loadList(false), 2000);

  useEffect(() => {
    setSelected(null);
    setSelectedWorkspaceId(null);
    void loadList(true);
  }, [loadList]);

  const selectCard = async (d: GroupDigestSummary) => {
    try {
      const result = await client.readGroupDigest({ workspaceId: d.workspaceId, groupId: d.groupId });
      if ('card' in result && result.card) {
        setSelected(result.card as GroupDigestCard);
        setSelectedWorkspaceId(d.workspaceId);
      } else {
        toast.error('读取组卡失败', { description: 'error' in result ? result.error : undefined });
      }
    } catch (e) {
      toast.error('读取组卡失败', { description: String(e) });
    }
  };

  const handleReDigest = async (groupId: string) => {
    const ws = selectedWorkspaceId ? workspaces.find((w) => w.id === selectedWorkspaceId) : undefined;
    if (!ws) return;
    const modelSel = digestModel ?? settings.ai.defaultModelSelection;
    const modelLabel = modelSel ? resolveModelLabel(settings, modelSel) : '默认模型（未设置）';
    try {
      const r = await client.triggerGroupDigest({ workspaceId: ws.id, workspacePath: ws.path, groupId });
      if ('error' in r && r.error) {
        toast.error('重新提炼失败', { description: r.error });
        return;
      }
    } catch (e) {
      toast.error('重新提炼失败', { description: String(e) });
      return;
    }
    await confirm({
      title: '已加入提炼队列',
      description: `该组将在后台重新提炼（使用模型 ${modelLabel}，可在 定时计划 → 组卡提炼 → 详情 中修改），列表会自动刷新。`,
      buttons: [{ label: '知道了', value: 'ok' }],
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">组卡</h2>
        <Select value={workspaceId} onValueChange={setWorkspaceId}>
          <SelectTrigger size="sm" className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部工作区</SelectItem>
            {workspaces.map((w) => (
              <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-sm text-muted-foreground mb-6 mt-1">
        后台自动把每个会话提炼成摘要卡，可查看组卡详情或对单个组补跑提炼；提炼模型与提示词在「定时计划」的任务编辑器中配置。
      </p>
      <div className="flex gap-6">
      {/* 左侧：组卡列表 */}
      <div className="w-64 shrink-0 space-y-1 max-h-[60vh] overflow-y-auto">
        {list.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            <FileText className="w-8 h-8 mx-auto opacity-40 mb-2" />
            暂无组卡
          </div>
        ) : (
          list.map((d) => (
            <button
              key={`${d.workspaceId}:${d.groupId}`}
              onClick={() => selectCard(d)}
              className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                selected?.groupId === d.groupId && selectedWorkspaceId === d.workspaceId
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-muted'
              }`}
            >
              <div className="font-medium truncate">{d.title || '(无标题)'}</div>
              <div className="text-xs text-muted-foreground">
                {isAll && wsNameById.get(d.workspaceId) ? `${wsNameById.get(d.workspaceId)} · ` : ''}
                {new Date(d.updatedAt).toLocaleString()} · {d.sessionCount} 会话
              </div>
            </button>
          ))
        )}
      </div>

      {/* 右侧：组卡正文 */}
      <div className="flex-1 min-w-0">
        {!selected ? (
          <div className="text-sm text-muted-foreground py-16 text-center">
            选择左侧一张组卡查看详情
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-base font-semibold">{selected.title}</h3>
                <p className="text-xs text-muted-foreground mt-0.5 font-mono break-all">
                  {selected.groupId}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => handleReDigest(selected.groupId)}
              >
                <Sparkles className="w-4 h-4 mr-1" />
                重新提炼
              </Button>
            </div>

            <div>
              <h4 className="text-sm font-medium mb-1">概述</h4>
              <MarkdownRenderer content={selected.summary} />
            </div>

            {selected.items.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">想法 / 注意 / 决策</h4>
                <ul className="space-y-2">
                  {selected.items.map((it, i) => (
                    <li key={i} className="text-sm flex flex-col gap-0.5">
                      <div className="flex items-start gap-2">
                        <Badge variant={KIND_VARIANT[it.kind] ?? 'outline'} className="shrink-0">
                          {it.kind}
                        </Badge>
                        <span>{it.text}</span>
                      </div>
                      <span
                        className="text-[11px] text-muted-foreground font-mono break-all pl-1"
                        title="出处 sessionId#uuid（用于回溯原会话）"
                      >
                        ⟶ {it.sources.map((s) => `${s.sessionId.slice(0, 8)}#${s.uuid.slice(0, 8)}`).join(', ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {selected.keyOutputs.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">关键产出</h4>
                <ul className="space-y-1">
                  {selected.keyOutputs.map((o, i) => (
                    <li key={i} className="text-sm">
                      <code className="text-xs">{o.path}</code> :: {o.oneLine}
                      {o.sessionId && (
                        <span className="text-[11px] text-muted-foreground ml-1">
                          ← {o.sessionId.slice(0, 8)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
