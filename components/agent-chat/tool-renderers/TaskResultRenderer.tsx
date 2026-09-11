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

export function TaskResultRenderer({ toolInput, toolOutput, isError }: Props) {
  const outputText = toOutputText(toolOutput);
  const summary = typeof toolInput?.result === 'string' ? toolInput.result : '';
  const taskId = outputText.match(/任务 ID: ([^\s"\\]+)/)?.[1] ?? '';
  const taskTitle = outputText.match(/标题: (.+)/)?.[1]?.trim() ?? '';
  const status = outputText.match(/状态: (\S+)/)?.[1]?.trim() ?? '';

  const outputSection = outputText ? (
    <ToolSection label={isError ? '错误' : '输出'}>
      <OutputBox content={outputText} isError={isError} maxHeightClass="max-h-32" />
    </ToolSection>
  ) : null;

  return (
    <ToolDetailShell>
      {summary && (
        <ToolSection label="申报摘要">
          <div className="whitespace-pre-wrap break-all text-foreground/90 max-h-40 overflow-y-auto bg-muted/30 rounded px-2 py-1.5">
            {summary}
          </div>
        </ToolSection>
      )}
      {(taskId || status) && (
        <ToolSection label="任务">
          <div className="flex flex-wrap items-center gap-2">
            {taskTitle && <span className="text-foreground font-medium break-all">{taskTitle}</span>}
            {status && (
              <span className="inline-flex items-center rounded-full border border-blue-500/40 bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-700 dark:text-blue-300 shrink-0">
                {status}
              </span>
            )}
          </div>
          {taskId && <KeyValueList data={{ '任务 ID': taskId }} />}
        </ToolSection>
      )}
      {outputSection}
    </ToolDetailShell>
  );
}
