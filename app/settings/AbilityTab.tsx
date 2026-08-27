import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { AbilityCard } from './AbilityCard';
import { SkillDetailDialog } from './SkillDetailDialog';
import { ToolDetailDialog } from './ToolDetailDialog';
import { SegmentDetailDialog } from './SegmentDetailDialog';
import type { SystemPromptSegment } from '@/types/system-prompt';
import type { AppSettings } from '@/types/settings';
import type { WorkspaceConfig } from '@/types/electron-api';

// ── 类型 ──────────────────────────────────────────────

interface ToolInfo {
  name: string;
  shortDescription: string;
  description: string;
  server: string;
}
interface ToolGroup {
  server: string;
  label: string;
  tools: ToolInfo[];
}
interface ToolPack {
  name: string;
  label: string;
  description: string;
  mcpServer: string;
  toolCount: number;
  requiresWorkspace: boolean;
  requirements?: string;
  enabled: boolean;
}
type SkillSource = 'builtin' | 'custom' | 'user';
interface SkillEntry {
  source: SkillSource;
  name: string;
  description?: string;
  dir: string;
  filePath: string;
  enabled: boolean;
}
interface SkillTemplate {
  name: string;
  description: string;
}

// ── 能力域分组常量 ────────────────────────────────────

const MEMORY_SERVERS = ['dogear-memory'];
const MEMORY_SKILL_NAMES = ['cross-session-review'];
const DELEGATION_SERVERS = [
  'dogear-delegation',
  'dogear-group',
  'dogear-reference',
];
const DELEGATION_CATEGORIES: SystemPromptSegment['category'][] = [
  'reference',
  'group',
  'notes',
  'sub-agent',
];
const STOCK_PACK_NAMES = [
  'stock-quote',
  'stock-analysis',
  'stock-announcement',
  'stock-picking',
];
const STOCK_SKILL_NAMES = ['stock-analysis', 'stock-picking'];
const ARTICLE_PACK_NAMES = ['article'];
const ARTICLE_SKILL_NAMES = ['article-parser'];
const CODE_WORKFLOW_TEMPLATES = [
  'brainstorming',
  'codebase-map',
  'doc-sync',
  'staged-execution',
  'staged-impl',
  'systematic-debugging',
];

const SOURCE_LABELS: Record<SkillSource, string> = {
  builtin: '内置',
  custom: '自定义',
  user: '用户级',
};

// ── 工具组列表子组件 ──────────────────────────────────

function ToolGroupList({
  servers,
  groupByServer,
  onToolClick,
}: {
  servers: string[];
  groupByServer: Record<string, ToolGroup>;
  onToolClick: (tool: { name: string; description: string }) => void;
}) {
  const visible = servers
    .map((s) => groupByServer[s])
    .filter((g): g is ToolGroup => !!g);
  if (visible.length === 0) {
    return (
      <p className="text-xs text-muted-foreground px-1 py-2">
        会话启动后才会注册具体工具，此处暂无明细。
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {visible.map((group) => (
        <div
          key={group.server}
          className="rounded-md border bg-background overflow-hidden"
        >
          <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/30">
            <span className="text-xs font-semibold truncate">
              {group.label || group.server}
            </span>
            <span className="text-[10px] text-muted-foreground font-mono shrink-0">
              {group.server}
            </span>
            <span className="text-[10px] text-muted-foreground shrink-0 ml-auto">
              {group.tools.length} 个
            </span>
          </div>
          <div className="divide-y">
            {group.tools.map((t) => (
              <button
                key={`${group.server}::${t.name}`}
                type="button"
                className="w-full flex items-start gap-2 px-3 py-1.5 text-left hover:bg-muted/30 transition-colors"
                onClick={() => onToolClick({ name: t.name, description: t.description })}
              >
                <span className="text-xs font-mono text-foreground shrink-0">
                  {t.name}
                </span>
                <span className="text-xs text-muted-foreground leading-relaxed">
                  {t.shortDescription}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 工具包+工具组合并列表子组件 ──────────────────────

function PackGroupList({
  packs,
  groupByServer,
  onToolClick,
  active,
}: {
  packs: ToolPack[];
  groupByServer: Record<string, ToolGroup>;
  onToolClick: (tool: { name: string; description: string }) => void;
  active?: boolean;
}) {
  if (packs.length === 0) {
    return (
      <p className="text-xs text-muted-foreground px-1 py-2">
        会话启动后才会注册具体工具，此处暂无明细。
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {packs.map((p) => {
        const group = groupByServer[p.mcpServer];
        return (
          <div
            key={p.name}
            className={cn(
              'rounded-md border overflow-hidden transition-colors',
              active ? 'bg-muted/30 border-foreground/20' : 'bg-background',
            )}
          >
            <div className="px-3 py-1.5 bg-muted/30">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold truncate">{p.label}</span>
                <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                  {p.name}
                </span>
                {group && (
                  <span className="text-[10px] text-muted-foreground shrink-0 ml-auto">
                    {group.tools.length} 个
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                {p.description}
              </p>
            </div>
            {group && (
              <div className="divide-y">
                {group.tools.map((t) => (
                  <button
                    key={`${group.server}::${t.name}`}
                    type="button"
                    className="w-full flex items-start gap-2 px-3 py-1.5 text-left hover:bg-muted/30 transition-colors"
                    onClick={() => onToolClick({ name: t.name, description: t.description })}
                  >
                    <span className="text-xs font-mono text-foreground shrink-0">
                      {t.name}
                    </span>
                    <span className="text-xs text-muted-foreground leading-relaxed">
                      {t.shortDescription}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── 域级总开关子组件 ────────────────────────────────

function DomainToggle({
  allOn,
  onToggle,
  busy,
}: {
  allOn: boolean;
  onToggle: () => void;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
        allOn ? 'bg-primary' : 'bg-muted',
        busy && 'opacity-50 cursor-not-allowed',
      )}
      onClick={onToggle}
      aria-label={allOn ? '全部禁用' : '全部启用'}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform',
          allOn ? 'translate-x-4' : 'translate-x-1',
        )}
      />
    </button>
  );
}

// ── 提示词段子组件 ────────────────────────────────────

function SegmentList({
  segments,
  emptyHint,
  onSegmentClick,
}: {
  segments: SystemPromptSegment[];
  emptyHint?: string;
  onSegmentClick: (segment: SystemPromptSegment) => void;
}) {
  if (segments.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {emptyHint ?? '当前上下文无注入。'}
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {segments.map((seg) => (
        <div
          key={seg.key}
          className="p-2 rounded-md border border-border/60 bg-muted/20"
        >
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold">{seg.label}</span>
            {seg.isDynamic && (
              <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
                动态
              </span>
            )}
            <button
              type="button"
              className="flex items-center gap-1 px-1.5 h-6 rounded text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors ml-auto"
              onClick={() => onSegmentClick(seg)}
              title="查看提示词段全文"
            >
              <Eye className="w-3 h-3" />
              详情
            </button>
          </div>
          {seg.triggerDescription && (
            <p className="text-xs text-muted-foreground/80 leading-relaxed mt-1">
              {seg.triggerDescription}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Skill 行子组件 ────────────────────────────────────

interface SkillRowProps {
  name: string;
  description?: string;
  source?: SkillSource;
  enabled: boolean;
  showToggle?: boolean;
  busy: boolean;
  onDetail: (name: string) => void;
  onToggle?: (name: string, enabled: boolean) => void;
}

function SkillRow({
  name,
  description,
  source,
  enabled,
  showToggle = true,
  busy,
  onDetail,
  onToggle,
}: SkillRowProps) {
  return (
    <div className="p-2 rounded-md border bg-background">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs font-semibold font-mono">{name}</span>
        {source && (
          <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
            {SOURCE_LABELS[source]}
          </span>
        )}
        {showToggle && !enabled && (
          <span className="text-[10px] px-1 py-0.5 rounded bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400">
            未挂载
          </span>
        )}
        {showToggle && enabled && (
          <span className="text-[10px] px-1 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400">
            已挂载
          </span>
        )}
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          <button
            type="button"
            className="flex items-center gap-1 px-1.5 h-6 rounded text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
            onClick={() => onDetail(name)}
            title="查看 SKILL.md 全文"
          >
            <Eye className="w-3 h-3" />
            详情
          </button>
          {showToggle && onToggle && (
            <button
              type="button"
              disabled={busy}
              className={cn(
                'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                enabled ? 'bg-primary' : 'bg-muted',
                busy && 'opacity-50 cursor-not-allowed',
              )}
              onClick={() => onToggle(name, !enabled)}
              aria-label={`${enabled ? '取消挂载' : '挂载'} ${name}`}
            >
              <span
                className={cn(
                  'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform',
                  enabled ? 'translate-x-4' : 'translate-x-1',
                )}
              />
            </button>
          )}
        </div>
      </div>
      {description && (
        <p className="text-xs text-muted-foreground leading-relaxed mt-1">
          {description}
        </p>
      )}
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────

interface AbilityTabProps {
  local: AppSettings;
  setLocal: React.Dispatch<React.SetStateAction<AppSettings>>;
}

export function AbilityTab({ local: _local, setLocal: _setLocal }: AbilityTabProps) {
  const workspaceId = useWorkspaceStore((s) => s.workspace?.id ?? null);

  const [toolGroups, setToolGroups] = useState<ToolGroup[]>([]);
  const [packs, setPacks] = useState<ToolPack[]>([]);
  const [segments, setSegments] = useState<SystemPromptSegment[]>([]);
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [templates, setTemplates] = useState<SkillTemplate[]>([]);
  const [workspaceConfig, setWorkspaceConfig] = useState<WorkspaceConfig>({
    enabledToolPacks: [],
    enabledSkills: [],
  });
  const [loading, setLoading] = useState(true);
  const [detailName, setDetailName] = useState<string | null>(null);
  const [detailTool, setDetailTool] = useState<{ name: string; description: string } | null>(null);
  const [detailSegment, setDetailSegment] = useState<SystemPromptSegment | null>(null);
  const [busySkill, setBusySkill] = useState<string | null>(null);
  const [busyBulk, setBusyBulk] = useState(false);

  const enabledPackSet = useMemo(
    () => new Set(workspaceConfig.enabledToolPacks),
    [workspaceConfig.enabledToolPacks],
  );

  const enabledSkillSet = useMemo(
    () => new Set(workspaceConfig.enabledSkills),
    [workspaceConfig.enabledSkills],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [
        groupsRes,
        packsRes,
        segmentsRes,
        skillsRes,
        templatesRes,
        configRes,
      ] = await Promise.all([
        client.getRegisteredTools().then((r: any) => (Array.isArray(r) ? (r as ToolGroup[]) : [])),
        workspaceId
          ? client.listToolPacks({ workspaceId }).then((r: any) => (Array.isArray(r) ? (r as ToolPack[]) : []))
          : Promise.resolve([] as ToolPack[]),
        client.getSystemPromptSegments().then((r: any) => {
          if (r && typeof r === 'object' && 'error' in r) return [] as SystemPromptSegment[];
          return (r?.segments ?? []) as SystemPromptSegment[];
        }),
        workspaceId
          ? client.listSkills({ workspaceId }).then((r: any) => (r?.skills ?? []) as SkillEntry[])
          : Promise.resolve([] as SkillEntry[]),
        client.listSkillTemplates().then((r: any) => (r?.templates ?? []) as SkillTemplate[]),
        workspaceId
          ? client.getWorkspaceConfig({ workspaceId }).then((r: any) => (r?.config ?? { enabledToolPacks: [], enabledSkills: [] }) as WorkspaceConfig)
          : Promise.resolve({ enabledToolPacks: [], enabledSkills: [] } as WorkspaceConfig),
      ]);
      setToolGroups(groupsRes);
      setPacks(packsRes);
      setSegments(segmentsRes);
      setSkills(skillsRes);
      setTemplates(templatesRes);
      setWorkspaceConfig(configRes);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const groupByServer = useMemo(() => {
    const map: Record<string, ToolGroup> = {};
    for (const g of toolGroups) map[g.server] = g;
    return map;
  }, [toolGroups]);

  const packByName = useMemo(() => {
    const map: Record<string, ToolPack> = {};
    for (const p of packs) map[p.name] = p;
    return map;
  }, [packs]);

  const templateByName = useMemo(() => {
    const map: Record<string, SkillTemplate> = {};
    for (const t of templates) map[t.name] = t;
    return map;
  }, [templates]);

  const skillByName = useMemo(() => {
    const map: Record<string, SkillEntry> = {};
    for (const s of skills) map[s.name] = s;
    return map;
  }, [skills]);

  const isSkillEnabled = (name: string): boolean => enabledSkillSet.has(name);




  const handleToggleSkill = async (name: string, enable: boolean) => {
    if (!workspaceId) return;
    setBusySkill(name);
    try {
      const current = new Set(workspaceConfig.enabledSkills);
      if (enable) {
        current.add(name);
      } else {
        current.delete(name);
      }
      const res = await client.updateWorkspaceConfig({
        workspaceId,
        config: { enabledSkills: Array.from(current) },
      });
      if (res && typeof res === 'object' && 'config' in res) {
        setWorkspaceConfig((res as any).config as WorkspaceConfig);
      }
      await reload();
    } finally {
      setBusySkill(null);
    }
  };

  const handleDomainToggle = async (
    skillNames: string[],
    packNames: string[],
    on: boolean,
  ) => {
    if (!workspaceId) return;
    setBusyBulk(true);
    try {
      const enabledSkills = new Set(workspaceConfig.enabledSkills);
      const enabledToolPacks = new Set(workspaceConfig.enabledToolPacks);
      if (on) {
        for (const n of skillNames) enabledSkills.add(n);
        for (const n of packNames) enabledToolPacks.add(n);
      } else {
        for (const n of skillNames) enabledSkills.delete(n);
        for (const n of packNames) enabledToolPacks.delete(n);
      }
      await client.updateWorkspaceConfig({
        workspaceId,
        config: {
          enabledSkills: Array.from(enabledSkills),
          enabledToolPacks: Array.from(enabledToolPacks),
        },
      });
      await reload();
    } finally {
      setBusyBulk(false);
    }
  };

  // ── 过滤各能力域数据 ──

  const memorySegments = useMemo(
    () => segments.filter((s) => s.category === 'memory'),
    [segments],
  );

  const memorySkills = useMemo(
    () =>
      MEMORY_SKILL_NAMES.map((n) => templateByName[n]).filter(
        (t): t is SkillTemplate => !!t,
      ),
    [templateByName],
  );

  const delegationSegments = useMemo(
    () => segments.filter((s) => DELEGATION_CATEGORIES.includes(s.category)),
    [segments],
  );

  const stockSkills = useMemo(() => {
    const result: { name: string; description?: string; source?: SkillSource; enabled: boolean }[] = [];
    for (const name of STOCK_SKILL_NAMES) {
      const tpl = templateByName[name];
      const wsSkill = skillByName[name];
      if (tpl || wsSkill) {
        result.push({
          name: tpl?.name ?? wsSkill!.name,
          description: tpl?.description ?? wsSkill?.description,
          source: wsSkill?.source ?? 'builtin',
          enabled: enabledSkillSet.has(name),
        });
      }
    }
    return result;
  }, [templateByName, skillByName, enabledSkillSet]);

  const articleTemplate = templateByName['article-parser'];

  const codeWorkflowTemplates = useMemo(
    () =>
      CODE_WORKFLOW_TEMPLATES.map((n) => templateByName[n]).filter(
        (t): t is SkillTemplate => !!t,
      ),
    [templateByName],
  );

  const customSkills = useMemo(
    () => {
      const knownNames = new Set<string>([
        ...templates.map((t) => t.name),
        ...MEMORY_SKILL_NAMES,
        ...STOCK_SKILL_NAMES,
      ]);
      return skills.filter((s) => !knownNames.has(s.name));
    },
    [skills, templates],
  );

  // pack 列表筛选
  const stockPacks = useMemo(
    () => STOCK_PACK_NAMES.map((n) => packByName[n]).filter((p): p is ToolPack => !!p),
    [packByName],
  );
  const articlePacks = useMemo(
    () => ARTICLE_PACK_NAMES.map((n) => packByName[n]).filter((p): p is ToolPack => !!p),
    [packByName],
  );

  const stockDomainOn = useMemo(() => {
    const packsOn = STOCK_PACK_NAMES.every((n) => enabledPackSet.has(n));
    const skillsOn = STOCK_SKILL_NAMES.every((name) => enabledSkillSet.has(name));
    return packsOn && skillsOn;
  }, [enabledPackSet, enabledSkillSet]);

  const codeDomainOn = useMemo(() => {
    const existing = CODE_WORKFLOW_TEMPLATES.filter((name) => enabledSkillSet.has(name));
    if (existing.length === 0) return false;
    return existing.length === CODE_WORKFLOW_TEMPLATES.length;
  }, [enabledSkillSet]);

  const articleDomainOn = useMemo(() => {
    const skillOn = ARTICLE_SKILL_NAMES.every((name) => enabledSkillSet.has(name));
    const packsOn = ARTICLE_PACK_NAMES.every((n) => enabledPackSet.has(n));
    return skillOn && packsOn;
  }, [enabledSkillSet, enabledPackSet]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="text-sm text-muted-foreground">加载中...</div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-6 px-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">能力</h2>
        <p className="text-sm text-muted-foreground">
          按能力域总览 Agent 可用的提示词段、Skill 与工具组。提示词段根据会话上下文自动注入；Skill 与工具包修改后需重启会话生效。
        </p>
      </div>

      {/* ── 1. 记忆系统 ── */}
      <AbilityCard
        title="记忆系统"
        badge={{ variant: 'resident' }}
        leftContent={
          <div className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                提示词段
              </p>
              <SegmentList
                segments={memorySegments}
                emptyHint="当前无注入的记忆引导段。"
                onSegmentClick={setDetailSegment}
              />
            </div>
            {memorySkills.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Skill
                </p>
                {memorySkills.map((tpl) => (
                  <SkillRow
                    key={tpl.name}
                    name={tpl.name}
                    description={tpl.description}
                    source={skillByName[tpl.name]?.source ?? 'builtin'}
                    enabled={isSkillEnabled(tpl.name)}
                    busy={busySkill === tpl.name}
                    onDetail={setDetailName}
                    onToggle={handleToggleSkill}
                  />
                ))}
              </div>
            )}
          </div>
        }
        rightContent={
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              工具组
            </p>
            <ToolGroupList
              servers={MEMORY_SERVERS}
              groupByServer={groupByServer}
              onToolClick={setDetailTool}
            />
          </div>
        }
      />

      {/* ── 2. Agent 协作 ── */}
      <AbilityCard
        title="Agent 协作"
        badge={{ variant: 'conditional' }}
        leftContent={
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              提示词段
            </p>
            <SegmentList
              segments={delegationSegments}
              emptyHint="当前无注入的协作提示词段。"
              onSegmentClick={setDetailSegment}
            />
          </div>
        }
        rightContent={
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              工具组
            </p>
            <ToolGroupList
              servers={DELEGATION_SERVERS}
              groupByServer={groupByServer}
              onToolClick={setDetailTool}
            />
          </div>
        }
      />

      {/* ── 3. 股票分析 ── */}
      <AbilityCard
        title="股票分析"
        badge={{ variant: 'optional' }}
        actions={
          <DomainToggle
            allOn={stockDomainOn}
            busy={busyBulk}
            onToggle={() =>
              handleDomainToggle(STOCK_SKILL_NAMES, STOCK_PACK_NAMES, !stockDomainOn)
            }
          />
        }
        leftContent={
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Skill
            </p>
            {stockSkills.length === 0 ? (
              <p className="text-xs text-muted-foreground">未发现股票相关 Skill。</p>
            ) : (
              stockSkills.map((sk) => (
                <SkillRow
                  key={sk.name}
                  name={sk.name}
                  description={sk.description}
                  source={sk.source}
                  enabled={sk.enabled}
                  busy={busySkill === sk.name || busyBulk}
                  onDetail={setDetailName}
                  onToggle={handleToggleSkill}
                />
              ))
            )}
          </div>
        }
        rightContent={
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              工具包
            </p>
            {stockPacks.length === 0 ? (
              <p className="text-xs text-muted-foreground">暂无股票工具包。</p>
            ) : (
              <PackGroupList
                packs={stockPacks}
                groupByServer={groupByServer}
                onToolClick={setDetailTool}
                active={stockDomainOn}
              />
            )}
          </div>
        }
      />

      {/* ── 4. 代码工作流 ── */}
      <AbilityCard
        title="代码工作流"
        badge={{ variant: 'optional' }}
        actions={
          <DomainToggle
            allOn={codeDomainOn}
            busy={busyBulk}
            onToggle={() =>
              handleDomainToggle(CODE_WORKFLOW_TEMPLATES, [], !codeDomainOn)
            }
          />
        }
        leftContent={
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Skill
            </p>
            {codeWorkflowTemplates.length === 0 ? (
              <p className="text-xs text-muted-foreground">未发现代码工作流模板。</p>
            ) : (
              codeWorkflowTemplates.map((tpl) => (
                <SkillRow
                  key={tpl.name}
                  name={tpl.name}
                  description={tpl.description}
                  source={skillByName[tpl.name]?.source ?? 'builtin'}
                  enabled={isSkillEnabled(tpl.name)}
                  busy={busySkill === tpl.name || busyBulk}
                  onDetail={setDetailName}
                  onToggle={handleToggleSkill}
                />
              ))
            )}
          </div>
        }
        rightContent={
          <p className="text-xs text-muted-foreground leading-relaxed p-2">
            这些 Skill 复用基础工具（Read / Edit / Bash / Grep / Glob），不额外注册工具组。
            开关即控制所有 Skill 的注入。
          </p>
        }
      />

      {/* ── 5. 文章 ── */}
      <AbilityCard
        title="文章"
        badge={{ variant: 'optional' }}
        actions={
          <DomainToggle
            allOn={articleDomainOn}
            busy={busyBulk}
            onToggle={() =>
              handleDomainToggle(ARTICLE_SKILL_NAMES, ARTICLE_PACK_NAMES, !articleDomainOn)
            }
          />
        }
        leftContent={
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Skill
            </p>
            {articleTemplate ? (
              <SkillRow
                name={articleTemplate.name}
                description={articleTemplate.description}
                source={skillByName[articleTemplate.name]?.source ?? 'builtin'}
                enabled={isSkillEnabled(articleTemplate.name)}
                busy={busySkill === articleTemplate.name}
                onDetail={setDetailName}
                onToggle={handleToggleSkill}
              />
            ) : (
              <p className="text-xs text-muted-foreground">未发现 article-parser 模板。</p>
            )}
          </div>
        }
        rightContent={
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              工具包
            </p>
            <PackGroupList
              packs={articlePacks}
              groupByServer={groupByServer}
              onToolClick={setDetailTool}
              active={articleDomainOn}
            />
          </div>
        }
      />

      {/* ── 6. 自定义 Skill ── */}
      {customSkills.length > 0 && (
        <AbilityCard
          title="自定义 Skill"
          leftContent={
            <div className="space-y-1.5">
              {customSkills.map((skill) => (
                <SkillRow
                  key={skill.dir}
                  name={skill.name}
                  description={skill.description}
                  source={skill.source}
                  enabled={skill.enabled}
                  busy={busySkill === skill.name}
                  onDetail={setDetailName}
                  onToggle={handleToggleSkill}
                />
              ))}
            </div>
          }
          rightContent={
            <p className="text-xs text-muted-foreground leading-relaxed p-2">
              工作区或用户目录下自建的 Skill。开关即控制是否挂载到会话。
            </p>
          }
        />
      )}

      <SkillDetailDialog name={detailName} onClose={() => setDetailName(null)} />
      <ToolDetailDialog tool={detailTool} onClose={() => setDetailTool(null)} />
      <SegmentDetailDialog segment={detailSegment} onClose={() => setDetailSegment(null)} />
    </div>
  );
}
