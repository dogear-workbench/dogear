import { memo, useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { client } from '@/lib/client';
import type { WorkspaceConfig } from '@/types/electron-api';
import type { AbilityPackView, AbilitySegmentMeta, AbilitySkillMeta } from '../../../electron/main/tipc/ability';
import { AbilityPackSidebar } from './AbilityPackSidebar';
import { ToolDetailDialog } from '../ToolDetailDialog';

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

const PROSE_DOWN_CLASS = '[&.prose-sm]:text-xs [&_pre]:text-xs [&_th]:text-xs [&_td]:text-xs';

function useSkillContent(name: string) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    client
      .getSkillContent({ name })
      .then((res) => {
        if (cancelled) return;
        if ('error' in res) {
          setError(String(res.error));
          setContent(null);
        } else {
          setContent((res.content ?? '').replace(FRONTMATTER_RE, ''));
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  return { content, error, loading };
}

const SegmentBlock = memo(function SegmentBlock({ segment }: { segment: AbilitySegmentMeta }) {
  return (
    <div className="rounded-md border overflow-hidden flex flex-col">
      <div className="px-3 py-2 bg-muted/30 border-b space-y-0.5 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">{segment.label}</span>
          <span className="text-xs px-1 py-0.5 rounded bg-muted text-muted-foreground">跟随代码版本，只读</span>
        </div>
        {segment.triggerDescription && (
          <p className="text-xs text-muted-foreground leading-relaxed">{segment.triggerDescription}</p>
        )}
      </div>
      <div className="px-3 py-2">
        {segment.template.trim() ? (
          <MarkdownRenderer content={segment.template} className={PROSE_DOWN_CLASS} />
        ) : (
          <p className="text-xs text-muted-foreground py-2">（模板为空）</p>
        )}
      </div>
    </div>
  );
});

// 正文自包含成 memo 组件：头部开关状态变化重渲染时不重拉、不重解析 SKILL.md
const SkillMarkdown = memo(function SkillMarkdown({ name }: { name: string }) {
  const { content, error, loading } = useSkillContent(name);

  return (
    <div className="px-3 py-2">
      {loading && <p className="text-sm text-muted-foreground py-8 text-center">加载中…</p>}
      {!loading && error && (
        <div className="p-3 rounded border border-destructive/40 bg-destructive/5 text-xs text-destructive font-mono whitespace-pre-wrap break-all">
          {error}
        </div>
      )}
      {!loading && !error && (
        <MarkdownRenderer
          content={content || '(空文件)'}
          className={cn(PROSE_DOWN_CLASS, '[&_h1]:text-lg [&_h1]:mt-3 [&_h1]:mb-2')}
        />
      )}
    </div>
  );
});

function SkillContentSection({
  skill,
  enabled,
  packEnabled,
  disabled,
  onToggle,
}: {
  skill: AbilitySkillMeta;
  enabled: boolean;
  packEnabled: boolean;
  disabled: boolean;
  onToggle: (enable: boolean) => void;
}) {
  return (
    <div className="rounded-md border overflow-hidden flex flex-col">
      <div className="px-3 py-2 bg-muted/30 border-b space-y-1 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold truncate">{skill.title ?? skill.name}</span>
          {!skill.description && (
            <span className="text-xs px-1 py-0.5 rounded bg-muted text-muted-foreground shrink-0">文件缺失</span>
          )}
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground">{enabled ? '已启用' : '已停用'}</span>
            <Switch
              checked={enabled}
              disabled={disabled || !packEnabled}
              onCheckedChange={onToggle}
              aria-label={`${enabled ? '停用' : '启用'} ${skill.name}`}
            />
          </div>
        </div>
        {skill.description && (
          <p className="text-xs text-muted-foreground leading-relaxed">{skill.description}</p>
        )}
        {!packEnabled && (
          <p className="text-xs text-muted-foreground/70">包开关关闭时包内 Skill 不生效，可先行预配置。</p>
        )}
      </div>
      <SkillMarkdown name={skill.name} />
    </div>
  );
}

interface AbilityPackDetailPageProps {
  pack: AbilityPackView;
  workspaceId: string | null;
  config: WorkspaceConfig;
  packEnabled: boolean;
  refreshKey: number;
  onBack: () => void;
  onTogglePack: (enable: boolean) => void;
  onToggleSkill: (name: string, enable: boolean) => void;
}

export function AbilityPackDetailPage({
  pack,
  workspaceId,
  config,
  packEnabled,
  refreshKey,
  onBack,
  onTogglePack,
  onToggleSkill,
}: AbilityPackDetailPageProps) {
  const [detailTool, setDetailTool] = useState<{ name: string; description: string } | null>(null);
  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(null);

  const isSkillPack = pack.skillMetas.length > 0;
  const activeSkill = isSkillPack
    ? pack.skillMetas.find((s) => s.name === selectedSkillName) ?? pack.skillMetas[0]
    : null;
  const isSkillEnabled = (name: string) => config.enabledSkills.includes(name);

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 border-b px-4 py-2 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1" />
          返回
        </Button>
        <span className="text-sm font-semibold">{pack.label}</span>
      </div>

      {isSkillPack && activeSkill && (
        <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2 shrink-0">
          {pack.skillMetas.map((skill) => {
            const active = skill.name === activeSkill.name;
            return (
              <button
                key={skill.name}
                type="button"
                aria-pressed={active}
                onClick={() => setSelectedSkillName(skill.name)}
                className={cn(
                  'inline-flex items-center rounded-full border px-3 py-1 text-xs transition-colors',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground',
                  !active && !skill.title && 'text-muted-foreground/70',
                )}
              >
                {skill.title ?? skill.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        <div className="flex-[5] min-w-0 p-4 overflow-y-auto">
          <div className="space-y-3">
            {isSkillPack && activeSkill && (
              <SkillContentSection
                skill={activeSkill}
                enabled={isSkillEnabled(activeSkill.name)}
                packEnabled={packEnabled}
                disabled={!workspaceId}
                onToggle={(enable) => onToggleSkill(activeSkill.name, enable)}
              />
            )}

            {!isSkillPack && pack.segments.length > 0 && (
              <div className="space-y-2">
                <span className="text-xs text-muted-foreground">
                  提示词段（{pack.segments.length} 段，注入内容与工具配套，只读跟随代码版本）
                </span>
                {pack.segments.map((segment) => (
                  <SegmentBlock key={segment.key} segment={segment} />
                ))}
              </div>
            )}

            {!isSkillPack && pack.segments.length === 0 && (
              <div className="rounded-md border bg-muted/10 px-3 py-2">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  此包不注入提示词段，能力由工具包组成；会话启动时按包开关拼装。
                </p>
              </div>
            )}
          </div>
        </div>

        <AbilityPackSidebar
          pack={pack}
          workspaceId={workspaceId}
          packEnabled={packEnabled}
          disabled={!workspaceId}
          onTogglePack={onTogglePack}
          onToolDetail={setDetailTool}
          refreshKey={refreshKey}
        />
      </div>

      <ToolDetailDialog tool={detailTool} onClose={() => setDetailTool(null)} />
    </div>
  );
}
