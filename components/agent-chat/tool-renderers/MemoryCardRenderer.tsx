import { ToolDetailShell, ToolSection, KeyValueList, OutputBox, ChipList } from './ToolDetailShell';

interface Props {
  toolInput?: Record<string, any>;
  toolOutput?: any;
  isError?: boolean;
}

function toOutputText(toolOutput: any): string {
  if (typeof toolOutput === 'string') return toolOutput;
  return toolOutput != null ? JSON.stringify(toolOutput, null, 2) : '';
}

export function MemoryCardRenderer({ toolInput, toolOutput, isError }: Props) {
  const outputText = toOutputText(toolOutput);
  const slug = typeof toolInput?.slug === 'string' ? toolInput.slug : '';
  const isSave = typeof toolInput?.content === 'string';

  if (!isSave) {
    return (
      <ToolDetailShell>
        <ToolSection label="删除记忆">
          <KeyValueList data={{ slug }} />
        </ToolSection>
        {outputText && (
          <ToolSection label={isError ? '错误' : '输出'}>
            <OutputBox content={outputText} isError={isError} maxHeightClass="max-h-32" />
          </ToolSection>
        )}
      </ToolDetailShell>
    );
  }

  const title = typeof toolInput?.title === 'string' ? toolInput.title : '';
  const keywords = Array.isArray(toolInput?.keywords)
    ? toolInput.keywords.filter((k: any) => typeof k === 'string')
    : [];

  return (
    <ToolDetailShell>
      <ToolSection label="主题">
        <div className="text-foreground font-medium break-all">{title}</div>
        <div className="font-mono text-[10px] text-muted-foreground break-all">{slug}</div>
      </ToolSection>
      <ToolSection label="关键词">
        <ChipList items={keywords} />
      </ToolSection>
      <ToolSection label="正文">
        <div className="whitespace-pre-wrap break-all text-foreground/90 line-clamp-3">
          {toolInput?.content}
        </div>
      </ToolSection>
      {outputText && (
        <ToolSection label={isError ? '错误' : '输出'}>
          <OutputBox content={outputText} isError={isError} maxHeightClass="max-h-32" />
        </ToolSection>
      )}
    </ToolDetailShell>
  );
}
