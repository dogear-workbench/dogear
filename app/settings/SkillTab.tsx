import { useEffect, useState, useCallback } from 'react';
import { Sparkles, FolderOpen, User, Package, Download, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { showConfirm } from '@/stores/confirm-store';

interface SkillEntry {
  source: 'workspace' | 'user' | 'plugin';
  name: string;
  description?: string;
  dir: string;
  filePath: string;
  enabled: boolean;
  pluginGate?: 'always' | string;
  pluginActive?: boolean;
}

interface SkillTemplate {
  name: string;
  description: string;
}

const SOURCE_META: Record<SkillEntry['source'], { label: string; icon: typeof Sparkles; hint: string }> = {
  plugin: { label: '插件 Skills', icon: Package, hint: '随应用内置（如文章解析），禁用需修改 SKILL.md 文件' },
  workspace: { label: '工作区 Skills', icon: FolderOpen, hint: '位于 <workspace>/.claude/skills/，可单独启停' },
  user: { label: '用户 Skills', icon: User, hint: '位于 ~/.claude/skills/，可单独启停' },
};

export function SkillTab() {
  const workspaceId = useWorkspaceStore((s) => s.workspace?.id ?? null);
  const workspacePath = useWorkspaceStore((s) => s.workspace?.path);
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [templates, setTemplates] = useState<SkillTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyDir, setBusyDir] = useState<string | null>(null);
  const [busyTemplate, setBusyTemplate] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [skillResult, tplResult] = await Promise.all([
        client.listSkills({ workspaceId }) as Promise<{ skills?: SkillEntry[]; error?: string }>,
        client.listSkillTemplates() as Promise<{ templates?: SkillTemplate[]; error?: string }>,
      ]);
      if (skillResult.error) {
        console.error('listSkills 失败:', skillResult.error);
        setSkills([]);
      } else {
        setSkills(skillResult.skills ?? []);
      }
      if (tplResult.error) {
        console.error('listSkillTemplates 失败:', tplResult.error);
        setTemplates([]);
      } else {
        setTemplates(tplResult.templates ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const toggleSkill = async (skill: SkillEntry) => {
    setBusyDir(skill.dir);
    try {
      const result = (await client.setSkillEnabled({
        dir: skill.dir,
        enabled: !skill.enabled,
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

  const handleSubscribe = async (template: SkillTemplate, isResync: boolean) => {
    if (!workspacePath) return;
    if (isResync) {
      const ok = await showConfirm(
        '重新同步模板',
        `「重新同步」会覆盖你对 ${template.name} 的本地修改，确定继续吗？`,
      );
      if (!ok) return;
    }
    setBusyTemplate(template.name);
    try {
      const result = (await client.subscribeSkillTemplate({
        workspacePath,
        name: template.name,
        overwrite: isResync,
      })) as { success?: boolean; error?: string };
      if (result.error === 'SKILL_EXISTS') {
        const ok = await showConfirm(
          'Skill 已存在',
          `${template.name} 已存在，是否覆盖？`,
        );
        if (!ok) return;
        await client.subscribeSkillTemplate({
          workspacePath,
          name: template.name,
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

  const grouped: Record<SkillEntry['source'], SkillEntry[]> = {
    plugin: [],
    workspace: [],
    user: [],
  };
  for (const skill of skills) {
    grouped[skill.source].push(skill);
  }

  const subscribedNames = new Set(
    grouped.workspace.map((s) => s.name),
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="text-sm text-muted-foreground">加载中...</div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl py-6 px-6">
      <h2 className="text-lg font-semibold mb-1">Skill 管理</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Agent 启动时会自动扫描 <code className="text-xs">~/.claude/skills/</code> 与 <code className="text-xs">&lt;工作区&gt;/.claude/skills/</code>，
        把匹配到的 SKILL.md 注入元数据。禁用通过把 <code className="text-xs">SKILL.md</code> 重命名为 <code className="text-xs">SKILL.md.disabled</code> 实现，下一次会话生效。
      </p>

      {/* 可订阅模板 */}
      <section className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Download className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">可订阅模板</h3>
          <span className="text-xs text-muted-foreground">订阅后副本写入工作区，可任意编辑</span>
        </div>

        {templates.length === 0 ? (
          <div className="border rounded-lg p-4 text-xs text-muted-foreground bg-muted/20">
            暂无可订阅模板
          </div>
        ) : (
          <div className="space-y-2">
            {templates.map((tpl) => {
              const subscribed = subscribedNames.has(tpl.name);
              const busy = busyTemplate === tpl.name;
              return (
                <div
                  key={tpl.name}
                  className="border rounded-lg p-3 bg-background"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold">{tpl.name}</span>
                        {subscribed && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400">
                            已订阅
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed mt-1">{tpl.description}</p>
                    </div>

                    <button
                      type="button"
                      disabled={busy || !workspacePath}
                      className={cn(
                        'flex items-center gap-1.5 px-2.5 h-7 rounded-md border text-xs flex-shrink-0',
                        'hover:bg-muted/50 transition-colors',
                        (busy || !workspacePath) && 'opacity-50 cursor-not-allowed',
                      )}
                      onClick={() => handleSubscribe(tpl, subscribed)}
                      title={subscribed ? '重新同步（覆盖本地）' : '订阅到工作区'}
                    >
                      {subscribed
                        ? <><RotateCcw className="w-3 h-3" />重新同步</>
                        : <><Download className="w-3 h-3" />订阅</>}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {(['plugin', 'workspace', 'user'] as const).map((source) => {
        const list = grouped[source];
        const meta = SOURCE_META[source];
        const Icon = meta.icon;
        return (
          <section key={source} className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <Icon className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">{meta.label}</h3>
              <span className="text-xs text-muted-foreground">{meta.hint}</span>
            </div>

            {list.length === 0 ? (
              <div className="border rounded-lg p-4 text-xs text-muted-foreground bg-muted/20">
                {source === 'plugin' ? '未发现内置 Skill' : '没有发现任何 skill'}
              </div>
            ) : (
              <div className="space-y-2">
                {list.map((skill) => {
                  const isPlugin = skill.source === 'plugin';
                  const pluginInactive = isPlugin && skill.pluginActive === false;
                  const effectiveEnabled = skill.enabled && !pluginInactive;
                  const busy = busyDir === skill.dir;
                  return (
                    <div
                      key={skill.dir}
                      className={cn(
                        'border rounded-lg p-3 transition-colors',
                        effectiveEnabled ? 'bg-muted/30 border-foreground/20' : 'bg-background',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold">{skill.name}</span>
                            {isPlugin && skill.pluginGate === 'always' && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">常驻</span>
                            )}
                            {!skill.enabled && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400">
                                已禁用（SKILL.md.disabled）
                              </span>
                            )}
                          </div>
                          {skill.description && (
                            <p className="text-xs text-muted-foreground leading-relaxed mt-1">{skill.description}</p>
                          )}
                          <p className="text-xs text-muted-foreground/70 font-mono mt-1 break-all">{skill.dir}</p>
                        </div>

                        <button
                          type="button"
                          disabled={busy}
                          className={cn(
                            'relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0',
                            skill.enabled ? 'bg-primary' : 'bg-muted',
                            busy && 'opacity-50 cursor-not-allowed',
                          )}
                          onClick={() => toggleSkill(skill)}
                          aria-label={`${skill.enabled ? '禁用' : '启用'} ${skill.name}`}
                        >
                          <span
                            className={cn(
                              'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                              skill.enabled ? 'translate-x-6' : 'translate-x-1',
                            )}
                          />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      <p className="text-xs text-muted-foreground mt-6">
        提示：禁用/启用是文件改名操作，不计入设置 dirty。修改后需<strong>重启会话</strong>才能在 Agent 端生效。
      </p>
    </div>
  );
}
