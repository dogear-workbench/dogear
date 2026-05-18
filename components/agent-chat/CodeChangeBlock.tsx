import { CollapsibleBlock } from './CollapsibleBlock';
import { FileEdit, FilePlus, Terminal } from 'lucide-react';

interface Props {
  toolName: 'Edit' | 'Write' | 'Bash' | string;
  toolInput: Record<string, any> | undefined;
  toolOutput?: string | undefined;
  isError?: boolean;
}

export function CodeChangeBlock({ toolName, toolInput, toolOutput, isError }: Props) {
  const status: 'running' | 'success' | 'error' =
    toolOutput === undefined ? 'running' : (isError ? 'error' : 'success');

  if (toolName === 'Edit') {
    const file = toolInput?.file_path ?? '';
    const oldStr: string = toolInput?.old_string ?? '';
    const newStr: string = toolInput?.new_string ?? '';
    return (
      <CollapsibleBlock
        icon={<FileEdit className="w-4 h-4 text-amber-600" />}
        title={`Edit · ${file.split(/[\\/]/).pop() || file}`}
        titleClassName={status === 'error' ? 'text-red-600' : ''}
        defaultOpen={false}
        previewLines={0}
      >
        <div className="space-y-1.5 text-xs">
          <div className="font-mono text-muted-foreground break-all">{file}</div>
          <pre className="bg-red-50 text-red-900 rounded px-2 py-1.5 whitespace-pre-wrap break-all max-h-48 overflow-auto">
            - {oldStr}
          </pre>
          <pre className="bg-emerald-50 text-emerald-900 rounded px-2 py-1.5 whitespace-pre-wrap break-all max-h-48 overflow-auto">
            + {newStr}
          </pre>
        </div>
      </CollapsibleBlock>
    );
  }

  if (toolName === 'Write') {
    const file = toolInput?.file_path ?? '';
    const content: string = toolInput?.content ?? '';
    return (
      <CollapsibleBlock
        icon={<FilePlus className="w-4 h-4 text-emerald-600" />}
        title={`Write · ${file.split(/[\\/]/).pop() || file}`}
        titleClassName={status === 'error' ? 'text-red-600' : ''}
        defaultOpen={false}
        previewLines={0}
      >
        <div className="space-y-1.5 text-xs">
          <div className="font-mono text-muted-foreground break-all">{file}</div>
          <pre className="bg-muted/40 rounded px-2 py-1.5 whitespace-pre-wrap break-all max-h-64 overflow-auto">
            {content}
          </pre>
        </div>
      </CollapsibleBlock>
    );
  }

  if (toolName === 'Bash') {
    const cmd: string = toolInput?.command ?? '';
    const cmdSingleLine = cmd.replace(/\s+/g, ' ');
    const cmdTitle = cmdSingleLine.length > 60 ? cmdSingleLine.slice(0, 60) + '…' : cmdSingleLine;
    return (
      <CollapsibleBlock
        icon={<Terminal className="w-4 h-4 text-zinc-700" />}
        title={`Bash · ${cmdTitle}`}
        titleClassName={status === 'error' ? 'text-red-600' : ''}
        defaultOpen={false}
        previewLines={0}
      >
        <div className="space-y-1.5 text-xs">
          <pre className="bg-zinc-900 text-zinc-100 rounded px-2 py-1.5 whitespace-pre-wrap break-all max-h-32 overflow-auto">
            $ {cmd}
          </pre>
          {toolOutput && (
            <pre className="bg-muted/40 rounded px-2 py-1.5 whitespace-pre-wrap break-all max-h-64 overflow-auto">
              {toolOutput}
            </pre>
          )}
        </div>
      </CollapsibleBlock>
    );
  }

  return null;
}
