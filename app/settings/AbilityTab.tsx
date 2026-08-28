import { useCallback, useEffect, useMemo, useState } from 'react';
import { client } from '@/lib/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { SystemPromptSegment } from '@/types/system-prompt';
import type { AppSettings } from '@/types/settings';
import type { Workspace, WorkspaceConfig } from '@/types/electron-api';
import type { SkillEntry, SkillTemplate, ToolGroup, ToolPack } from './ability-types';
import { SKILL_PACK_MAP, buildDomainViews } from './ability-types';
import { AbilityDomainCard } from './AbilityDomainCard';
import { AbilityResidentSection } from './AbilityResidentSection';
import { SkillDetailDialog } from './SkillDetailDialog';
import { ToolDetailDialog } from './ToolDetailDialog';
import { SegmentDetailDialog } from './SegmentDetailDialog';

const EMPTY_CONFIG: WorkspaceConfig = { enabledToolPacks: [], enabledSkills: [] };

interface AbilityTabProps {
  local: AppSettings;
  setLocal: React.Dispatch<React.SetStateAction<AppSettings>>;
}

export function AbilityTab({ local: _local, setLocal: _setLocal }: AbilityTabProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [toolGroups, setToolGroups] = useState<ToolGroup[]>([]);
  const [packs, setPacks] = useState<ToolPack[]>([]);
  const [segments, setSegments] = useState<SystemPromptSegment[]>([]);
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [templates, setTemplates] = useState<SkillTemplate[]>([]);
  const [workspaceConfig, setWorkspaceConfig] = useState<WorkspaceConfig>(EMPTY_CONFIG);
  const [loading, setLoading] = useState(true);
  const [detailSkill, setDetailSkill] = useState<{ name: string; description?: string } | null>(null);
  const [detailTool, setDetailTool] = useState<{ name: string; description: string } | null>(null);
  const [detailSegment, setDetailSegment] = useState<SystemPromptSegment | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [expandedDomains, setExpandedDomains] = useState<Record<string, boolean>>({});
  const [expandedPacks, setExpandedPacks] = useState<Record<string, boolean>>({});
  const [highlightServer, setHighlightServer] = useState<string | null>(null);

  const enabledSkillSet = useMemo(
    () => new Set(workspaceConfig.enabledSkills),
    [workspaceConfig.enabledSkills],
  );

  const groupByServer = useMemo(() => {
    const map: Record<string, ToolGroup> = {};
    for (const g of toolGroups) map[g.server] = g;
    return map;
  }, [toolGroups]);

  const domainViews = useMemo(
    () => buildDomainViews({ templates, skills, packs, groupByServer, enabledSkills: enabledSkillSet }),
    [templates, skills, packs, groupByServer, enabledSkillSet],
  );

  const loadWorkspaceData = useCallback(async (wsId: string | null) => {
    const [packsRes, skillsRes, configRes] = await Promise.all([
      wsId
        ? client.listToolPacks({ workspaceId: wsId }).then((r: any) => (Array.isArray(r) ? (r as ToolPack[]) : []))
        : Promise.resolve([] as ToolPack[]),
      wsId
        ? client.listSkills({ workspaceId: wsId }).then((r: any) => (r?.skills ?? []) as SkillEntry[])
        : Promise.resolve([] as SkillEntry[]),
      wsId
        ? client.getWorkspaceConfig({ workspaceId: wsId }).then((r: any) => (r && typeof r === 'object' && 'config' in r ? (r as any).config as WorkspaceConfig : EMPTY_CONFIG))
        : Promise.resolve(EMPTY_CONFIG),
    ]);
    setPacks(packsRes);
    setSkills(skillsRes);
    setWorkspaceConfig(configRes);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [allRes, defaultWs] = await Promise.all([
          client.getAll(),
          client.getDefault(),
        ]);
        if (cancelled) return;
        const list = allRes?.workspaces ?? [];
        const defaultId = defaultWs?.id ?? null;
        const initial =
          defaultId && list.some((w) => w.id === defaultId)
            ? defaultId
            : list[0]?.id ?? null;
        setWorkspaces(list);
        setWorkspaceId(initial);

        const [groupsRes, segmentsRes, templatesRes] = await Promise.all([
          client.getRegisteredTools().then((r: any) => (Array.isArray(r) ? (r as ToolGroup[]) : [])),
          client.getSystemPromptSegments().then((r: any) => {
            if (r && typeof r === 'object' && 'error' in r) return [] as SystemPromptSegment[];
            return (r?.segments ?? []) as SystemPromptSegment[];
          }),
          client.listSkillTemplates().then((r: any) => (r?.templates ?? []) as SkillTemplate[]),
        ]);
        if (cancelled) return;
        setToolGroups(groupsRes);
        setSegments(segmentsRes);
        setTemplates(templatesRes);
        await loadWorkspaceData(initial);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadWorkspaceData]);

  useEffect(() => {
    if (!highlightServer) return;
    const raf = requestAnimationFrame(() => {
      document
        .querySelector(`[data-server="${highlightServer}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    const timer = setTimeout(() => setHighlightServer(null), 2000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [highlightServer]);

  const handleWorkspaceChange = async (id: string) => {
    setWorkspaceId(id);
    setLoading(true);
    try {
      await loadWorkspaceData(id);
    } finally {
      setLoading(false);
    }
  };

  const applyConfigResult = (res: unknown) => {
    if (res && typeof res === 'object' && 'config' in (res as Record<string, unknown>)) {
      const merged = (res as { config: WorkspaceConfig }).config;
      setWorkspaceConfig(merged);
      const enabledPacks = new Set(merged.enabledToolPacks ?? []);
      setPacks((prev) => prev.map((p) => ({ ...p, enabled: enabledPacks.has(p.name) })));
    }
  };

  const applySkillToggles = async (names: string[], enable: boolean, key: string) => {
    if (!workspaceId) return;
    setBusyKey(key);
    try {
      const enabledSkills = new Set(workspaceConfig.enabledSkills);
      const enabledToolPacks = new Set(workspaceConfig.enabledToolPacks);
      if (enable) {
        for (const name of names) {
          enabledSkills.add(name);
          for (const p of SKILL_PACK_MAP[name] ?? []) enabledToolPacks.add(p);
        }
      } else {
        for (const name of names) enabledSkills.delete(name);
        const keptByOthers = new Set<string>();
        for (const other of enabledSkills) {
          for (const p of SKILL_PACK_MAP[other] ?? []) keptByOthers.add(p);
        }
        for (const name of names) {
          for (const p of SKILL_PACK_MAP[name] ?? []) {
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
      applyConfigResult(res);
    } finally {
      setBusyKey(null);
    }
  };

  const handleToggleSkill = (name: string, enable: boolean) =>
    applySkillToggles([name], enable, name);

  const handleToggleDomain = (domainId: string, skillNames: string[], enable: boolean) =>
    applySkillToggles(skillNames, enable, `domain:${domainId}`);

  const handleJumpToPack = (server: string) => {
    const domain = domainViews.find((d) => d.packs.some((p) => p.server === server));
    if (!domain) return;
    setExpandedDomains((prev) => ({ ...prev, [domain.id]: true }));
    setExpandedPacks((prev) => ({ ...prev, [server]: true }));
    setHighlightServer(server);
  };

  const activeWorkspace = workspaces.find((w) => w.id === workspaceId) ?? null;
  const noWorkspace = workspaceId === null;

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-6 py-6">
        <div className="flex items-center justify-center h-40">
          <div className="text-sm text-muted-foreground">加载中...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 py-6 space-y-4">
      <div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-lg font-semibold">能力</h2>
          <Select
            value={workspaceId ?? undefined}
            onValueChange={(v) => void handleWorkspaceChange(v)}
            disabled={workspaces.length === 0}
          >
            <SelectTrigger size="sm" className="w-[200px]" aria-label="选择工作区">
              <SelectValue
                placeholder={workspaces.length === 0 ? '暂无工作区' : '选择工作区'}
              />
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
        <p className="text-sm text-muted-foreground mt-1">
          按能力域总览 Skill 与工具包，整体开关控制域内全部 Skill
          {activeWorkspace ? `（当前编辑：${activeWorkspace.name}）` : ''}
          ，修改后需重启会话生效。
        </p>
      </div>

      {noWorkspace && (
        <p className="text-sm text-amber-600 dark:text-amber-400">请先在工作区管理创建工作区后再挂载能力。</p>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {domainViews.map((view) => (
          <div key={view.id} className={view.packs.length >= 2 ? 'xl:col-span-2' : undefined}>
            <AbilityDomainCard
              view={view}
              busyKey={busyKey}
              disabled={noWorkspace}
              expanded={expandedDomains[view.id] ?? true}
              onToggleExpand={() =>
                setExpandedDomains((prev) => ({
                  ...prev,
                  [view.id]: !(prev[view.id] ?? true),
                }))
              }
              expandedPacks={expandedPacks}
              onTogglePackExpand={(server) =>
                setExpandedPacks((prev) => ({ ...prev, [server]: !prev[server] }))
              }
              highlightServer={highlightServer}
              onSkillDetail={setDetailSkill}
              onToggleSkill={handleToggleSkill}
              onToggleDomain={(enable) =>
                handleToggleDomain(
                  view.id,
                  view.skills.map((s) => s.name),
                  enable,
                )
              }
              onToolClick={setDetailTool}
              onJumpToPack={handleJumpToPack}
            />
          </div>
        ))}
      </div>

      {domainViews.length === 0 && (
        <p className="text-sm text-muted-foreground">未发现任何 Skill 模板。</p>
      )}

      <AbilityResidentSection
        segments={segments}
        groupByServer={groupByServer}
        onSegmentClick={setDetailSegment}
        onToolClick={setDetailTool}
      />

      <SkillDetailDialog skill={detailSkill} onClose={() => setDetailSkill(null)} />
      <ToolDetailDialog tool={detailTool} onClose={() => setDetailTool(null)} />
      <SegmentDetailDialog segment={detailSegment} onClose={() => setDetailSegment(null)} />
    </div>
  );
}
