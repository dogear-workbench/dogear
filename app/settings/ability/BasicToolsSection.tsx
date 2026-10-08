import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { useSettingsStore } from '@/stores/settings-store';
import type { AppSettings, BasicToolName, BasicToolPermission } from '@/types/settings';
import { BASIC_TOOL_NAMES } from '@/types/settings';

const BASIC_TOOL_META: Record<BasicToolName, { label: string; description: string }> = {
  read: { label: 'Read', description: '读取文件内容' },
  write: { label: 'Write', description: '创建或覆盖文件' },
  edit: { label: 'Edit', description: '编辑文件片段' },
  bash: { label: 'Bash', description: '执行终端命令' },
  Glob: { label: 'Glob', description: '按模式搜索文件' },
  Grep: { label: 'Grep', description: '搜索文件内容' },
  Skill: { label: 'Skill', description: '加载技能指引' },
};

const PERMISSION_OPTIONS = [
  { value: 'allow' as const, label: '自动放行', color: 'text-green-700' },
  { value: 'ask' as const, label: '询问', color: 'text-amber-600' },
];

export function BasicToolsSection() {
  const settings = useSettingsStore((s) => s.settings);
  const permissions = settings.basicToolPermissions;

  const getPermission = (name: BasicToolName): BasicToolPermission => permissions[name] ?? 'ask';

  const saveSettings = (nextPermissions: Record<BasicToolName, BasicToolPermission>) => {
    const current = useSettingsStore.getState().settings;
    const next: AppSettings = { ...current, basicToolPermissions: nextPermissions };
    void client.updateSettings({ settings: next });
  };

  const setPermission = (name: BasicToolName, perm: BasicToolPermission) => {
    saveSettings({ ...permissions, [name]: perm });
  };

  const setAll = (perm: BasicToolPermission) => {
    const updated = { ...permissions };
    for (const name of BASIC_TOOL_NAMES) updated[name] = perm;
    saveSettings(updated);
  };

  const groupPerm = (() => {
    const vals = BASIC_TOOL_NAMES.map((n) => getPermission(n));
    if (vals.every((v) => v === 'allow')) return 'allow' as const;
    if (vals.every((v) => v === 'ask')) return 'ask' as const;
    return 'mixed' as const;
  })();

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-semibold">基础工具（{BASIC_TOOL_NAMES.length} 个）</span>
        <div className="inline-flex h-7 items-center rounded-md bg-muted p-0.5 flex-shrink-0">
          {([
            { value: 'allow' as const, label: '全部放行', color: 'text-green-700' },
            { value: 'ask' as const, label: '全部询问', color: 'text-amber-600' },
          ]).map((opt) => (
            <button
              key={opt.value}
              className={cn(
                'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-2.5 py-1 text-xs font-medium transition-all',
                groupPerm === opt.value
                  ? `bg-background ${opt.color} shadow-sm`
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setAll(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        「自动放行」的工具有对应调用时直接执行；「询问」的工具会弹出权限确认卡片，可选择「允许一次」或「本会话允许」。
        切换即时保存，正在运行的会话在下一轮消息前自动生效。
      </p>
      <div className="rounded-md border bg-background divide-y divide-border/60">
        {BASIC_TOOL_NAMES.map((name) => {
          const meta = BASIC_TOOL_META[name];
          const perm = getPermission(name);
          return (
            <div key={name} className="flex items-center justify-between px-2.5 py-1.5">
              <div className="flex-1 min-w-0">
                <span className="text-xs font-mono font-medium text-foreground/90">{meta.label}</span>
                <span className="text-xs text-muted-foreground ml-2">{meta.description}</span>
              </div>
              <div className="inline-flex h-7 items-center rounded-md bg-muted p-0.5 flex-shrink-0 ml-4">
                {PERMISSION_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={cn(
                      'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-2.5 py-1 text-xs font-medium transition-all',
                      perm === opt.value
                        ? `bg-background ${opt.color} shadow-sm`
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => setPermission(name, opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
