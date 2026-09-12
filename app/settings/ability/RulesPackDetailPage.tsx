import { ArrowLeft, ChevronRight, ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { client } from '@/lib/client';
import type { Workspace } from '@/types/electron-api';
import { AbilityMountsSection } from './AbilityMountsSection';
import { RuleFileEditor } from './RuleFileEditor';

interface RulesPackDetailPageProps {
  workspace: Workspace | null;
  workspaceId: string | null;
  workspaceRulesEnabled: boolean;
  globalRulesEnabled: boolean;
  packBusy: boolean;
  configVersion: number;
  onBack: () => void;
  onTogglePack: (key: string, enable: boolean) => void;
}

function RuleSwitchSection({
  label,
  description,
  checked,
  disabled,
  onToggle,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onToggle: (enable: boolean) => void;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Switch checked={checked} disabled={disabled} onCheckedChange={onToggle} aria-label={`${checked ? '关闭' : '开启'} ${label}`} />
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </section>
  );
}

export function RulesPackDetailPage({
  workspace,
  workspaceId,
  workspaceRulesEnabled,
  globalRulesEnabled,
  packBusy,
  configVersion,
  onBack,
  onTogglePack,
}: RulesPackDetailPageProps) {
  const switchDisabled = !workspaceId || packBusy;

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 border-b px-4 py-2 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1" />
          返回
        </Button>
        <span className="text-sm text-muted-foreground">能力</span>
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">规则</span>
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
              <ScrollText className="w-5 h-5 text-foreground/80" />
            </div>
            <div className="space-y-1 min-w-0">
              <h3 className="text-base font-semibold">规则</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                工作区与全局 agent.md 注入每个会话，各自独立编辑与开关。
              </p>
            </div>
          </div>

          {workspaceId ? (
            <RuleFileEditor
              title={`工作区 agent.md（${workspace?.name ?? ''}）`}
              emptyHint={'# 工作区指令\n\n在此编写给 AI 助手的工作区级指令…'}
              read={() => client.readWorkspaceAgentMd({ workspaceId })}
              write={(content) => client.writeWorkspaceAgentMd({ workspaceId, content })}
              loadTemplate={() => client.getWorkspaceAgentTemplate()}
            />
          ) : (
            <div className="rounded-md border bg-muted/10 px-3 py-2">
              <p className="text-sm text-muted-foreground">请先选择工作区，再编辑工作区 agent.md。</p>
            </div>
          )}

          <RuleFileEditor
            title="全局规则 agent.md（.dogear/agent.md，跨工作区生效）"
            emptyHint={'# 全局指令\n\n在此编写跨工作区生效的全局指令…'}
            read={() => client.readUserAgentMd()}
            write={(content) => client.writeUserAgentMd({ content })}
            loadTemplate={() => client.getUserAgentTemplate()}
          />
        </div>

        <div className="w-80 shrink-0 space-y-5 overflow-y-auto border-l p-4">
          <RuleSwitchSection
            label="工作区规则"
            description="默认开启，关闭后当前工作区的会话不注入工作区 agent.md。"
            checked={workspaceRulesEnabled}
            disabled={switchDisabled}
            onToggle={(enable) => onTogglePack('workspace-rules', enable)}
          />
          <RuleSwitchSection
            label="全局规则"
            description="默认开启，关闭后当前工作区的会话不注入全局 agent.md。"
            checked={globalRulesEnabled}
            disabled={switchDisabled}
            onToggle={(enable) => onTogglePack('global-rules', enable)}
          />

          <section className="space-y-2">
            <span className="text-xs text-muted-foreground">挂载情况</span>
            <p className="text-xs font-medium pt-1">工作区规则</p>
            <AbilityMountsSection packKey="workspace-rules" refreshKey={configVersion} />
            <p className="text-xs font-medium pt-2">全局规则</p>
            <AbilityMountsSection packKey="global-rules" refreshKey={configVersion} />
          </section>

          <p className="text-xs text-muted-foreground/70 leading-relaxed border-t pt-3">
            开关即时保存到当前工作区配置；修改后需重启会话生效。
          </p>
        </div>
      </div>
    </div>
  );
}
