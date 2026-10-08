import { ToolDetailShell, ToolSection, OutputBox } from './ToolDetailShell';
import { PathChip, resolvePathInWorkspace, useWorkspacePath } from '../path-link';
import { useWorkspaceId } from '../workspace-id-context';

const PREVIEW_EXT_RE = /\.(md|markdown|txt|json)$/i;

interface Props {
  toolInput?: Record<string, any>;
  toolOutput?: any;
  isError?: boolean;
}

export function ReadRenderer({ toolInput, toolOutput, isError }: Props) {
  const workspaceId = useWorkspaceId();
  const workspacePath = useWorkspacePath(workspaceId);

  const filePath: string = toolInput?.file_path ?? toolInput?.path ?? '';
  const offset = toolInput?.offset;
  const limit = toolInput?.limit;
  const rangeText = offset != null && limit != null ? `行 ${offset}-${offset + limit}` : '';

  const resolved =
    workspacePath && filePath && PREVIEW_EXT_RE.test(filePath)
      ? resolvePathInWorkspace(filePath, workspacePath)
      : null;

  const outputText =
    typeof toolOutput === 'string'
      ? toolOutput
      : toolOutput != null
        ? JSON.stringify(toolOutput, null, 2)
        : '';

  return (
    <ToolDetailShell>
      {filePath && (
        <ToolSection label="文件">
          <div className="flex flex-wrap items-baseline gap-1.5 font-mono text-foreground break-all">
            {workspaceId && resolved ? (
              <PathChip
                resolved={resolved}
                fileName={filePath.split(/[\\/]/).pop() || filePath}
                workspaceId={workspaceId}
              />
            ) : (
              <span className="break-all">{filePath}</span>
            )}
            {rangeText && <span className="text-muted-foreground">· {rangeText}</span>}
          </div>
        </ToolSection>
      )}
      {outputText && (
        <ToolSection label="内容">
          <OutputBox content={outputText} isError={isError} maxHeightClass="max-h-96" />
        </ToolSection>
      )}
    </ToolDetailShell>
  );
}
