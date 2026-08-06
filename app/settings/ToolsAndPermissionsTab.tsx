import { useEffect, useMemo, useState } from 'react';
import { Sparkles, ChevronDown, ChevronRight, Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import type { AppSettings, BasicToolName, BasicToolPermission } from '@/types/settings';
import { BASIC_TOOL_NAMES } from '@/types/settings';

interface ToolInfo { name: string; description: string; server: string }
interface ToolGroup { server: string; label: string; tools: ToolInfo[] }
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

interface Props {
  local: AppSettings;
  setLocal: React.Dispatch<React.SetStateAction<AppSettings>>;
}

const MEMORY_SERVER = 'dogear-memory';
const GROUP_SERVER = 'dogear-group';

interface ResidentMeta {
  server: string;
  label: string;
  description: string;
}

const RESIDENT_SERVERS: ResidentMeta[] = [
  {
    server: MEMORY_SERVER,
    label: '记忆系统',
    description: '跨会话保存与查询用户偏好和反馈，永远启用、默认放行，不参与开关管理。',
  },
  {
    server: GROUP_SERVER,
    label: '话题共享区',
    description: '会话加入组时自动启用，提供共享区文件的列出、读取、写入；非组会话不会注册。',
  },
];

const BASIC_TOOL_META: Record<BasicToolName, { label: string; description: string }> = {
  read: { label: 'Read', description: '读取文件内容' },
  write: { label: 'Write', description: '创建或覆盖文件' },
  edit: { label: 'Edit', description: '编辑文件片段' },
  bash: { label: 'Bash', description: '执行终端命令' },
  Glob: { label: 'Glob', description: '按模式搜索文件' },
  Grep: { label: 'Grep', description: '搜索文件内容' },
  Skill: { label: 'Skill', description: '加载技能指引' },
};

export function ToolsAndPermissionsTab({ local, setLocal }: Props) {
  const [toolGroups, setToolGroups] = useState<ToolGroup[]>([]);
  const [packs, setPacks] = useState<ToolPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedServers, setExpandedServers] = useState<Record<string, boolean>>({});

  useEffect(() => {
    Promise.all([
      client.getRegisteredTools().then((res: any) => Array.isArray(res) ? res as ToolGroup[] : []),
      client.listToolPacks().then((res: any) => Array.isArray(res) ? res as ToolPack[] : []),
    ])
      .then(([groups, list]) => {
        setToolGroups(groups);
        setPacks(list);
      })
      .finally(() => setLoading(false));
  }, []);

  const groupByServer = useMemo(() => {
    const map: Record<string, ToolGroup> = {};
    for (const g of toolGroups) map[g.server] = g;
    return map;
  }, [toolGroups]);

  const enabledPackSet = new Set(local.enabledToolPacks ?? []);
  const togglePack = (name: string) => {
    const current = new Set(local.enabledToolPacks ?? []);
    if (current.has(name)) current.delete(name);
    else current.add(name);
    setLocal((prev) => ({ ...prev, enabledToolPacks: Array.from(current) }));
  };

  const toggleExpand = (server: string) => {
    setExpandedServers((prev) => ({ ...prev, [server]: !prev[server] }));
  };

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="text-sm text-muted-foreground">加载中...</div>
      </div>
    );
  }

  const renderPackToolList = (server: string) => {
    const group = groupByServer[server];
    if (!group || group.tools.length === 0) {
      return (
        <div className="text-xs text-muted-foreground px-3 py-2">
          会话启动后才会注册具体工具，此处暂无明细。
        </div>
      );
    }
    return (
      <div className="divide-y border-t">
        {group.tools.map((t) => (
          <div key={`${server}::${t.name}`} className="flex items-start gap-3 px-4 py-2 text-xs">
            <span className="font-mono text-foreground shrink-0">{t.name}</span>
            <span className="text-muted-foreground leading-relaxed">{t.description}</span>
          </div>
        ))}
      </div>
    );
  };

  const groupPerm = allBasicPerm();

  return (
    <div className="max-w-2xl py-6 px-6 space-y-8">
      <div>
        <h2 className="text-lg font-semibold mb-1">工具与权限</h2>
        <p className="text-sm text-muted-foreground">
          统一管理 Agent 可用的能力：基础工具可配置「自动放行 / 询问」；工具包开启即自动放行。设置仅影响之后新建或重启的会话。
        </p>
      </div>

      {/* ── 基础工具权限 ───────────────────────────────────── */}
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

      {/* ── 常驻能力 ───────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">常驻能力</h3>
          <span className="text-xs text-muted-foreground">永远启用，自动放行</span>
        </div>
        <div className="space-y-3">
          {RESIDENT_SERVERS.map((meta) => {
            const group = groupByServer[meta.server];
            const expanded = expandedServers[meta.server] ?? false;
            return (
              <div key={meta.server} className="border rounded-lg overflow-hidden">
                <button
                  type="button"
                  className="w-full flex items-start justify-between gap-3 p-4 bg-muted/30 text-left"
                  onClick={() => toggleExpand(meta.server)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-semibold">{meta.label}</h4>
                      <span className="text-xs text-muted-foreground font-mono">{meta.server}</span>
                      {group && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {group.tools.length} 个工具
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                      {meta.description}
                    </p>
                  </div>
                  {expanded ? (
                    <ChevronDown className="w-4 h-4 mt-1 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 mt-1 text-muted-foreground shrink-0" />
                  )}
                </button>
                {expanded && renderPackToolList(meta.server)}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── 可选工具包 ──────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <Package className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">可选工具包</h3>
          <span className="text-xs text-muted-foreground">开启即整组放行，关闭则完全不注册</span>
        </div>

        {packs.length === 0 ? (
          <div className="border rounded-lg p-4 text-xs text-muted-foreground bg-muted/20">
            暂无可配置的工具包
          </div>
        ) : (
          <div className="space-y-3">
            {packs.map((pack) => {
              const enabled = enabledPackSet.has(pack.name);
              const expanded = expandedServers[pack.mcpServer] ?? false;
              return (
                <div
                  key={pack.name}
                  className={cn(
                    'border rounded-lg overflow-hidden transition-colors',
                    enabled ? 'bg-muted/30 border-foreground/20' : 'bg-background'
                  )}
                >
                  <div className="flex items-start justify-between gap-3 p-4">
                    <button
                      type="button"
                      className="flex-1 min-w-0 flex items-start gap-2 text-left"
                      onClick={() => toggleExpand(pack.mcpServer)}
                    >
                      {expanded ? (
                        <ChevronDown className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-sm font-semibold">{pack.label}</h4>
                          <span className="text-xs text-muted-foreground font-mono">{pack.name}</span>
                          {pack.toolCount > 0 && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              {pack.toolCount} 个工具
                            </span>
                          )}
                          {pack.requiresWorkspace && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400">
                              依赖工作区
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                          {pack.description}
                        </p>
                        {pack.requirements && (
                          <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                            依赖：{pack.requirements}
                          </p>
                        )}
                      </div>
                    </button>

                    <button
                      type="button"
                      className={cn(
                        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0',
                        enabled ? 'bg-primary' : 'bg-muted'
                      )}
                      onClick={() => togglePack(pack.name)}
                      aria-label={`${enabled ? '禁用' : '启用'} ${pack.label}`}
                    >
                      <span
                        className={cn(
                          'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                          enabled ? 'translate-x-6' : 'translate-x-1'
                        )}
                      />
                    </button>
                  </div>
                  {expanded && renderPackToolList(pack.mcpServer)}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        提示：已启用的工具包在会话运行时自动放行，不会弹出权限确认卡片。修改后需保存并重启会话才会生效。
      </p>
    </div>
  );
}
