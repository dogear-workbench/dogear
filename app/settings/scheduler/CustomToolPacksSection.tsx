import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { client } from '@/lib/client';

interface ToolPackOption {
  name: string;
  label: string;
  description: string;
  toolCount: number;
  requirements?: string;
  enabled: boolean;
}

interface Props {
  workspaceId: string;
  override: string[] | undefined;
  onChange: (override: string[] | undefined) => void;
}

export function CustomToolPacksSection({ workspaceId, override, onChange }: Props) {
  const [packs, setPacks] = useState<ToolPackOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    client.listToolPacks({ workspaceId }).then((r) => {
      if (cancelled) return;
      setPacks(Array.isArray(r) ? (r as ToolPackOption[]) : []);
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setPacks([]);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const following = override === undefined;
  const effective = new Set(following ? packs.filter((p) => p.enabled).map((p) => p.name) : override);

  const toggle = (name: string, on: boolean) => {
    const next = new Set(following ? packs.filter((p) => p.enabled).map((p) => p.name) : override);
    if (on) next.add(name);
    else next.delete(name);
    onChange(Array.from(next));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">工具</label>
        {following ? (
          <Badge variant="subtle" className="text-[10px] px-1.5 py-0">跟随工作区</Badge>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            onClick={() => onChange(undefined)}
          >
            重置为跟随工作区
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        未拨动任何开关时，任务使用工作区设置的工具包；拨动任一开关后，以本任务的开关为准（保存任务后生效）。
      </p>
      <div className="rounded-md border px-3 py-2">
        <p className="text-xs font-medium">基础工具（恒装）</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          文件 Read/Write/Edit、Glob/Grep 搜索、记忆 Recall/Save/Forget、复盘报告读写
        </p>
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-medium">可选工具包</p>
        {loading ? (
          <p className="text-xs text-muted-foreground px-1">工具包加载中…</p>
        ) : packs.length === 0 ? (
          <p className="text-xs text-muted-foreground px-1">暂无可选工具包</p>
        ) : (
          packs.map((p) => (
            <div key={p.name} className="flex items-start gap-3 rounded-md border px-3 py-2">
              <Switch
                className="mt-0.5"
                checked={effective.has(p.name)}
                disabled={loading}
                onCheckedChange={(v) => toggle(p.name, v)}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{p.label}</span>
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">{p.name}</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{p.description}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
