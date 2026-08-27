import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { SystemPromptSegment } from '@/types/system-prompt';
import type { AppSettings } from '@/types/settings';
import type { Workspace, WorkspaceConfig } from '@/types/electron-api';
import type { SkillEntry, SkillTemplate, ToolGroup, ToolPack } from './ability-types';
import { SKILL_PACK_MAP } from './ability-types';
import { AbilitySkillView } from './AbilitySkillView';
import { AbilityToolGroupView } from './AbilityToolGroupView';
import { SkillDetailDialog } from './SkillDetailDialog';
import { ToolDetailDialog } from './ToolDetailDialog';
import { SegmentDetailDialog } from './SegmentDetailDialog';

const EMPTY_CONFIG: WorkspaceConfig = { enabledToolPacks: [], enabledSkills: [] };

const VIEW_OPTIONS = [
  { value: 'prompt', label: '提示词 + Skill' },
  { value: 'tools', label: '工具组' },
] as const;

type AbilityView = (typeof VIEW_OPTIONS)[number]['value'];

interface AbilityTabProps {
  local: AppSettings;
  setLocal: React.Dispatch<React.SetStateAction<AppSettings>>;
}

export function AbilityTab({ local: _local, setLocal: _setLocal }: AbilityTabProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [view, setView] = useState<AbilityView>('prompt');
  const [highlightServer, setHighlightServer] = useState<string | null>(null);
  const [toolGroups, setToolGroups] = useState<ToolGroup[]>([]);
  const [packs, setPacks] = useState<ToolPack[]>([]);
  const [segments, setSegments] = useState<SystemPromptSegment[]>([]);
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [templates, setTemplates] = useState<SkillTemplate[]>([]);
  const [workspaceConfig, setWorkspaceConfig] = useState<WorkspaceConfig>(EMPTY_CONFIG);
  const [loading, setLoading] = useState(true);
  const [detailName, setDetailName] = useState<string | null>(null);
  const [detailTool, setDetailTool] = useState<{ name: string; description: string } | null>(null);
  const [detailSegment, setDetailSegment] = useState<SystemPromptSegment | null>(null);
  const [busySkill, setBusySkill] = useState<string | null>(null);
  const [busyPack, setBusyPack] = useState<string | null>(null);

  const enabledSkillSet = useMemo(
    () => new Set(workspaceConfig.enabledSkills),
    [workspaceConfig.enabledSkills],
  );

  const groupByServer = useMemo(() => {
    const map: Record<string, ToolGroup> = {};
    for (const g of toolGroups) map[g.server] = g;
    return map;
  }, [toolGroups]);

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

  const handleToggleSkill = async (name: string, enable: boolean) => {
    if (!workspaceId) return;
    setBusySkill(name);
    try {
      const enabledSkills = new Set(workspaceConfig.enabledSkills);
      const enabledToolPacks = new Set(workspaceConfig.enabledToolPacks);
      const relatedPacks = SKILL_PACK_MAP[name] ?? [];
      if (enable) {
        enabledSkills.add(name);
        for (const p of relatedPacks) enabledToolPacks.add(p);
      } else {
        enabledSkills.delete(name);
        const keptByOthers = new Set<string>();
        for (const other of enabledSkills) {
          for (const p of SKILL_PACK_MAP[other] ?? []) keptByOthers.add(p);
        }
        for (const p of relatedPacks) {
          if (!keptByOthers.has(p)) enabledToolPacks.delete(p);
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
      setBusySkill(null);
    }
  };

  const handleTogglePack = async (name: string, enable: boolean) => {
    if (!workspaceId) return;
    setBusyPack(name);
    try {
      const enabledToolPacks = new Set(workspaceConfig.enabledToolPacks);
      if (enable) {
        enabledToolPacks.add(name);
      } else {
        enabledToolPacks.delete(name);
      }
      const res = await client.updateWorkspaceConfig({
        workspaceId,
        config: { enabledToolPacks: Array.from(enabledToolPacks) },
      });
      applyConfigResult(res);
    } finally {
      setBusyPack(null);
    }
  };

  const handleJumpToGroup = (server: string) => {
    setView('tools');
    setHighlightServer(server);
  };

  const activeWorkspace = workspaces.find((w) => w.id === workspaceId) ?? null;

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto py-6 px-6">
        <div className="flex items-center justify-center h-40">
          <div className="text-sm text-muted-foreground">加载中...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-6 px-6 space-y-6">
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
          提示词段按会话上下文自动注入；Skill 与工具包按所选工作区挂载
          {activeWorkspace ? `（当前编辑：${activeWorkspace.name}）` : ''}，修改后需重启会话生效。
        </p>
      </div>

      <div className="flex justify-center">
        <div className="inline-flex items-center justify-center rounded-full bg-muted p-1">
          {VIEW_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={cn(
                'inline-flex items-center justify-center whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-all',
                view === opt.value
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setView(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {view === 'prompt' ? (
        <AbilitySkillView
          segments={segments}
          templates={templates}
          skills={skills}
          enabledSkills={enabledSkillSet}
          packs={packs}
          groupByServer={groupByServer}
          workspaceId={workspaceId}
          busySkill={busySkill}
          onSegmentClick={setDetailSegment}
          onSkillDetail={setDetailName}
          onToggleSkill={(name, enabled) => void handleToggleSkill(name, enabled)}
          onJumpToGroup={handleJumpToGroup}
        />
      ) : (
        <AbilityToolGroupView
          groupByServer={groupByServer}
          packs={packs}
          workspaceId={workspaceId}
          highlightServer={highlightServer}
          busyPack={busyPack}
          onToolClick={setDetailTool}
          onTogglePack={(name, enabled) => void handleTogglePack(name, enabled)}
          onHighlightEnd={() => setHighlightServer(null)}
        />
      )}

      <SkillDetailDialog name={detailName} onClose={() => setDetailName(null)} />
      <ToolDetailDialog tool={detailTool} onClose={() => setDetailTool(null)} />
      <SegmentDetailDialog segment={detailSegment} onClose={() => setDetailSegment(null)} />
    </div>
  );
}
