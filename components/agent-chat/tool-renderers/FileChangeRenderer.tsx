import { useMemo } from 'react';
import { PathChip, resolvePathInWorkspace, useWorkspacePath } from '../path-link';
import { useWorkspaceId } from '../workspace-id-context';
import { ToolDetailShell, ToolSection, OutputBox } from './ToolDetailShell';
import { buildDiffRows, splitLines, type DiffLineType, type DiffRow } from './line-diff';

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

function normalizeEdits(toolInput?: Record<string, any>): NormalizedEdit[] {
  if (Array.isArray(toolInput?.edits)) {
    return toolInput.edits
      .map((e: any) => ({ oldText: e?.oldText ?? '', newText: e?.newText ?? '' }))
      .filter((e: NormalizedEdit) => e.oldText !== '' || e.newText !== '');
  }
  if (toolInput?.old_string != null || toolInput?.new_string != null) {
    return [{ oldText: toolInput.old_string ?? '', newText: toolInput.new_string ?? '' }];
  }
  return [];
}

export function FileChangeRenderer({ kind, toolInput, toolOutput, isError }: Props) {
  const workspaceId = useWorkspaceId();
  const workspacePath = useWorkspacePath(workspaceId);

  const path: string = toolInput?.path ?? toolInput?.file_path ?? '';
  const content: string = typeof toolInput?.content === 'string' ? toolInput.content : '';

  const edits = useMemo(() => normalizeEdits(toolInput), [toolInput]);
  const editRowsList = useMemo(() => edits.map((e) => buildDiffRows(e.oldText, e.newText)), [edits]);

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

  return (
    <ToolDetailShell>
      {path && (
        <ToolSection label="文件">
          <div className="flex flex-wrap items-baseline gap-1.5 font-mono text-xs">
            {kind === 'edit' && workspaceId && resolved ? (
              <PathChip resolved={resolved} fileName={fileName} workspaceId={workspaceId} />
            ) : (
              <span className="text-foreground break-all">{path}</span>
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
                {editRowsList[i] ? (
                  <DiffRowsView rows={editRowsList[i]} />
                ) : (
                  <div className="space-y-1">
                    <div className="text-[10px] text-muted-foreground/70">内容过长，按整块对比显示</div>
                    <pre className="font-mono bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-300 border border-red-200/60 dark:border-red-900/60 rounded px-2 py-1.5 whitespace-pre-wrap break-all max-h-48 overflow-auto">
                      {e.oldText}
                    </pre>
                    <pre className="font-mono bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-900/60 rounded px-2 py-1.5 whitespace-pre-wrap break-all max-h-48 overflow-auto">
                      {e.newText}
                    </pre>
                  </div>
                )}
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

export function getEditLineStats(
  toolInput?: Record<string, any>,
): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const e of normalizeEdits(toolInput)) {
    removed += splitLines(e.oldText).length;
    added += splitLines(e.newText).length;
  }
  return { added, removed };
}

const ROW_STYLES: Record<DiffLineType, string> = {
  context: 'text-muted-foreground',
  remove: 'bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-300',
  add: 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
};

const ROW_PREFIX: Record<DiffLineType, string> = {
  context: ' ',
  remove: '−',
  add: '+',
};

function DiffRowsView({ rows }: { rows: DiffRow[] }) {
  return (
    <div className="font-mono text-xs bg-muted/20 border border-border rounded overflow-hidden max-h-72 overflow-y-auto">
      {rows.map((row, i) => (
        <div
          key={i}
          className={`flex gap-1.5 px-2 py-px whitespace-pre-wrap break-all ${ROW_STYLES[row.type]}`}
        >
          <span className="select-none shrink-0">{ROW_PREFIX[row.type]}</span>
          <span>
            {row.segments.map((seg, k) =>
              seg.highlight ? (
                <span
                  key={k}
                  className={
                    row.type === 'remove'
                      ? 'bg-red-200/80 dark:bg-red-800/60 rounded-sm'
                      : 'bg-emerald-200/80 dark:bg-emerald-800/60 rounded-sm'
                  }
                >
                  {seg.text}
                </span>
              ) : (
                <span key={k}>{seg.text}</span>
              ),
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
