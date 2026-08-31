import { ToolDetailShell, ToolSection, KeyValueList, OutputBox } from './ToolDetailShell';

interface Props {
  toolInput?: Record<string, any>;
  toolOutput?: any;
  isError?: boolean;
}

function toOutputText(toolOutput: any): string {
  if (typeof toolOutput === 'string') return toolOutput;
  return toolOutput != null ? JSON.stringify(toolOutput, null, 2) : '';
}

export function TaskCardRenderer({ toolInput, toolOutput, isError }: Props) {
  const outputText = toOutputText(toolOutput);
  const outputSection = outputText ? (
    <ToolSection label={isError ? '错误' : '输出'}>
      <OutputBox content={outputText} isError={isError} maxHeightClass="max-h-32" />
    </ToolSection>
  ) : null;

  if (toolInput?.taskId) {
    const meta: Record<string, string> = { '任务 ID': toolInput.taskId };
    if (!isError) meta['状态'] = '已转入执行队列';
    return (
      <ToolDetailShell>
        <ToolSection label="执行任务">
          <KeyValueList data={meta} />
        </ToolSection>
        {outputSection}
      </ToolDetailShell>
    );
  }

  const title = typeof toolInput?.title === 'string' ? toolInput.title : '';
  const meta: Record<string, string> = {
    状态: toolInput?.autoExecute === true ? '立即执行' : toolInput?.planPath ? '已落计划栏' : '占位（无 plan 文档）',
  };
  if (toolInput?.planPath) meta['plan 文档'] = toolInput.planPath;

  return (
    <ToolDetailShell>
      <ToolSection label="挂载任务">
        <div className="text-foreground font-medium break-all">{title}</div>
      </ToolSection>
      <ToolSection label="配置">
        <KeyValueList data={meta} />
      </ToolSection>
      {outputSection}
    </ToolDetailShell>
  );
}
