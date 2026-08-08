import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Download,
  RotateCcw,
  Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { showConfirm } from '@/stores/confirm-store';
import { AbilityCard } from './AbilityCard';
import { SkillDetailDialog } from './SkillDetailDialog';
import { ToolDetailDialog } from './ToolDetailDialog';
import { SegmentDetailDialog } from './SegmentDetailDialog';
import type { SystemPromptSegment } from '@/types/system-prompt';
import type { AppSettings } from '@/types/settings';

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
interface SkillEntry {
  source: 'workspace' | 'user' | 'plugin' | 'marketplace';
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
const ARTICLE_PACK_NAMES = ['article'];
const CODE_WORKFLOW_TEMPLATES = [
  'brainstorming',
  'codebase-map',
  'doc-sync',
  'staged-execution',
  'staged-impl',
  'systematic-debugging',
];

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

// ── 工具包开关子组件 ──────────────────────────────────

function PackToggle({
  pack,
  enabled,
  onToggle,
}: {
  pack: ToolPack;
  enabled: boolean;
  onToggle: (name: string) => void;
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-2 p-2 rounded-md border transition-colors',
        enabled ? 'bg-muted/30 border-foreground/20' : 'bg-background',
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-semibold">{pack.label}</span>
          <span className="text-[10px] text-muted-foreground font-mono">
            {pack.name}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
          {pack.description}
        </p>
      </div>
      <button
        type="button"
        className={cn(
          'relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 mt-0.5',
          enabled ? 'bg-primary' : 'bg-muted',
        )}
        onClick={() => onToggle(pack.name)}
        aria-label={`${enabled ? '禁用' : '启用'} ${pack.label}`}
      >
        <span
          className={cn(
            'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform',
            enabled ? 'translate-x-4' : 'translate-x-1',
          )}
        />
      </button>
    </div>
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
        <button
          key={seg.key}
          type="button"
          className="w-full flex items-center gap-1.5 flex-wrap rounded-md border border-border/60 bg-muted/20 p-2 text-left hover:bg-muted/40 transition-colors"
          onClick={() => onSegmentClick(seg)}
        >
          <span className="text-xs font-semibold">{seg.label}</span>
          {seg.isDynamic && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
              动态
            </span>
          )}
          {seg.triggerDescription && (
            <span className="text-[11px] text-muted-foreground/80 leading-relaxed">
              {seg.triggerDescription}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Skill 行子组件 ────────────────────────────────────

interface SkillRowProps {
  name: string;
  description?: string;
  subscribed: boolean;
  enabled?: boolean;
  showEnableToggle?: boolean;
  showSubscribe?: boolean;
  busy: boolean;
  onDetail: (name: string) => void;
  onSubscribe: (name: string, isResync: boolean) => void;
  onToggleEnabled?: (dir: string) => void;
  dir?: string;
}

function SkillRow({
  name,
  description,
  subscribed,
  enabled,
  showEnableToggle,
  showSubscribe = true,
  busy,
  onDetail,
  onSubscribe,
  onToggleEnabled,
  dir,
}: SkillRowProps) {
  return (
    <div className="flex items-start justify-between gap-2 p-2 rounded-md border bg-background">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-semibold font-mono">{name}</span>
          {subscribed && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400">
              已订阅
            </span>
          )}
          {showEnableToggle && !enabled && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400">
              已禁用
            </span>
          )}
        </div>
        {description && (
          <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
            {description}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          className="flex items-center gap-1 px-1.5 h-6 rounded text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          onClick={() => onDetail(name)}
          title="查看 SKILL.md 全文"
        >
          <Eye className="w-3 h-3" />
          详情
        </button>
        {showSubscribe && (
          <button
            type="button"
            disabled={busy}
            className={cn(
              'flex items-center gap-1 px-1.5 h-6 rounded border text-[11px] hover:bg-muted/50 transition-colors',
              busy && 'opacity-50 cursor-not-allowed',
            )}
            onClick={() => onSubscribe(name, subscribed)}
            title={subscribed ? '重新同步（覆盖本地修改）' : '订阅到工作区'}
          >
            {subscribed ? (
              <>
                <RotateCcw className="w-3 h-3" />
                恢复
              </>
            ) : (
              <>
                <Download className="w-3 h-3" />
                订阅
              </>
            )}
          </button>
        )}
        {showEnableToggle && dir && onToggleEnabled && (
          <button
            type="button"
            disabled={busy}
            className={cn(
              'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
              enabled ? 'bg-primary' : 'bg-muted',
              busy && 'opacity-50 cursor-not-allowed',
            )}
            onClick={() => onToggleEnabled(dir)}
            aria-label={`${enabled ? '禁用' : '启用'} ${name}`}
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
  );
}

// ── 主组件 ────────────────────────────────────────────

interface AbilityTabProps {
  local: AppSettings;
  setLocal: React.Dispatch<React.SetStateAction<AppSettings>>;
}

export function AbilityTab({ local, setLocal }: AbilityTabProps) {
  const workspaceId = useWorkspaceStore((s) => s.workspace?.id ?? null);
  const workspacePath = useWorkspaceStore((s) => s.workspace?.path);

  const [toolGroups, setToolGroups] = useState<ToolGroup[]>([]);
  const [packs, setPacks] = useState<ToolPack[]>([]);
  const [segments, setSegments] = useState<SystemPromptSegment[]>([]);
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [templates, setTemplates] = useState<SkillTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailName, setDetailName] = useState<string | null>(null);
  const [detailTool, setDetailTool] = useState<{ name: string; description: string } | null>(null);
  const [detailSegment, setDetailSegment] = useState<SystemPromptSegment | null>(null);
  const [busyTemplate, setBusyTemplate] = useState<string | null>(null);
  const [busyDir, setBusyDir] = useState<string | null>(null);

  const enabledPackSet = useMemo(
    () => new Set(local.enabledToolPacks ?? []),
    [local.enabledToolPacks],
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
      ] = await Promise.all([
        client.getRegisteredTools().then((r: any) => (Array.isArray(r) ? (r as ToolGroup[]) : [])),
        client.listToolPacks().then((r: any) => (Array.isArray(r) ? (r as ToolPack[]) : [])),
        client.getSystemPromptSegments().then((r: any) => {
          if (r && typeof r === 'object' && 'error' in r) return [] as SystemPromptSegment[];
          return (r?.segments ?? []) as SystemPromptSegment[];
        }),
        client.listSkills({ workspaceId }).then((r: any) => (r?.skills ?? []) as SkillEntry[]),
        client.listSkillTemplates().then((r: any) => (r?.templates ?? []) as SkillTemplate[]),
      ]);
      setToolGroups(groupsRes);
      setPacks(packsRes);
      setSegments(segmentsRes);
      setSkills(skillsRes);
      setTemplates(templatesRes);
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

  const subscribedSkillNames = useMemo(
    () => new Set(skills.filter((s) => s.source === 'workspace').map((s) => s.name)),
    [skills],
  );

  const allTemplateNames = useMemo(
    () => new Set(templates.map((t) => t.name)),
    [templates],
  );

  const isPackEnabled = (name: string): boolean => enabledPackSet.has(name);

  const togglePack = (name: string) => {
    const current = new Set(local.enabledToolPacks ?? []);
    if (current.has(name)) current.delete(name);
    else current.add(name);
    setLocal((prev) => ({ ...prev, enabledToolPacks: Array.from(current) }));
  };

  const handleSubscribe = async (name: string, isResync: boolean) => {
    if (!workspacePath) return;
    if (isResync) {
      const ok = await showConfirm(
        '重新同步模板',
        `「恢复」会覆盖你对 ${name} 的本地修改，确定继续吗？`,
      );
      if (!ok) return;
    }
    setBusyTemplate(name);
    try {
      const result = (await client.subscribeSkillTemplate({
        workspacePath,
        name,
        overwrite: isResync,
      })) as { success?: boolean; error?: string };
      if (result.error === 'SKILL_EXISTS') {
        const ok = await showConfirm('Skill 已存在', `${name} 已存在，是否覆盖？`);
        if (!ok) return;
        await client.subscribeSkillTemplate({
          workspacePath,
          name,
          overwrite: true,
        });
      } else if (result.error) {
        console.error('订阅失败:', result.error);
        return;
      }
      await reload();
    } finally {
      setBusyTemplate(null);
    }
  };

  const handleToggleSkillEnabled = async (dir: string, currentEnabled: boolean) => {
    setBusyDir(dir);
    try {
      const result = (await client.setSkillEnabled({
        dir,
        enabled: !currentEnabled,
        workspaceId,
      })) as { success?: boolean; error?: string };
      if (result.error) {
        console.error('setSkillEnabled 失败:', result.error);
      } else {
        await reload();
      }
    } finally {
      setBusyDir(null);
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

  const stockTemplate = templateByName['stock-analysis'];
  const articleTemplate = templateByName['article-parser'];

  const codeWorkflowTemplates = useMemo(
    () =>
      CODE_WORKFLOW_TEMPLATES.map((n) => templateByName[n]).filter(
        (t): t is SkillTemplate => !!t,
      ),
    [templateByName],
  );

  const customSkills = useMemo(
    () =>
      skills.filter(
        (s) =>
          (s.source === 'workspace' || s.source === 'user') &&
          !allTemplateNames.has(s.name) &&
          !MEMORY_SKILL_NAMES.includes(s.name),
      ),
    [skills, allTemplateNames],
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="text-sm text-muted-foreground">加载中...</div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl py-6 px-6 space-y-6">
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
                {memorySkills.map((tpl) => {
                  const subscribed = subscribedSkillNames.has(tpl.name);
                  const skillEntry = skills.find(
                    (s) => s.name === tpl.name && s.source === 'workspace',
                  );
                  return (
                    <SkillRow
                      key={tpl.name}
                      name={tpl.name}
                      description={tpl.description}
                      subscribed={subscribed}
                      enabled={skillEntry?.enabled ?? false}
                      showEnableToggle={subscribed}
                      dir={skillEntry?.dir}
                      busy={busyTemplate === tpl.name || busyDir === skillEntry?.dir}
                      onDetail={setDetailName}
                      onSubscribe={handleSubscribe}
                      onToggleEnabled={(d) =>
                        skillEntry &&
                        handleToggleSkillEnabled(d, skillEntry.enabled)
                      }
                    />
                  );
                })}
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
        leftContent={
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Skill
            </p>
            {stockTemplate ? (
              <SkillRow
                name={stockTemplate.name}
                description={stockTemplate.description}
                subscribed={subscribedSkillNames.has(stockTemplate.name)}
                busy={busyTemplate === stockTemplate.name}
                onDetail={setDetailName}
                onSubscribe={handleSubscribe}
              />
            ) : (
              <p className="text-xs text-muted-foreground">未发现 stock-analysis 模板。</p>
            )}
          </div>
        }
        rightContent={
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              工具包（开启即整组放行）
            </p>
            {stockPacks.length === 0 ? (
              <p className="text-xs text-muted-foreground">暂无股票工具包。</p>
            ) : (
              stockPacks.map((p) => (
                <PackToggle
                  key={p.name}
                  pack={p}
                  enabled={isPackEnabled(p.name)}
                  onToggle={togglePack}
                />
              ))
            )}
            <ToolGroupList
              servers={STOCK_PACK_NAMES.map((n) => packByName[n]?.mcpServer).filter(
                (s): s is string => !!s,
              )}
              groupByServer={groupByServer}
              onToolClick={setDetailTool}
            />
          </div>
        }
      />

      {/* ── 4. 代码工作流 ── */}
      <AbilityCard
        title="代码工作流"
        badge={{ variant: 'optional' }}
        leftContent={
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Skill（各复用基础工具）
            </p>
            {codeWorkflowTemplates.length === 0 ? (
              <p className="text-xs text-muted-foreground">未发现代码工作流模板。</p>
            ) : (
              <div className="space-y-1.5">
                {codeWorkflowTemplates.map((tpl) => {
                  const subscribed = subscribedSkillNames.has(tpl.name);
                  const skillEntry = skills.find(
                    (s) => s.name === tpl.name && s.source === 'workspace',
                  );
                  return (
                    <SkillRow
                      key={tpl.name}
                      name={tpl.name}
                      description={tpl.description}
                      subscribed={subscribed}
                      enabled={skillEntry?.enabled ?? false}
                      showEnableToggle={subscribed}
                      dir={skillEntry?.dir}
                      busy={busyTemplate === tpl.name || busyDir === skillEntry?.dir}
                      onDetail={setDetailName}
                      onSubscribe={handleSubscribe}
                      onToggleEnabled={(d) =>
                        skillEntry &&
                        handleToggleSkillEnabled(d, skillEntry.enabled)
                      }
                    />
                  );
                })}
              </div>
            )}
          </div>
        }
        rightContent={
          <p className="text-xs text-muted-foreground leading-relaxed p-2">
            这些 Skill 复用基础工具（Read / Edit / Bash / Grep / Glob），不额外注册工具组。
            开关这些 Skill 等于开关对应的 SKILL.md 注入。
          </p>
        }
      />

      {/* ── 5. 文章 ── */}
      <AbilityCard
        title="文章"
        badge={{ variant: 'optional' }}
        leftContent={
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Skill
            </p>
            {articleTemplate ? (
              <SkillRow
                name={articleTemplate.name}
                description={articleTemplate.description}
                subscribed={subscribedSkillNames.has(articleTemplate.name)}
                busy={busyTemplate === articleTemplate.name}
                onDetail={setDetailName}
                onSubscribe={handleSubscribe}
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
            {articlePacks.map((p) => (
              <PackToggle
                key={p.name}
                pack={p}
                enabled={isPackEnabled(p.name)}
                onToggle={togglePack}
              />
            ))}
            <ToolGroupList
              servers={ARTICLE_PACK_NAMES.map((n) => packByName[n]?.mcpServer).filter(
                (s): s is string => !!s,
              )}
              groupByServer={groupByServer}
              onToolClick={setDetailTool}
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
                  subscribed={false}
                  enabled={skill.enabled}
                  showEnableToggle
                  showSubscribe={false}
                  dir={skill.dir}
                  busy={busyDir === skill.dir}
                  onDetail={setDetailName}
                  onSubscribe={() => {}}
                  onToggleEnabled={(d) => handleToggleSkillEnabled(d, skill.enabled)}
                />
              ))}
            </div>
          }
          rightContent={
            <p className="text-xs text-muted-foreground leading-relaxed p-2">
              工作区或用户目录下自建的 Skill（不在模板列表中）。开关即重命名 SKILL.md ↔ SKILL.md.disabled。
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
