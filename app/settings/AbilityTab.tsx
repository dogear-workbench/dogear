import { useCallback, useEffect, useMemo, useState } from 'react';
import { client } from '@/lib/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Workspace, WorkspaceConfig } from '@/types/electron-api';
import type { AbilityPackView } from '../../electron/main/tipc/ability';
import { AbilityPackCard } from './ability/AbilityPackCard';
import { AbilityPackDetailPage } from './ability/AbilityPackDetailPage';
import { SystemBehaviorDetail } from './ability/SystemBehaviorDetail';
import { SYSTEM_BEHAVIOR_ICON } from './ability/pack-meta';

type PacksResult = Awaited<ReturnType<typeof client.getAbilityPacks>>;

const EMPTY_CONFIG: WorkspaceConfig = { enabledToolPacks: [], enabledSkills: [] };

export function AbilityTab() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceConfig, setWorkspaceConfig] = useState<WorkspaceConfig>(EMPTY_CONFIG);
  const [packsResult, setPacksResult] = useState<Exclude<PacksResult, { error: string }> | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [packBusy, setPackBusy] = useState(false);
  const [skillBusy, setSkillBusy] = useState(false);
  const [configVersion, setConfigVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [allRes, defaultWs, packsRes] = await Promise.all([
          client.getAll(),
          client.getDefault(),
          client.getAbilityPacks(),
        ]);
        if (cancelled) return;
        const list = allRes?.workspaces ?? [];
        const defaultId = defaultWs?.id ?? null;
        const initial = defaultId && list.some((w) => w.id === defaultId) ? defaultId : (list[0]?.id ?? null);
        setWorkspaces(list);
        setWorkspaceId(initial);
        setPacksResult('error' in packsRes ? null : packsRes);
        if (initial) {
          const configRes = await client.getWorkspaceConfig({ workspaceId: initial });
          if (!cancelled && configRes && 'config' in configRes) setWorkspaceConfig(configRes.config ?? EMPTY_CONFIG);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleWorkspaceChange = async (id: string) => {
    setWorkspaceId(id);
    const configRes = await client.getWorkspaceConfig({ workspaceId: id });
    if (configRes && 'config' in configRes) setWorkspaceConfig(configRes.config ?? EMPTY_CONFIG);
    setConfigVersion((v) => v + 1);
  };

  const writeOverrides = useCallback(
    async (overrides: Record<string, boolean>) => {
      if (!workspaceId) return;
      setPackBusy(true);
      try {
        const res = await client.updateWorkspaceConfig({ workspaceId, config: { abilityOverrides: overrides } });
        if (res && 'config' in res && res.config) {
          setWorkspaceConfig(res.config);
          setConfigVersion((v) => v + 1);
        }
      } finally {
        setPackBusy(false);
      }
    },
    [workspaceId],
  );

  const handleTogglePack = useCallback(
    (key: string, enable: boolean) => {
      void writeOverrides({ ...workspaceConfig.abilityOverrides, [key]: enable });
    },
    [writeOverrides, workspaceConfig.abilityOverrides],
  );

  const skillToPacks = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const pack of packsResult?.packs ?? []) {
      for (const skill of pack.skillMetas) map[skill.name] = skill.toolPacks;
    }
    return map;
  }, [packsResult]);

  const handleToggleSkills = useCallback(
    async (names: string[], enable: boolean) => {
      if (!workspaceId || names.length === 0) return;
      setSkillBusy(true);
      try {
        const enabledSkills = new Set(workspaceConfig.enabledSkills);
        const enabledToolPacks = new Set(workspaceConfig.enabledToolPacks);
        if (enable) {
          for (const name of names) {
            enabledSkills.add(name);
            for (const p of skillToPacks[name] ?? []) enabledToolPacks.add(p);
          }
        } else {
          for (const name of names) enabledSkills.delete(name);
          const keptByOthers = new Set<string>();
          for (const other of enabledSkills) {
            for (const p of skillToPacks[other] ?? []) keptByOthers.add(p);
          }
          for (const name of names) {
            for (const p of skillToPacks[name] ?? []) {
              if (!keptByOthers.has(p)) enabledToolPacks.delete(p);
            }
          }
        }
        const res = await client.updateWorkspaceConfig({
          workspaceId,
          config: {
            enabledSkills: Array.from(enabledSkills),
            enabledToolPacks: Array.from(enabledToolPacks),
          },
        });
        if (res && 'config' in res && res.config) {
          setWorkspaceConfig(res.config);
          setConfigVersion((v) => v + 1);
        }
      } finally {
        setSkillBusy(false);
      }
    },
    [skillToPacks, workspaceConfig, workspaceId],
  );

  const packs = packsResult?.packs ?? [];
  const systemBehaviors = packsResult?.systemBehaviors ?? [];
  const activeWorkspace = workspaces.find((w) => w.id === workspaceId) ?? null;

  const packEnabled = useCallback(
    (pack: AbilityPackView) => workspaceConfig.abilityOverrides?.[pack.key] ?? pack.defaultEnabled,
    [workspaceConfig.abilityOverrides],
  );

  const selectedPack = selectedKey === '__system__' ? null : (packs.find((p) => p.key === selectedKey) ?? null);
  const selectedIsSystem = selectedKey === '__system__';

  const noWorkspace = workspaceId === null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="text-sm text-muted-foreground">加载中...</div>
      </div>
    );
  }

  if (selectedIsSystem) {
    return <SystemBehaviorDetail behaviors={systemBehaviors} onBack={() => setSelectedKey(null)} />;
  }

  if (selectedPack) {
    return (
      <AbilityPackDetailPage
        pack={selectedPack}
        workspace={activeWorkspace}
        workspaceId={workspaceId}
        config={workspaceConfig}
        packEnabled={packEnabled(selectedPack)}
        packBusy={packBusy}
        skillBusy={skillBusy}
        configVersion={configVersion}
        onBack={() => setSelectedKey(null)}
        onTogglePack={(enable) => handleTogglePack(selectedPack.key, enable)}
        onToggleSkill={(name, enable) => void handleToggleSkills([name], enable)}
      />
    );
  }

  return (
    <div className="px-6 py-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">能力</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            能力包 = 提示词段 + 工具组 + Skill 的组合；点击卡片查看详情与挂载情况
            {activeWorkspace ? `，当前编辑：${activeWorkspace.name}` : ''}
            ，修改后需重启会话生效。
          </p>
        </div>
        <Select
          value={workspaceId ?? undefined}
          onValueChange={(v) => void handleWorkspaceChange(v)}
          disabled={workspaces.length === 0}
        >
          <SelectTrigger size="sm" className="w-[200px]" aria-label="选择工作区">
            <SelectValue placeholder={workspaces.length === 0 ? '暂无工作区' : '选择工作区'} />
          </SelectTrigger>
          <SelectContent>
            {workspaces.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
                {w.is_default ? '（默认）' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {noWorkspace && (
        <p className="text-sm text-amber-600 dark:text-amber-400">请先在工作区管理创建工作区后再配置能力。</p>
      )}
      {!packsResult && (
        <p className="text-sm text-destructive">能力注册表读取失败，请重启应用重试。</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {packs.map((pack) => (
          <AbilityPackCard
            key={pack.key}
            pack={pack}
            enabled={packEnabled(pack)}
            disabled={noWorkspace}
            busy={packBusy}
            onToggle={(enable) => handleTogglePack(pack.key, enable)}
            onOpen={() => setSelectedKey(pack.key)}
          />
        ))}
        <button
          type="button"
          onClick={() => setSelectedKey('__system__')}
          className="rounded-lg border border-dashed bg-muted/10 p-4 text-left transition-colors hover:border-primary/50 hover:bg-muted/20 flex flex-col gap-2"
          aria-label="打开系统行为详情"
        >
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-muted/60 p-2 shrink-0">
              <SYSTEM_BEHAVIOR_ICON className="w-5 h-5 text-foreground/80" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold truncate">系统行为</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">系统</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mt-0.5 line-clamp-2">
                结构性注入段：组上下文、子会话契约、Profile 索引，不可关闭。
              </p>
            </div>
          </div>
          <div>
            <span className="text-[10px] text-muted-foreground bg-muted/40 rounded px-1.5 py-0.5">
              提示词段 {systemBehaviors.length}
            </span>
          </div>
        </button>
      </div>
    </div>
  );
}
