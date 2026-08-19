import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { AppSettings, FailoverConfig } from '@/types/settings';

interface Props {
  local: AppSettings;
  setLocal: React.Dispatch<React.SetStateAction<AppSettings>>;
}

const EMPTY_FAILOVER: FailoverConfig = { enabled: false, chain: [] };

export function FailoverSection({ local, setLocal }: Props) {
  const failover = local.failover ?? EMPTY_FAILOVER;
  const chain = failover.chain.filter((entry) => local.profiles[entry.profileId]);

  const updateFailover = (patch: Partial<FailoverConfig>) => {
    setLocal((prev) => ({
      ...prev,
      failover: { ...(prev.failover ?? EMPTY_FAILOVER), ...patch },
    }));
  };

  const setTier = (profileId: string, tier: string) => {
    updateFailover({
      chain: failover.chain.map((entry) => (entry.profileId === profileId ? { ...entry, tier } : entry)),
    });
  };

  const moveEntry = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= chain.length) return;
    const next = [...chain];
    [next[index], next[target]] = [next[target], next[index]];
    updateFailover({ chain: next });
  };

  return (
    <div className="mt-10 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">模型故障转移</h3>
          <p className="text-xs text-muted-foreground">费率错误（限流/余额不足）时自动切换供应商继续</p>
        </div>
        <Switch
          checked={failover.enabled}
          onCheckedChange={(v) => updateFailover({ enabled: v })}
          aria-label="启用模型故障转移"
        />
      </div>

      {chain.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          尚无可用的故障转移链：配置好供应商（含模型清单）后会自动生成。
        </p>
      ) : (
        <div className="space-y-2">
          {chain.map((entry, index) => {
            const profile = local.profiles[entry.profileId];
            const models = profile.piModels ?? [];
            const tierValid = models.some((m) => m.id === entry.tier);
            return (
              <div key={entry.profileId} className="flex items-center gap-2">
                <span className="w-5 text-right text-xs text-muted-foreground">{index + 1}</span>
                <span className="w-28 shrink-0 truncate text-sm" title={profile.name}>{profile.name}</span>
                <select
                  className="h-9 min-w-0 flex-1 px-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  value={entry.tier}
                  onChange={(e) => setTier(entry.profileId, e.target.value)}
                >
                  {!tierValid && (
                    <option value={entry.tier}>{entry.tier}（已失效，重载设置后回退）</option>
                  )}
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.label ?? m.id}</option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={index === 0}
                  onClick={() => moveEntry(index, -1)}
                  aria-label={`上移 ${profile.name}`}
                >
                  <ArrowUp className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={index === chain.length - 1}
                  onClick={() => moveEntry(index, 1)}
                  aria-label={`下移 ${profile.name}`}
                >
                  <ArrowDown className="w-4 h-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {chain.length < 2 && (
        <p className="text-xs text-muted-foreground">至少配置两家供应商才能故障转移。</p>
      )}
      <p className="text-xs text-muted-foreground">
        新供应商会自动追加到列表末尾；切换沿列表从上到下顺位进行，整条链走完仍失败将停止会话并报错。
      </p>
    </div>
  );
}
