import { cn } from '@/lib/utils';
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

interface Props {
  local: AppSettings;
  setLocal: React.Dispatch<React.SetStateAction<AppSettings>>;
}

export function BasicToolsSection({ local, setLocal }: Props) {
  const getBasicPermission = (name: BasicToolName): BasicToolPermission => {
    return local.basicToolPermissions[name] ?? 'ask';
  };

  const setBasicPermission = (name: BasicToolName, perm: BasicToolPermission) => {
    setLocal((prev) => ({
      ...prev,
      basicToolPermissions: { ...prev.basicToolPermissions, [name]: perm },
    }));
  };

  const setAllBasic = (perm: BasicToolPermission) => {
    setLocal((prev) => {
      const updated = { ...prev.basicToolPermissions };
      for (const name of BASIC_TOOL_NAMES) updated[name] = perm;
      return { ...prev, basicToolPermissions: updated };
    });
  };

  const allBasicPerm = (): BasicToolPermission | 'mixed' => {
    const vals = BASIC_TOOL_NAMES.map(n => getBasicPermission(n));
    if (vals.every(v => v === 'allow')) return 'allow';
    if (vals.every(v => v === 'ask')) return 'ask';
    return 'mixed';
  };

  const groupPerm = allBasicPerm();

  return (
    <section>
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">基础工具权限</h3>
          <span className="text-xs text-muted-foreground">每项可设为「自动放行」或「询问」</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          「自动放行」的工具有对应调用时直接执行；「询问」的工具会弹出权限确认卡片，可选择「允许一次」或「本会话允许」。
          修改后需保存并重启会话才会生效。
        </p>
      </div>
      <div className="border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-muted/30">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold">全部基础工具</h4>
            <span className="text-xs text-muted-foreground">({BASIC_TOOL_NAMES.length})</span>
          </div>
          <div className="inline-flex h-8 items-center rounded-md bg-muted p-0.5 flex-shrink-0">
            {([
              { value: 'allow' as const, label: '全部放行', color: 'text-green-700' },
              { value: 'ask' as const, label: '全部询问', color: 'text-amber-600' },
            ]).map((opt) => (
              <button
                key={opt.value}
                className={cn(
                  'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1 text-xs font-medium transition-all',
                  groupPerm === opt.value
                    ? `bg-background ${opt.color} shadow-sm`
                    : 'text-muted-foreground hover:text-foreground'
                )}
                onClick={() => setAllBasic(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="divide-y">
          {BASIC_TOOL_NAMES.map((name) => {
            const meta = BASIC_TOOL_META[name];
            const perm = getBasicPermission(name);
            return (
              <div key={name} className="flex items-center justify-between py-2 px-4">
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-mono">{meta.label}</span>
                  <span className="text-xs text-muted-foreground ml-2">{meta.description}</span>
                </div>
                <div className="inline-flex h-7 items-center rounded-md bg-muted p-0.5 flex-shrink-0 ml-4">
                  {([
                    { value: 'allow' as const, label: '自动放行', color: 'text-green-700' },
                    { value: 'ask' as const, label: '询问', color: 'text-amber-600' },
                  ]).map((opt) => (
                    <button
                      key={opt.value}
                      className={cn(
                        'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-2.5 py-1 text-xs font-medium transition-all',
                        perm === opt.value
                          ? `bg-background ${opt.color} shadow-sm`
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                      onClick={() => setBasicPermission(name, opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
