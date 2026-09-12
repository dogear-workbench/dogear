import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, Database } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { client } from '@/lib/client';
import { useUIStore } from '@/stores/ui-store';
import { useSessionStore } from '@/stores/session-store';
import type { Workspace, WorkspaceConfig } from '@/types/electron-api';
import type { AbilityPackView, AbilitySegmentMeta, AbilitySkillMeta } from '../../../electron/main/tipc/ability';
import { AbilityPackSidebar } from './AbilityPackSidebar';
import { ToolDetailDialog } from '../ToolDetailDialog';
import { packIconOf } from './pack-meta';

const AGENT_COLLAB_OFF_NOTE =
  '关闭后主会话不再注册派遣工具（无法创建子会话，已派出的子会话不受影响），会话组上下文裁剪为纯组头，共享区与跨会话引用工具一并移除。';

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

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

function jumpToDataCenter() {
  useSessionStore.getState().openDataCenterTab();
  useUIStore.getState().closeSettings();
}

function SegmentBlock({ segment }: { segment: AbilitySegmentMeta }) {
  return (
    <div className="rounded-md border overflow-hidden flex flex-col min-h-0">
      <div className="px-3 py-2 bg-muted/30 border-b space-y-0.5 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">{segment.label}</span>
          <span className="text-xs px-1 py-0.5 rounded bg-muted text-muted-foreground">跟随代码版本，只读</span>
        </div>
        {segment.triggerDescription && (
          <p className="text-xs text-muted-foreground leading-relaxed">{segment.triggerDescription}</p>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-3 py-2 text-sm">
        {segment.template.trim() ? (
          <MarkdownRenderer content={segment.template} />
        ) : (
          <p className="text-xs text-muted-foreground py-2">（模板为空）</p>
        )}
      </div>
    </div>
  );
}

function CoreProfileView({ workspacePath }: { workspacePath: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.getCoreProfile({ workspacePath });
      setContent('error' in res ? null : res.profile?.content ?? '');
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="text-xs text-muted-foreground">核心画像加载中…</p>;
  if (content === null) return <p className="text-xs text-muted-foreground">核心画像读取失败</p>;

  return (
    <div className="rounded-md border overflow-hidden flex flex-col min-h-0 flex-1">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b shrink-0">
        <span className="text-xs font-semibold flex-1">核心画像全文（数据中心维护）</span>
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={jumpToDataCenter}
        >
          <Database className="w-3 h-3 mr-1" />
          到数据中心编辑
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-3 py-2">
        {content.trim() ? (
          <MarkdownRenderer content={content} />
        ) : (
          <p className="text-xs text-muted-foreground py-2">核心画像为空，到数据中心填写后此处展示全文。</p>
        )}
      </div>
    </div>
  );
}

function SkillContentSection({
  skill,
  enabled,
  packEnabled,
  disabled,
  skillBusy,
  onToggle,
}: {
  skill: AbilitySkillMeta;
  enabled: boolean;
  packEnabled: boolean;
  disabled: boolean;
  skillBusy: boolean;
  onToggle: (enable: boolean) => void;
}) {
  const { content, error, loading } = useSkillContent(skill.name);

  return (
    <div className="flex-1 min-h-0 rounded-md border overflow-hidden flex flex-col">
      <div className="px-3 py-2 bg-muted/30 border-b space-y-1 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono font-semibold truncate">{skill.name}</span>
          {!skill.description && (
            <span className="text-xs px-1 py-0.5 rounded bg-muted text-muted-foreground shrink-0">文件缺失</span>
          )}
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground">{enabled ? '已启用' : '已停用'}</span>
            <Switch
              checked={enabled}
              disabled={disabled || skillBusy || !packEnabled}
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
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 text-sm">
        {loading && <p className="text-sm text-muted-foreground py-8 text-center">加载中…</p>}
        {!loading && error && (
          <div className="p-3 rounded border border-destructive/40 bg-destructive/5 text-xs text-destructive font-mono whitespace-pre-wrap break-all">
            {error}
          </div>
        )}
        {!loading && !error && (
          <MarkdownRenderer
            content={content || '(空文件)'}
            className="[&_h1]:text-xl [&_h1]:mt-3 [&_h1]:mb-2"
          />
        )}
      </div>
    </div>
  );
}

interface AbilityPackDetailPageProps {
  pack: AbilityPackView;
  workspace: Workspace | null;
  workspaceId: string | null;
  config: WorkspaceConfig;
  packEnabled: boolean;
  packBusy: boolean;
  skillBusy: boolean;
  configVersion: number;
  onBack: () => void;
  onTogglePack: (enable: boolean) => void;
  onToggleSkill: (name: string, enable: boolean) => void;
}

export function AbilityPackDetailPage({
  pack,
  workspace,
  workspaceId,
  config,
  packEnabled,
  packBusy,
  skillBusy,
  configVersion,
  onBack,
  onTogglePack,
  onToggleSkill,
}: AbilityPackDetailPageProps) {
  const [detailTool, setDetailTool] = useState<{ name: string; description: string } | null>(null);
  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(null);
  const Icon = packIconOf(pack.key);
  const workspacePath = workspace?.path ?? null;

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
        <span className="text-sm text-muted-foreground">能力</span>
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">{pack.label}</span>
        {workspace && (
          <>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{workspace.name}</span>
          </>
        )}
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 min-w-0 flex flex-col gap-4 p-4 overflow-y-auto">
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-muted/60 p-2 shrink-0">
              <Icon className="w-5 h-5 text-foreground/80" />
            </div>
            <div className="space-y-1 min-w-0">
              <h3 className="text-base font-semibold">{pack.label}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{pack.description}</p>
              {pack.key === 'agent-collab' && (
                <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">{AGENT_COLLAB_OFF_NOTE}</p>
              )}
            </div>
          </div>

          {isSkillPack && activeSkill && (
            <>
              <div className="flex flex-wrap gap-1.5 shrink-0">
                {pack.skillMetas.map((skill) => {
                  const active = skill.name === activeSkill.name;
                  return (
                    <button
                      key={skill.name}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSelectedSkillName(skill.name)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-mono transition-colors',
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground',
                      )}
                    >
                      {skill.name}
                      {!skill.description && (
                        <span
                          className={cn(
                            'rounded px-1 font-sans',
                            active ? 'bg-primary-foreground/20' : 'bg-muted',
                          )}
                        >
                          文件缺失
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <SkillContentSection
                skill={activeSkill}
                enabled={isSkillEnabled(activeSkill.name)}
                packEnabled={packEnabled}
                disabled={!workspaceId}
                skillBusy={skillBusy}
                onToggle={(enable) => onToggleSkill(activeSkill.name, enable)}
              />
            </>
          )}

          {!isSkillPack && pack.key === 'core-profile' &&
            (workspacePath ? (
              <CoreProfileView workspacePath={workspacePath} />
            ) : (
              <p className="text-xs text-muted-foreground">当前工作区无路径，无法读取核心画像。</p>
            ))}

          {!isSkillPack && pack.segments.length > 0 && (
            <div className="flex-1 min-h-0 flex flex-col gap-2">
              <span className="text-xs text-muted-foreground">
                提示词段（{pack.segments.length} 段，注入内容与工具配套，只读跟随代码版本）
              </span>
              {pack.segments.map((segment) => (
                <SegmentBlock key={segment.key} segment={segment} />
              ))}
            </div>
          )}

          {!isSkillPack && pack.key !== 'core-profile' && pack.segments.length === 0 && (
            <div className="rounded-md border bg-muted/10 px-3 py-2">
              <p className="text-xs text-muted-foreground leading-relaxed">
                此包不注入提示词段，能力由 Skill 与工具包组成；会话启动时按包开关与细开关拼装。
              </p>
            </div>
          )}
        </div>

        <AbilityPackSidebar
          pack={pack}
          packEnabled={packEnabled}
          disabled={!workspaceId}
          packBusy={packBusy}
          onTogglePack={onTogglePack}
          onToolDetail={setDetailTool}
          configVersion={configVersion}
        />
      </div>

      <ToolDetailDialog tool={detailTool} onClose={() => setDetailTool(null)} />
    </div>
  );
}
