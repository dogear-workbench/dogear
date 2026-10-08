import { ToolDetailShell, ToolSection, KeyValueList, OutputBox } from './ToolDetailShell';
import { PathChip, resolvePathInWorkspace, useWorkspacePath } from '../path-link';
import { useWorkspaceId } from '../workspace-id-context';

const PREVIEW_EXT_RE = /\.(md|markdown|txt|json)$/i;
const HIT_LINE_RE = /^(.+?):(\d+):(.*)$/;

interface Props {
  toolInput?: Record<string, any>;
  toolOutput?: any;
  isError?: boolean;
}

export function GrepRenderer({ toolInput, toolOutput, isError }: Props) {
  const workspaceId = useWorkspaceId();
  const workspacePath = useWorkspacePath(workspaceId);

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

  const renderHitLine = (line: string) => {
    const m = workspacePath ? HIT_LINE_RE.exec(line) : null;
    const filePath = m?.[1] ?? '';
    const resolved =
      m && workspacePath && PREVIEW_EXT_RE.test(filePath)
        ? resolvePathInWorkspace(filePath, workspacePath)
        : null;
    if (m && workspaceId && resolved) {
      return (
        <>
          <PathChip resolved={resolved} workspaceId={workspaceId} />
          <span className="text-muted-foreground">:{m[2]}:</span>
          <span>{highlightPattern(m[3], pattern)}</span>
        </>
      );
    }
    return highlightPattern(line, pattern);
  };

  return (
    <ToolDetailShell>
      <ToolSection label="模式">
        <div className="flex flex-wrap items-baseline gap-2 font-mono">
          <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200/60 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60">
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
            <div className="font-mono text-xs text-foreground space-y-0.5 max-h-80 overflow-auto break-all">
              {lines.map((l, i) => (
                <div key={i}>{renderHitLine(l)}</div>
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
        <mark key={i} className="bg-amber-200/60 text-foreground rounded px-0.5 dark:bg-amber-500/30">
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
