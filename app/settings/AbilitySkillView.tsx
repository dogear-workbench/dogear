import { useMemo } from 'react';
import { Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import type { SystemPromptSegment } from '@/types/system-prompt';
import type { SkillEntry, SkillTemplate, ToolGroup, ToolPack } from './ability-types';
import { SKILL_PACK_MAP, SKILL_SOURCE_LABELS } from './ability-types';

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

interface PackBadge {
  server: string;
  label: string;
  count: number;
  enabled: boolean;
}

interface SkillRowProps {
  name: string;
  description?: string;
  badge?: string;
  enabled: boolean;
  disabled?: boolean;
  busy: boolean;
  packBadges?: PackBadge[];
  onDetail: (name: string) => void;
  onToggle: (name: string, enabled: boolean) => void;
  onJumpToGroup: (server: string) => void;
}

function SkillRow({
  name,
  description,
  badge,
  enabled,
  disabled = false,
  busy,
  packBadges,
  onDetail,
  onToggle,
  onJumpToGroup,
}: SkillRowProps) {
  return (
    <div className="p-2 rounded-md border bg-background">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs font-semibold font-mono">{name}</span>
        {badge && (
          <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
            {badge}
          </span>
        )}
        <span
          className={cn(
            'text-[10px] px-1 py-0.5 rounded',
            enabled
              ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400'
              : 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400',
          )}
        >
          {enabled ? '已挂载' : '未挂载'}
        </span>
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
          <Switch
            checked={enabled}
            disabled={busy || disabled}
            onCheckedChange={(v) => onToggle(name, v)}
            aria-label={`${enabled ? '取消挂载' : '挂载'} ${name}`}
          />
        </div>
      </div>
      {packBadges && packBadges.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap mt-1">
          {packBadges.map((b) => (
            <button
              key={b.server}
              type="button"
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded font-medium transition-opacity hover:opacity-75',
                b.enabled
                  ? 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-400'
                  : 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400',
              )}
              onClick={() => onJumpToGroup(b.server)}
              title={`跳转到工具组 ${b.server}${b.enabled ? '' : '（该包未启用）'}`}
            >
              {b.label} ×{b.count}
            </button>
          ))}
        </div>
      )}
      {description && (
        <p className="text-xs text-muted-foreground leading-relaxed mt-1">
          {description}
        </p>
      )}
    </div>
  );
}

interface AbilitySkillViewProps {
  segments: SystemPromptSegment[];
  templates: SkillTemplate[];
  skills: SkillEntry[];
  enabledSkills: Set<string>;
  packs: ToolPack[];
  groupByServer: Record<string, ToolGroup>;
  workspaceId: string | null;
  busySkill: string | null;
  onSegmentClick: (segment: SystemPromptSegment) => void;
  onSkillDetail: (name: string) => void;
  onToggleSkill: (name: string, enabled: boolean) => void;
  onJumpToGroup: (server: string) => void;
}

export function AbilitySkillView({
  segments,
  templates,
  skills,
  enabledSkills,
  packs,
  groupByServer,
  workspaceId,
  busySkill,
  onSegmentClick,
  onSkillDetail,
  onToggleSkill,
  onJumpToGroup,
}: AbilitySkillViewProps) {
  const packByName = useMemo(
    () => new Map(packs.map((p) => [p.name, p])),
    [packs],
  );

  const templateNames = useMemo(
    () => new Set(templates.map((t) => t.name)),
    [templates],
  );

  const customSkills = useMemo(
    () => skills.filter((s) => s.source !== 'builtin' && !templateNames.has(s.name)),
    [skills, templateNames],
  );

  const buildPackBadges = (skillName: string): PackBadge[] => {
    const names = SKILL_PACK_MAP[skillName];
    if (!names) return [];
    const badges: PackBadge[] = [];
    for (const n of names) {
      const p = packByName.get(n);
      if (!p) continue;
      const group = groupByServer[p.mcpServer];
      badges.push({
        server: p.mcpServer,
        label: p.label,
        count: group?.tools.length ?? p.toolCount,
        enabled: p.enabled,
      });
    }
    return badges;
  };

  const noWorkspace = workspaceId === null;

  return (
    <div className="space-y-6">
      <section className="space-y-1.5">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          内置 · 全局生效
        </p>
        <p className="text-xs text-muted-foreground/80">
          提示词段按会话上下文动态注入，只读。
        </p>
        <SegmentList
          segments={segments}
          emptyHint="当前未注册任何提示词段。"
          onSegmentClick={onSegmentClick}
        />
      </section>

      <section className="space-y-1.5">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          可选 Skill · 按工作区挂载
        </p>
        {noWorkspace ? (
          <p className="text-xs text-muted-foreground">请先在工作区管理创建工作区。</p>
        ) : templates.length === 0 ? (
          <p className="text-xs text-muted-foreground">未发现任何 Skill 模板。</p>
        ) : (
          <div className="space-y-1.5">
            {templates.map((tpl) => (
              <SkillRow
                key={tpl.name}
                name={tpl.name}
                description={tpl.description}
                badge="可选"
                enabled={enabledSkills.has(tpl.name)}
                busy={busySkill === tpl.name}
                packBadges={buildPackBadges(tpl.name)}
                onDetail={onSkillDetail}
                onToggle={onToggleSkill}
                onJumpToGroup={onJumpToGroup}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-1.5">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          自定义 Skill · 按工作区挂载
        </p>
        {noWorkspace ? (
          <p className="text-xs text-muted-foreground">请先在工作区管理创建工作区。</p>
        ) : customSkills.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            暂无自定义 Skill。放入 <code className="text-[10px] bg-muted px-1 py-0.5 rounded">.dogear/skills/&lt;名称&gt;/SKILL.md</code> 后在此显示。
          </p>
        ) : (
          <div className="space-y-1.5">
            {customSkills.map((skill) => (
              <SkillRow
                key={skill.dir}
                name={skill.name}
                description={skill.description}
                badge={SKILL_SOURCE_LABELS[skill.source]}
                enabled={enabledSkills.has(skill.name)}
                busy={busySkill === skill.name}
                onDetail={onSkillDetail}
                onToggle={onToggleSkill}
                onJumpToGroup={onJumpToGroup}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
