import { ToolDetailShell, ToolSection, OutputBox } from './ToolDetailShell';

interface Props {
  toolInput?: Record<string, any>;
  toolOutput?: any;
  isError?: boolean;
}

export function ReadRenderer({ toolInput, toolOutput, isError }: Props) {
  const filePath: string = toolInput?.file_path ?? toolInput?.path ?? '';
  const offset = toolInput?.offset;
  const limit = toolInput?.limit;
  const rangeText = offset != null && limit != null ? `行 ${offset}-${offset + limit}` : '';

  const outputText =
    typeof toolOutput === 'string'
      ? toolOutput
      : toolOutput != null
        ? JSON.stringify(toolOutput, null, 2)
        : '';

  return (
    <ToolDetailShell>
      <ToolSection label="文件">
        <div className="font-mono text-foreground break-all">
          {filePath}
          {rangeText && <span className="ml-2 text-muted-foreground">· {rangeText}</span>}
        </div>
      </ToolSection>
      {outputText && (
        <ToolSection label="内容">
          <OutputBox content={outputText} isError={isError} maxHeightClass="max-h-96" />
        </ToolSection>
      )}
    </ToolDetailShell>
  );
}
