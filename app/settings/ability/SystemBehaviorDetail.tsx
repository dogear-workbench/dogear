import { useState } from 'react';
import { ArrowLeft, ChevronRight, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { SYSTEM_MOUNTS_PACK_KEY, type AbilitySystemBehaviorView, type ResidentToolGroupMeta } from '../../../electron/main/tipc/ability';
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

function SegmentCard({ behavior }: { behavior: AbilitySystemBehaviorView }) {
  return (
    <div className="rounded-md border overflow-hidden flex flex-col min-h-0">
      <div className="px-3 py-2 bg-muted/30 border-b space-y-0.5 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">{behavior.label}</span>
          <span className="text-xs px-1 py-0.5 rounded bg-muted text-muted-foreground">系统 · 只读</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{behavior.triggerDescription}</p>
      </div>
      <div className="overflow-auto max-h-96 px-3 py-2 text-sm">
        <MarkdownRenderer content={behavior.segment.template || '（模板为空）'} />
      </div>
    </div>
  );
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

export function SystemBehaviorDetail({ behaviors, residentToolGroups, workspaceId, onBack }: SystemBehaviorDetailProps) {
  const [detailTool, setDetailTool] = useState<{ name: string; description: string } | null>(null);
  const Icon = SYSTEM_BEHAVIOR_ICON;
  const groupContext = behaviors.find((b) => b.key === 'group-context') ?? null;
  const subAgentContract = behaviors.find((b) => b.key === 'sub-agent-contract') ?? null;

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

        {groupContext && (
          <section className="space-y-2">
            <SectionTitle index={1} title="会话组上下文" hint="有会话组即注入" />
            <SegmentCard behavior={groupContext} />
          </section>
        )}

        {subAgentContract && (
          <section className="space-y-2">
            <SectionTitle index={2} title="主子会话协作" hint="子会话固定注入" />
            <SegmentCard behavior={subAgentContract} />
            <NoteBlock
              lines={[
                '子会话属于会话组时固定注册组协作（dogear-group）与任务交付（dogear-delegation）两组工具，作为交付基础设施不随能力包开关。',
                '主会话派遣规范与 Profile 索引归「Agent 协作」能力包，受其开关控制。',
              ]}
            />
          </section>
        )}

        <section className="space-y-2">
          <SectionTitle index={3} title="常驻工具" hint="无提示词，绑定工作区即注册" />
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
