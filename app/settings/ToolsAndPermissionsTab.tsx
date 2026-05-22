import { useEffect, useMemo, useState } from 'react';
import { Sparkles, ChevronDown, ChevronRight, Package, ShieldCheck, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import type { AppSettings } from '@/types/settings';

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

type ToolPermission = 'allow' | 'default' | 'deny';

interface Props {
  local: AppSettings;
  setLocal: React.Dispatch<React.SetStateAction<AppSettings>>;
}

const MEMORY_SERVER = 'dogear-memory';

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

  const sdkGroup = groupByServer['sdk'];
  const memoryGroup = groupByServer[MEMORY_SERVER];

  // ── 工具包开关 ─────────────────────────────────────
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

  // ── SDK 工具权限 ──────────────────────────────────
  const getSdkToolPermission = (tool: ToolInfo): ToolPermission => {
    const rules = local.permissionRules;
    if (rules?.allow?.includes(tool.name)) return 'allow';
    if (rules?.deny?.includes(tool.name)) return 'deny';
    return 'default';
  };

  const setSdkToolPermission = (tool: ToolInfo, perm: ToolPermission) => {
    const rules = local.permissionRules || { allow: [], deny: [] };
    const allow = (rules.allow || []).filter((t) => t !== tool.name);
    const deny = (rules.deny || []).filter((t) => t !== tool.name);
    if (perm === 'allow') allow.push(tool.name);
    if (perm === 'deny') deny.push(tool.name);
    setLocal((prev) => ({ ...prev, permissionRules: { allow, deny } }));
  };

  const setSdkGroupPermission = (perm: ToolPermission) => {
    if (!sdkGroup) return;
    const rules = local.permissionRules || { allow: [], deny: [] };
    const sdkNames = new Set(sdkGroup.tools.map((t) => t.name));
    const allow = (rules.allow || []).filter((t) => !sdkNames.has(t));
    const deny = (rules.deny || []).filter((t) => !sdkNames.has(t));
    if (perm === 'allow') for (const t of sdkGroup.tools) allow.push(t.name);
    if (perm === 'deny') for (const t of sdkGroup.tools) deny.push(t.name);
    setLocal((prev) => ({ ...prev, permissionRules: { allow, deny } }));
  };

  const getSdkGroupPermission = (): ToolPermission => {
    if (!sdkGroup) return 'default';
    const perms = sdkGroup.tools.map((t) => getSdkToolPermission(t));
    if (perms.length > 0 && perms.every((p) => p === 'allow')) return 'allow';
    if (perms.length > 0 && perms.every((p) => p === 'deny')) return 'deny';
    if (perms.every((p) => p === 'default')) return 'default';
    return 'default';
  };

  // ── 细粒度允许规则（带括号模式）─────────────────────
  const getFineGrainedAllowRules = (): string[] => {
    const allow = local.permissionRules?.allow || [];
    return allow.filter((r) => r.includes('('));
  };

  const removeFineGrainedRule = (rule: string) => {
    const rules = local.permissionRules || { allow: [], deny: [] };
    const allow = (rules.allow || []).filter((r) => r !== rule);
    setLocal((prev) => ({ ...prev, permissionRules: { allow, deny: rules.deny || [] } }));
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

  const sdkPerm = getSdkGroupPermission();

  return (
    <div className="max-w-2xl py-6 px-6 space-y-8">
      <div>
        <h2 className="text-lg font-semibold mb-1">工具与权限</h2>
        <p className="text-sm text-muted-foreground">
          统一管理 Agent 可用的能力：开关工具包决定有没有这组工具，开启即默认放行。SDK 内置工具支持细粒度三态权限。MCP 工具不再单独控制——和工具包开关绑定。
        </p>
      </div>

      {/* ── 常驻能力 ───────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">常驻能力</h3>
          <span className="text-xs text-muted-foreground">永远启用，自动放行</span>
        </div>
        <div className="border rounded-lg overflow-hidden">
          <button
            type="button"
            className="w-full flex items-start justify-between gap-3 p-4 bg-muted/30 text-left"
            onClick={() => toggleExpand(MEMORY_SERVER)}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-sm font-semibold">记忆系统</h4>
                <span className="text-xs text-muted-foreground font-mono">{MEMORY_SERVER}</span>
                {memoryGroup && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    {memoryGroup.tools.length} 个工具
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                跨会话保存与查询用户偏好和反馈，永远启用、默认放行，不参与开关管理。
              </p>
            </div>
            {expandedServers[MEMORY_SERVER] ? (
              <ChevronDown className="w-4 h-4 mt-1 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 mt-1 text-muted-foreground shrink-0" />
            )}
          </button>
          {expandedServers[MEMORY_SERVER] && renderPackToolList(MEMORY_SERVER)}
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

      {/* ── SDK 内置工具权限 ───────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-sm font-semibold">SDK 内置工具权限</h3>
          <span className="text-xs text-muted-foreground">细粒度三态：自动允许 / 需确认 / 禁止</span>
        </div>
        {sdkGroup && (
          <div className="border rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-muted/30">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold">{sdkGroup.label}</h4>
                <span className="text-xs text-muted-foreground">({sdkGroup.tools.length})</span>
              </div>
              <div className="inline-flex h-8 items-center rounded-md bg-muted p-0.5 flex-shrink-0">
                {([
                  { value: 'allow' as const, label: '全部允许', color: 'text-green-700' },
                  { value: 'default' as const, label: '需确认', color: 'text-foreground' },
                  { value: 'deny' as const, label: '全部禁止', color: 'text-red-600' },
                ]).map((opt) => (
                  <button
                    key={opt.value}
                    className={cn(
                      'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1 text-xs font-medium transition-all',
                      sdkPerm === opt.value
                        ? `bg-background ${opt.color} shadow-sm`
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    onClick={() => setSdkGroupPermission(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="divide-y">
              {sdkGroup.tools.map((tool) => {
                const perm = getSdkToolPermission(tool);
                return (
                  <div key={tool.name} className="flex items-center justify-between py-2 px-4">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-mono">{tool.name}</span>
                      <span className="text-xs text-muted-foreground ml-2">{tool.description}</span>
                    </div>
                    <div className="inline-flex h-7 items-center rounded-md bg-muted p-0.5 flex-shrink-0 ml-4">
                      {([
                        { value: 'allow' as const, label: '自动允许', color: 'text-green-700' },
                        { value: 'default' as const, label: '需确认', color: 'text-foreground' },
                        { value: 'deny' as const, label: '禁止', color: 'text-red-600' },
                      ]).map((opt) => (
                        <button
                          key={opt.value}
                          className={cn(
                            'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-2.5 py-1 text-xs font-medium transition-all',
                            perm === opt.value
                              ? `bg-background ${opt.color} shadow-sm`
                              : 'text-muted-foreground hover:text-foreground'
                          )}
                          onClick={() => setSdkToolPermission(tool, opt.value)}
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
        )}
      </section>

      {/* ── 细粒度允许规则 ───────────────────────────────────── */}
      {(() => {
        const fineGrainedRules = getFineGrainedAllowRules();
        return (
      <section>
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">细粒度允许规则</h3>
          <span className="text-xs text-muted-foreground">
            点击会话权限卡的"始终允许"后自动写入
          </span>
        </div>
        <div className="border rounded-lg overflow-hidden">
          {fineGrainedRules.length === 0 ? (
            <div className="text-xs text-muted-foreground px-4 py-3">
              暂无细粒度规则
            </div>
          ) : (
            <div className="divide-y">
              {fineGrainedRules.map((rule) => (
                <div key={rule} className="flex items-center justify-between gap-3 px-4 py-2 text-xs">
                  <span className="font-mono text-foreground truncate">{rule}</span>
                  <button
                    type="button"
                    onClick={() => removeFineGrainedRule(rule)}
                    className="text-muted-foreground hover:text-red-600 shrink-0"
                    title="删除此规则"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
        );
      })()}

      <p className="text-xs text-muted-foreground">
        提示：MCP 工具（股票/文章等）通过工具包开关整组管理，不再支持单工具权限。修改后需保存并重启会话才会生效。
      </p>
    </div>
  );
}
