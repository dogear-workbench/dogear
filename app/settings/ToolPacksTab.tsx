import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import type { AppSettings } from '@/types/settings';

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

export function ToolPacksTab({ local, setLocal }: Props) {
  const [packs, setPacks] = useState<ToolPack[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client.listToolPacks()
      .then((result) => {
        setPacks(result);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const enabledSet = new Set(local.enabledToolPacks ?? []);

  const togglePack = (name: string) => {
    const current = new Set(local.enabledToolPacks ?? []);
    if (current.has(name)) {
      current.delete(name);
    } else {
      current.add(name);
    }
    setLocal((prev) => ({ ...prev, enabledToolPacks: Array.from(current) }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="text-sm text-muted-foreground">加载中...</div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl py-6 px-6">
      <h2 className="text-lg font-semibold mb-1">工具包</h2>
      <p className="text-sm text-muted-foreground mb-6">
        按工作区需要开启 Agent 可用的能力类目。开启即注册对应 MCP 工具且默认放行（不会再弹权限确认）；关闭则完全不注册，Agent 也搜不到。基础工具 schema 不进上下文，按需加载（SDK Tool Search）。修改后需保存并重启会话。
      </p>

      {/* 常驻工具说明 */}
      <div className="border rounded-lg p-4 bg-muted/30 mb-4">
        <div className="flex items-start gap-3">
          <Sparkles className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold mb-1">记忆系统（常驻）</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              跨会话保存与查询用户偏好和反馈，永远启用、默认放行，不参与开关管理。
            </p>
          </div>
        </div>
      </div>

      {packs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Sparkles className="w-8 h-8 mb-2 opacity-40" />
          <div className="text-sm">暂无可配置的工具包</div>
        </div>
      )}

      <div className="space-y-3">
        {packs.map((pack) => {
          const enabled = enabledSet.has(pack.name);
          return (
            <div
              key={pack.name}
              className={cn(
                'border rounded-lg p-4 transition-colors',
                enabled ? 'bg-muted/30 border-foreground/20' : 'bg-background'
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="text-sm font-semibold">{pack.label}</h3>
                    <span className="text-xs text-muted-foreground font-mono">
                      {pack.name}
                    </span>
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
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {pack.description}
                  </p>
                  {pack.requirements && (
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
                      依赖：{pack.requirements}
                    </p>
                  )}
                </div>

                {/* 启用开关 */}
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
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground mt-6">
        提示：「工具包」内的工具采用整组管理，开启即默认放行不再单独询问权限。如需对 SDK 自带工具（Read/Write/Bash 等）做细粒度权限控制，请到「工具权限」Tab 配置。
      </p>
    </div>
  );
}
