import { ToolDetailShell, ToolSection, KeyValueList, OutputBox } from './ToolDetailShell';

interface Props {
  toolInput?: Record<string, any>;
  toolOutput?: any;
  isError?: boolean;
}

export function GrepRenderer({ toolInput, toolOutput, isError }: Props) {
  const pattern: string = toolInput?.pattern ?? '';
  const path: string = toolInput?.path ?? '';
  const glob: string = toolInput?.glob ?? '';
  const type: string = toolInput?.type ?? '';
  const outputMode: string = toolInput?.output_mode ?? '';

  const extra = Object.fromEntries(
    Object.entries(toolInput ?? {}).filter(
      ([k]) => !['pattern', 'path', 'glob', 'type', 'output_mode'].includes(k),
    ),
  );

  const outputText =
    typeof toolOutput === 'string'
      ? toolOutput
      : toolOutput != null
        ? JSON.stringify(toolOutput, null, 2)
        : '';

  const lines = outputText ? outputText.split('\n').filter(Boolean) : [];

  return (
    <ToolDetailShell>
      <ToolSection label="模式">
        <div className="flex flex-wrap items-baseline gap-2 font-mono">
          <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200/60">
            {pattern}
          </span>
          {path && <span className="text-muted-foreground">in {path}</span>}
          {glob && <span className="text-muted-foreground">glob={glob}</span>}
          {type && <span className="text-muted-foreground">type={type}</span>}
          {outputMode && <span className="text-muted-foreground">mode={outputMode}</span>}
        </div>
        {Object.keys(extra).length > 0 && (
          <div className="pt-1">
            <KeyValueList data={extra} />
          </div>
        )}
      </ToolSection>

      {outputText && (
        <ToolSection label={`命中${isError ? '' : ` (${lines.length})`}`}>
          {isError ? (
            <OutputBox content={outputText} isError maxHeightClass="max-h-60" />
          ) : (
            <div className="font-mono text-foreground space-y-0.5 max-h-80 overflow-auto break-all">
              {lines.map((l, i) => (
                <div key={i}>{highlightPattern(l, pattern)}</div>
              ))}
            </div>
          )}
        </ToolSection>
      )}
    </ToolDetailShell>
  );
}

function highlightPattern(line: string, pattern: string) {
  if (!pattern) return line;
  try {
    const re = new RegExp(`(${pattern})`, 'gi');
    const parts = line.split(re);
    return parts.map((part, i) =>
      i % 2 === 1 ? (
        <mark key={i} className="bg-amber-200/60 text-foreground rounded px-0.5">
          {part}
        </mark>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
  } catch {
    return line;
  }
}
