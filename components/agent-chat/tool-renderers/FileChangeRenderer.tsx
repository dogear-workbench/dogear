import { useMemo } from 'react';
import { Eye } from 'lucide-react';
import { useMarkdownPreviewStore } from '@/stores/markdown-preview-store';
import { PathChip, resolvePathInWorkspace, useWorkspacePath } from '../path-link';
import { useWorkspaceId } from '../workspace-id-context';
import { ToolDetailShell, ToolSection, OutputBox } from './ToolDetailShell';

const MD_EXT_RE = /\.(md|markdown)$/i;
const PREVIEW_EXT_RE = /\.(md|markdown|txt|json)$/i;

interface NormalizedEdit {
  oldText: string;
  newText: string;
}

interface Props {
  kind: 'write' | 'edit';
  toolInput?: Record<string, any>;
  toolOutput?: any;
  isError?: boolean;
}

export function FileChangeRenderer({ kind, toolInput, toolOutput, isError }: Props) {
  const workspaceId = useWorkspaceId();
  const workspacePath = useWorkspacePath(workspaceId);

  const path: string = toolInput?.path ?? toolInput?.file_path ?? '';
  const content: string = typeof toolInput?.content === 'string' ? toolInput.content : '';

  const edits: NormalizedEdit[] = useMemo(() => {
    if (Array.isArray(toolInput?.edits)) {
      return toolInput.edits
        .map((e: any) => ({ oldText: e?.oldText ?? '', newText: e?.newText ?? '' }))
        .filter((e: NormalizedEdit) => e.oldText !== '' || e.newText !== '');
    }
    if (toolInput?.old_string != null || toolInput?.new_string != null) {
      return [{ oldText: toolInput.old_string ?? '', newText: toolInput.new_string ?? '' }];
    }
    return [];
  }, [toolInput]);

  const fileName = path.split(/[\\/]/).pop() || path;
  const resolved = useMemo(
    () => (workspacePath && path && PREVIEW_EXT_RE.test(path) ? resolvePathInWorkspace(path, workspacePath) : null),
    [path, workspacePath],
  );

  const outputText =
    typeof toolOutput === 'string'
      ? toolOutput
      : toolOutput != null
        ? JSON.stringify(toolOutput, null, 2)
        : '';

  const openSnapshot = () => {
    useMarkdownPreviewStore.getState().openInline(fileName, content);
  };

  return (
    <ToolDetailShell>
      {path && (
        <ToolSection label="文件">
          <div className="flex flex-wrap items-baseline gap-1.5 font-mono text-xs">
            {kind === 'edit' && workspaceId && resolved ? (
              <PathChip text={path} resolved={resolved} fileName={fileName} workspaceId={workspaceId} />
            ) : (
              <span className="text-foreground break-all">{path}</span>
            )}
            {kind === 'write' && MD_EXT_RE.test(path) && content && (
              <button
                type="button"
                onClick={openSnapshot}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-sky-200 bg-sky-50 text-xs text-sky-700 hover:bg-sky-100 hover:border-sky-300 transition-colors"
                title="快照预览（渲染写入时的内容，不读盘）"
              >
                <Eye size={12} className="shrink-0" />
                快照预览
              </button>
            )}
          </div>
        </ToolSection>
      )}

      {kind === 'write' && content && (
        <ToolSection label="内容">
          <pre className="font-mono bg-muted/40 text-foreground rounded px-2 py-1.5 whitespace-pre-wrap break-all max-h-80 overflow-auto">
            {content}
          </pre>
        </ToolSection>
      )}

      {kind === 'edit' && edits.length > 0 && (
        <ToolSection label={edits.length > 1 ? `变更（${edits.length} 处）` : '变更'}>
          <div className="space-y-2">
            {edits.map((e, i) => (
              <div key={i} className="space-y-1">
                {edits.length > 1 && (
                  <div className="text-[10px] text-muted-foreground/70">第 {i + 1} 处</div>
                )}
                <pre className="font-mono bg-red-50 text-red-900 border border-red-200/60 rounded px-2 py-1.5 whitespace-pre-wrap break-all max-h-48 overflow-auto">
                  {`- ${e.oldText}`}
                </pre>
                <pre className="font-mono bg-emerald-50 text-emerald-900 border border-emerald-200/60 rounded px-2 py-1.5 whitespace-pre-wrap break-all max-h-48 overflow-auto">
                  {`+ ${e.newText}`}
                </pre>
              </div>
            ))}
          </div>
        </ToolSection>
      )}

      {outputText && (
        <ToolSection label={isError ? '错误' : '输出'}>
          <OutputBox content={outputText} isError={isError} maxHeightClass="max-h-32" />
        </ToolSection>
      )}
    </ToolDetailShell>
  );
}

export function formatByteSize(text: string): string {
  const bytes = new TextEncoder().encode(text).length;
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} 字节`;
}

export function getEditCount(toolInput?: Record<string, any>): number {
  if (Array.isArray(toolInput?.edits)) return toolInput.edits.length;
  if (toolInput?.old_string != null || toolInput?.new_string != null) return 1;
  return 0;
}
