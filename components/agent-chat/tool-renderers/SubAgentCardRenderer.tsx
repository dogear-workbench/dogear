import { ToolDetailShell, ToolSection, KeyValueList, OutputBox } from './ToolDetailShell';

interface Props {
  toolInput?: Record<string, any>;
  toolOutput?: any;
  isError?: boolean;
}

function truncateTask(task: string, max = 80): string {
  const one = task.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max) + '…' : one;
}

function toOutputText(toolOutput: any): string {
  if (typeof toolOutput === 'string') return toolOutput;
  return toolOutput != null ? JSON.stringify(toolOutput, null, 2) : '';
}

export function SubAgentCardRenderer({ toolInput, toolOutput, isError }: Props) {
  const outputText = toOutputText(toolOutput);
  const items = Array.isArray(toolInput?.items) ? toolInput.items : null;

  if (items) {
    return (
      <ToolDetailShell>
        <ToolSection label={`子任务（${items.length}）`}>
          <div className="space-y-1.5">
            {items.map((item: any, i: number) => (
              <div key={i} className="flex gap-2 items-baseline">
                <span className="text-muted-foreground/70 shrink-0">{i + 1}.</span>
                <div className="min-w-0 flex-1">
                  <div className="text-foreground break-all">{truncateTask(String(item?.task ?? ''))}</div>
                  {item?.outputPath && (
                    <div className="font-mono text-[10px] text-muted-foreground break-all">{item.outputPath}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ToolSection>
        {outputText && (
          <ToolSection label={isError ? '错误' : '输出'}>
            <OutputBox content={outputText} isError={isError} />
          </ToolSection>
        )}
      </ToolDetailShell>
    );
  }

  const task = typeof toolInput?.task === 'string' ? toolInput.task : '';
  const meta: Record<string, string> = {};
  if (toolInput?.title) meta['会话标题'] = toolInput.title;
  if (toolInput?.profile) meta['Profile'] = toolInput.profile;
  if (toolInput?.model) meta['模型'] = toolInput.model;
  if (toolInput?.outputPath) meta['交付路径'] = toolInput.outputPath;

  return (
    <ToolDetailShell>
      {task && (
        <ToolSection label="任务">
          <div className="whitespace-pre-wrap break-all text-foreground bg-muted/30 rounded px-2 py-1.5 max-h-60 overflow-auto">
            {task}
          </div>
        </ToolSection>
      )}
      {Object.keys(meta).length > 0 && (
        <ToolSection label="配置">
          <KeyValueList data={meta} />
        </ToolSection>
      )}
      {outputText && (
        <ToolSection label={isError ? '错误' : '输出'}>
          <OutputBox content={outputText} isError={isError} />
        </ToolSection>
      )}
    </ToolDetailShell>
  );
}
