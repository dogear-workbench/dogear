import { useState } from 'react';
import { ArrowLeft, ChevronRight, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AbilitySystemBehaviorView, ResidentToolGroupMeta } from '../../../electron/main/tipc/ability';

// 主进程真源：electron/main/tipc/ability.ts 的 SYSTEM_MOUNTS_PACK_KEY；值导入会把整个主进程依赖图拉进浏览器构建
const SYSTEM_MOUNTS_PACK_KEY = '__system__';
import { SYSTEM_BEHAVIOR_ICON } from './pack-meta';
import { BasicToolsSection } from './BasicToolsSection';
import { AbilityMountsSection } from './AbilityMountsSection';
import { ToolDetailDialog } from '../ToolDetailDialog';

interface SystemBehaviorDetailProps {
  behaviors: AbilitySystemBehaviorView[];
  residentToolGroups: ResidentToolGroupMeta[];
  workspaceId: string | null;
  onBack: () => void;
}

function NoteBlock({ lines }: { lines: string[] }) {
  return (
    <div className="rounded-md border bg-muted/10 px-3 py-2 space-y-1">
      {lines.map((line, i) => (
        <p key={i} className="text-xs text-muted-foreground leading-relaxed">
          {line}
        </p>
      ))}
    </div>
  );
}

function SectionTitle({ index, title, hint }: { index: number; title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-sm font-semibold">
        {index}. {title}
      </span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

export function SystemBehaviorDetail({ residentToolGroups, workspaceId, onBack }: SystemBehaviorDetailProps) {
  const [detailTool, setDetailTool] = useState<{ name: string; description: string } | null>(null);
  const Icon = SYSTEM_BEHAVIOR_ICON;

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 border-b px-4 py-2 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1" />
          返回
        </Button>
        <span className="text-sm text-muted-foreground">能力</span>
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">系统行为</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-muted/60 p-2 shrink-0">
            <Icon className="w-5 h-5 text-foreground/80" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-semibold">系统行为</h3>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
              框架固定行为总览：以下行为均不可关闭、不归能力包管，每项标注触发条件与控制位置。
            </p>
          </div>
        </div>

        <section className="space-y-2">
          <SectionTitle index={1} title="常驻工具" hint="无提示词，绑定工作区即注册" />
          <BasicToolsSection />
          <div className="pt-1">
            <span className="text-xs text-muted-foreground">加载情况</span>
            <div className="pt-1.5">
              <AbilityMountsSection
                packKey={SYSTEM_MOUNTS_PACK_KEY}
                workspaceId={workspaceId}
                refreshKey={0}
              />
            </div>
          </div>
          {workspaceId ? (
            <div className="space-y-2">
              {residentToolGroups.map((group) => (
                <div key={group.id} className="rounded-md border bg-background overflow-hidden">
                  <div className="flex items-center gap-2 px-2.5 py-1.5 bg-muted/30 border-b">
                    <span className="text-xs font-medium">{group.label}</span>
                    <span className="text-xs text-muted-foreground ml-auto">
                      主会话 + 子会话 · 不可关闭
                    </span>
                  </div>
                  <div className="divide-y divide-border/60">
                    {group.tools.map((tool) => (
                      <button
                        key={tool.name}
                        type="button"
                        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-muted/30 transition-colors"
                        onClick={() => setDetailTool(tool)}
                      >
                        <span className="text-xs font-mono text-foreground/90 truncate">{tool.name}</span>
                        <span className="text-xs text-muted-foreground truncate flex-1">{tool.shortDescription}</span>
                        <Eye className="w-3 h-3 text-muted-foreground shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <NoteBlock lines={['当前未绑定工作区：任务系统与跨会话检索组需绑定工作区后可用。']} />
          )}
        </section>
      </div>

      <ToolDetailDialog tool={detailTool} onClose={() => setDetailTool(null)} />
    </div>
  );
}
