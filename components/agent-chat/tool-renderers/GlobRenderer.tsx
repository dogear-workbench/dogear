import { ToolDetailShell, ToolSection, OutputBox } from './ToolDetailShell';
import { PathChip, resolvePathInWorkspace, useWorkspacePath } from '../path-link';
import { useWorkspaceId } from '../workspace-id-context';

const PREVIEW_EXT_RE = /\.(md|markdown|txt|json)$/i;

interface Props {
  toolInput?: Record<string, any>;
  toolOutput?: any;
  isError?: boolean;
}

export function GlobRenderer({ toolInput, toolOutput, isError }: Props) {
  const workspaceId = useWorkspaceId();
  const workspacePath = useWorkspacePath(workspaceId);

  const pattern: string = toolInput?.pattern ?? '';
  const path: string = toolInput?.path ?? '';

  const outputText =
    typeof toolOutput === 'string'
      ? toolOutput
      : toolOutput != null
        ? JSON.stringify(toolOutput, null, 2)
        : '';

  const files = outputText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const renderFileLine = (f: string) => {
    const resolved =
      workspacePath && PREVIEW_EXT_RE.test(f) ? resolvePathInWorkspace(f, workspacePath) : null;
    if (workspaceId && resolved) {
      return <PathChip resolved={resolved} workspaceId={workspaceId} />;
    }
    return <span className="break-all">{f}</span>;
  };

  return (
    <ToolDetailShell>
      <ToolSection label="模式">
        <div className="flex flex-wrap items-baseline gap-2 font-mono">
          <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200/60 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800/60">
            {pattern}
          </span>
          {path && <span className="text-muted-foreground">in {path}</span>}
        </div>
      </ToolSection>

      {outputText && (
        <ToolSection label={`匹配${isError ? '' : ` (${files.length})`}`}>
          {isError ? (
            <OutputBox content={outputText} isError maxHeightClass="max-h-60" />
          ) : (
            <div className="text-foreground space-y-0.5 max-h-80 overflow-auto break-all">
              {files.map((f, i) => (
                <div key={i} className="font-mono text-xs">{renderFileLine(f)}</div>
              ))}
            </div>
          )}
        </ToolSection>
      )}
    </ToolDetailShell>
  );
}
