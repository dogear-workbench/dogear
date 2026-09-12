import { useCallback, useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';

type MountsResult = Awaited<ReturnType<typeof client.getAbilityMounts>>;

interface AbilityMountsSectionProps {
  packKey: string;
  refreshKey: number;
}

function MountGroup({
  label,
  summary,
  defaultOpen,
  children,
}: {
  label: string;
  summary: string;
  defaultOpen?: boolean;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="rounded-md border bg-background overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-muted/40 transition-colors"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ChevronDown
          className={cn('w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform', !open && '-rotate-90')}
        />
        <span className="text-xs font-medium">{label}</span>
        <span className="text-xs text-muted-foreground ml-auto shrink-0">{summary}</span>
      </button>
      {open && children && (
        <div className="px-2.5 py-1.5 border-t border-border/40 space-y-1">{children}</div>
      )}
    </div>
  );
}

function Line({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-muted-foreground leading-relaxed flex items-start gap-1.5 flex-wrap">{children}</div>;
}

export function AbilityMountsSection({ packKey, refreshKey }: AbilityMountsSectionProps) {
  const [mounts, setMounts] = useState<MountsResult | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMounts(await client.getAbilityMounts({ key: packKey }));
    } finally {
      setLoading(false);
    }
  }, [packKey]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (loading && !mounts) {
    return <p className="text-xs text-muted-foreground">挂载情况加载中…</p>;
  }
  if (!mounts || ('error' in mounts)) {
    return <p className="text-xs text-muted-foreground">挂载情况读取失败</p>;
  }

  const enabledWsCount = mounts.workspaces.filter((w) => w.enabled).length;
  const skillPack = mounts.pack.type === 'skill-packs';

  return (
    <div className="space-y-1.5">
      <MountGroup
        label="工作区"
        summary={`${enabledWsCount}/${mounts.workspaces.length} 开启`}
        defaultOpen={mounts.workspaces.length <= 4}
      >
        {mounts.workspaces.map((w) => (
          <Line key={w.workspaceId}>
            <span className="text-foreground/80">{w.workspaceName}</span>
            <span className={w.enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
              {w.enabled ? '已开启' : '已关闭'}
            </span>
            {skillPack && w.enabled && (
              <span className="text-xs text-muted-foreground/70">
                细闸：skill {w.enabledSkills.length} 个
                {w.enabledToolPacks.length > 0 ? ` · 工具包 ${w.enabledToolPacks.length} 个` : ''}
              </span>
            )}
          </Line>
        ))}
      </MountGroup>

      {mounts.profiles.length === 0 ? (
        <MountGroup label="子会话 Profile" summary="不涉及">
          <Line>此包无 Profile 过滤维度，Profile 只能通过工作区开关间接影响。</Line>
        </MountGroup>
      ) : (
        <MountGroup
          label="子会话 Profile"
          summary={`${mounts.profiles.filter((p) => p.enabled).length}/${mounts.profiles.length} 放行`}
        >
          {mounts.profiles.map((p) => (
            <Line key={p.profileId}>
              <span className="text-foreground/80">{p.profileName}</span>
              {!p.profileEnabled && (
                <span className="text-xs px-1 py-0.5 rounded bg-muted text-muted-foreground">已停用</span>
              )}
              <span className={p.enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                {p.enabled ? '细闸放行' : '细闸不放行'}
              </span>
              {p.matchedSkills.length > 0 && (
                <span className="text-xs text-muted-foreground/70">白名单命中 {p.matchedSkills.length} 个 skill</span>
              )}
            </Line>
          ))}
          <Line>
            <span className="text-xs text-muted-foreground/60">实际生效还需工作区总闸开启；Profile 只能做减法。</span>
          </Line>
        </MountGroup>
      )}

      {mounts.tasks.length === 0 ? (
        <MountGroup label="定时任务" summary="无显式覆盖">
          <Line>没有任务为此包显式配置工具包覆盖，跟随工作区配置。</Line>
        </MountGroup>
      ) : (
        <MountGroup label="定时任务" summary={`${mounts.tasks.length} 个命中`}>
          {mounts.tasks.map((t) => (
            <Line key={t.taskId}>
              <span className="text-foreground/80">{t.taskName}</span>
              {!t.taskEnabled && (
                <span className="text-xs px-1 py-0.5 rounded bg-muted text-muted-foreground">已停用</span>
              )}
              <span className="text-xs text-muted-foreground/70">覆盖工具包：{t.matchedToolPacks.join('、')}</span>
            </Line>
          ))}
        </MountGroup>
      )}
    </div>
  );
}
