import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Workspace, WorkspaceConfig } from '@/types/electron-api';
import type { AbilityPackView } from '../../electron/main/tipc/ability';
import { AbilityPackCard } from './ability/AbilityPackCard';
import { AbilityPackDetailPage } from './ability/AbilityPackDetailPage';
import { CustomSkillDetailPage } from './ability/CustomSkillDetailPage';
import { CustomSkillsSection } from './ability/CustomSkillsSection';
import { RulesPackCard } from './ability/RulesPackCard';
import { RulesPackDetailPage } from './ability/RulesPackDetailPage';
import { SystemBehaviorDetail } from './ability/SystemBehaviorDetail';
import { CATEGORY_FALLBACK, type AbilityCategoryMeta } from './ability/pack-meta';
import { EMPTY_CONFIG } from './ability/config-mutations';
import type { SettingsSearchEntry } from './search-index';

export const ABILITY_SEARCH_ENTRIES: SettingsSearchEntry[] = [
  { label: '能力包总览', description: '查看能力详情与加载情况，启停配置在场景页' },
  { label: '工作区规则', description: '工作区 agent.md 规则包查看与编辑', keywords: ['agent.md'] },
  { label: '全局规则', description: '跨工作区共享的通用级 agent.md 规则包' },
  { label: '系统行为', description: '系统内置行为与常驻工具组详情' },
  { label: '自定义 Skill', description: '自定义技能列表，点击查看与编辑 SKILL.md', keywords: ['skills'] },
];

const SKILL_ROUTE_PREFIX = '__skill__:';

type PacksResult = Awaited<ReturnType<typeof client.getAbilityPacks>>;
type ListedSkills = Exclude<Awaited<ReturnType<typeof client.listSkills>>, { error: string }>['skills'];

export function AbilityTab() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceConfig, setWorkspaceConfig] = useState<WorkspaceConfig>(EMPTY_CONFIG);
  const [packsResult, setPacksResult] = useState<Exclude<PacksResult, { error: string }> | null>(null);
  const [skills, setSkills] = useState<ListedSkills | null>(null);
  const [categories, setCategories] = useState<readonly AbilityCategoryMeta[]>(CATEGORY_FALLBACK);
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [mountsRefreshKey, setMountsRefreshKey] = useState(0);

  const bumpMounts = useCallback(() => setMountsRefreshKey((v) => v + 1), []);

  const refreshSkills = useCallback(async () => {
    const skillsRes = await client.listSkills({ workspaceId: null });
    if ('error' in skillsRes) {
      setSkills(null);
      toast.error('技能列表读取失败', { description: String(skillsRes.error) });
      return;
    }
    setSkills(skillsRes.skills);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [allRes, defaultWs, packsRes] = await Promise.all([
          client.getAll(),
          client.getDefault(),
          client.getAbilityPacks(),
          refreshSkills(),
        ]);
        if (cancelled) return;
        const list = allRes?.workspaces ?? [];
        const defaultId = defaultWs?.id ?? null;
        const initial = defaultId && list.some((w) => w.id === defaultId) ? defaultId : (list[0]?.id ?? null);
        setWorkspaces(list);
        setWorkspaceId(initial);
        setPacksResult('error' in packsRes ? null : packsRes);
        if (initial) {
          const [configRes, sceneRes] = await Promise.all([
            client.getWorkspaceConfig({ workspaceId: initial }),
            client.getSceneOverview({ workspaceId: initial }),
          ]);
          if (!cancelled && configRes && 'config' in configRes) setWorkspaceConfig(configRes.config ?? EMPTY_CONFIG);
          if (!cancelled && sceneRes && 'rows' in sceneRes) setCategories(sceneRes.categories);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSkills]);

  const handleWorkspaceChange = async (id: string) => {
    setWorkspaceId(id);
    const configRes = await client.getWorkspaceConfig({ workspaceId: id });
    if (configRes && 'config' in configRes) setWorkspaceConfig(configRes.config ?? EMPTY_CONFIG);
    bumpMounts();
  };

  const packs = packsResult?.packs ?? [];
  const systemBehaviors = packsResult?.systemBehaviors ?? [];
  const activeWorkspace = workspaces.find((w) => w.id === workspaceId) ?? null;

  const onDemandGroups = packs.flatMap((pack) =>
    (pack.deferredToolGroups ?? []).map((id) => {
      const meta = pack.toolGroupMetas.find((g) => g.id === id);
      return {
        id,
        label: meta?.label ?? id,
        toolCount: meta?.tools.length ?? 0,
        packKey: pack.key,
        packLabel: pack.label,
      };
    }),
  );

  const packEnabled = useCallback(
    (pack: AbilityPackView) => workspaceConfig.abilityOverrides?.[pack.key] ?? pack.defaultEnabled,
    [workspaceConfig.abilityOverrides],
  );

  const rulesPack = packs.find((p) => p.key === 'workspace-rules') ?? null;
  const globalRulesPack = packs.find((p) => p.key === 'global-rules') ?? null;
  const otherPacks = packs.filter((p) => p.key !== 'workspace-rules' && p.key !== 'global-rules');
  const selectedIsRules = selectedKey === 'workspace-rules' || selectedKey === 'global-rules';
  const selectedSkillName = selectedKey?.startsWith(SKILL_ROUTE_PREFIX)
    ? selectedKey.slice(SKILL_ROUTE_PREFIX.length)
    : null;
  const selectedPack =
    selectedKey === '__system__' || selectedIsRules || selectedSkillName
      ? null
      : (packs.find((p) => p.key === selectedKey) ?? null);
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
    return (
      <SystemBehaviorDetail
        behaviors={systemBehaviors}
        residentToolGroups={packsResult?.residentToolGroups ?? []}
        workspaceId={workspaceId}
        onBack={() => setSelectedKey(null)}
      />
    );
  }

  if (selectedIsRules) {
    return (
      <RulesPackDetailPage
        workspace={activeWorkspace}
        workspaceId={workspaceId}
        refreshKey={mountsRefreshKey}
        onBack={() => setSelectedKey(null)}
      />
    );
  }

  if (selectedSkillName) {
    return (
      <CustomSkillDetailPage
        key={selectedSkillName}
        name={selectedSkillName}
        onBack={() => setSelectedKey(null)}
        onRefresh={refreshSkills}
      />
    );
  }

  if (selectedPack) {
    return (
      <AbilityPackDetailPage
        key={selectedPack.key}
        pack={selectedPack}
        workspaceId={workspaceId}
        packEnabled={packEnabled(selectedPack)}
        refreshKey={mountsRefreshKey}
        onBack={() => setSelectedKey(null)}
      />
    );
  }

  return (
    <div className="px-6 py-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">能力</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            查看能力详情与加载情况
            {activeWorkspace ? `（当前工作区：${activeWorkspace.name}）` : ''}
            ；启停配置在场景页。
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
                {w.isDefault ? '（默认）' : ''}
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

      {categories.map((cat) => {
        const catPacks = otherPacks.filter((p) => p.category === cat.key);
        if (cat.key !== 'system' && catPacks.length === 0) return null;
        return (
          <section key={cat.key} className="space-y-2">
            <div>
              <h3 className="text-sm font-semibold">{cat.label}</h3>
              {cat.description && <p className="text-xs text-muted-foreground">{cat.description}</p>}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {cat.key === 'system' && rulesPack && (
                <RulesPackCard
                  workspaceRulesEnabled={packEnabled(rulesPack)}
                  globalRulesEnabled={globalRulesPack ? packEnabled(globalRulesPack) : false}
                  onOpen={() => setSelectedKey('workspace-rules')}
                />
              )}
              {catPacks.map((pack) => (
                <AbilityPackCard
                  key={pack.key}
                  pack={pack}
                  onOpen={() => setSelectedKey(pack.key)}
                />
              ))}
              {cat.key === 'system' && (
                <button
                  type="button"
                  onClick={() => setSelectedKey('__system__')}
                  className="rounded-lg border border-dashed bg-muted/10 p-4 text-left transition-colors hover:border-primary/50 hover:bg-muted/20 flex flex-col gap-2"
                  aria-label="打开系统行为详情"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-semibold truncate">系统行为</span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">系统</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed mt-0.5 line-clamp-2">
                        框架固定行为总览：固定提示词段、常驻工具，均不可关闭。
                      </p>
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground bg-muted/40 rounded px-1.5 py-0.5">
                      提示词段 {systemBehaviors.length} · 常驻工具
                    </span>
                  </div>
                </button>
              )}
            </div>
          </section>
        );
      })}

      {onDemandGroups.length > 0 && (
        <section className="space-y-2">
          <div>
            <h3 className="text-sm font-semibold">按需能力</h3>
            <p className="text-xs text-muted-foreground">低频工具，会话用到时自动可用。</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {onDemandGroups.map((g) => (
              <button
                key={`${g.packKey}:${g.id}`}
                type="button"
                onClick={() => setSelectedKey(g.packKey)}
                className="text-xs rounded px-2 py-1 bg-muted/40 transition-colors hover:bg-muted/70"
                aria-label={`查看 ${g.packLabel}`}
              >
                <span className="text-foreground/80">{g.label}</span>
                <span className="text-muted-foreground">
                  {' '}· {g.toolCount} 工具{g.packLabel !== g.label ? ` · ${g.packLabel}` : ''}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {skills && (
        <CustomSkillsSection
          skills={skills}
          onRefresh={refreshSkills}
          onOpen={(name) => setSelectedKey(`${SKILL_ROUTE_PREFIX}${name}`)}
        />
      )}
    </div>
  );
}
