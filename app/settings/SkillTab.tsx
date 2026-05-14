import { useEffect, useState, useCallback } from 'react';
import { Sparkles, FolderOpen, User, Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { useWorkspaceStore } from '@/stores/workspace-store';

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

const SOURCE_META: Record<SkillEntry['source'], { label: string; icon: typeof Sparkles; hint: string }> = {
  plugin: { label: '内置 Skill', icon: Package, hint: '由工具包开关联动，禁用需修改 SKILL.md 文件' },
  workspace: { label: '工作区 Skill', icon: FolderOpen, hint: '位于 <workspace>/.claude/skills/，可单独启停' },
  user: { label: '用户 Skill', icon: User, hint: '位于 ~/.claude/skills/，可单独启停' },
};

export function SkillTab() {
  const workspaceId = useWorkspaceStore((s) => s.workspace?.id ?? null);
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyDir, setBusyDir] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = (await client.listSkills({ workspaceId })) as { skills?: SkillEntry[]; error?: string };
      if (result.error) {
        console.error('listSkills 失败:', result.error);
        setSkills([]);
      } else {
        setSkills(result.skills ?? []);
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

  const grouped: Record<SkillEntry['source'], SkillEntry[]> = {
    plugin: [],
    workspace: [],
    user: [],
  };
  for (const skill of skills) {
    grouped[skill.source].push(skill);
  }

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
                            {isPlugin && skill.pluginGate && skill.pluginGate !== 'always' && (
                              <span
                                className={cn(
                                  'text-xs px-1.5 py-0.5 rounded',
                                  skill.pluginActive
                                    ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400'
                                    : 'bg-muted text-muted-foreground',
                                )}
                              >
                                跟随「{skill.pluginGate}」工具包 · {skill.pluginActive ? '已启用' : '未启用'}
                              </span>
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
