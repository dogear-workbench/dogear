import { CollapsibleBlock } from './CollapsibleBlock';
import { FileEdit, FilePlus, Terminal, Eye } from 'lucide-react';
import { useMarkdownPreviewStore } from '@/stores/markdown-preview-store';
import { ToolDetailShell, ToolSection } from './tool-renderers/ToolDetailShell';

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
        <ToolDetailShell>
          <ToolSection label="文件">
            <div className="font-mono text-foreground break-all">{file}</div>
          </ToolSection>
          <ToolSection label="变更">
            <pre className="font-mono bg-red-50 text-red-900 border border-red-200/60 rounded px-2 py-1.5 whitespace-pre-wrap break-all max-h-48 overflow-auto">
              - {oldStr}
            </pre>
            <pre className="font-mono bg-emerald-50 text-emerald-900 border border-emerald-200/60 rounded px-2 py-1.5 whitespace-pre-wrap break-all max-h-48 overflow-auto">
              + {newStr}
            </pre>
          </ToolSection>
        </ToolDetailShell>
      </CollapsibleBlock>
    );
  }

  if (toolName === 'Write') {
    const file = toolInput?.file_path ?? '';
    const content: string = toolInput?.content ?? '';
    const fileName = file.split(/[\\/]/).pop() || file;
    const isMarkdown = /\.(md|markdown)$/i.test(file);
    const handlePreview = (e: React.MouseEvent) => {
      e.stopPropagation();
      useMarkdownPreviewStore.getState().openInline(fileName, content);
    };
    return (
      <div className="relative">
        <CollapsibleBlock
          icon={<FilePlus className="w-4 h-4 text-emerald-600" />}
          title={`Write · ${fileName}`}
          titleClassName={status === 'error' ? 'text-red-600' : ''}
          defaultOpen={false}
          previewLines={0}
        >
          <ToolDetailShell>
            <ToolSection label="文件">
              <div className="font-mono text-foreground break-all">{file}</div>
            </ToolSection>
            <ToolSection label="内容">
              <pre className="font-mono bg-muted/40 text-foreground rounded px-2 py-1.5 whitespace-pre-wrap break-all max-h-80 overflow-auto">
                {content}
              </pre>
            </ToolSection>
          </ToolDetailShell>
        </CollapsibleBlock>
        {isMarkdown && content && (
          <button
            onClick={handlePreview}
            className="absolute top-0 right-0 flex items-center gap-1 text-xs text-sky-600 hover:text-sky-700 hover:bg-sky-50 rounded px-1.5 py-0.5 transition-colors"
            title="渲染预览"
          >
            <Eye className="w-3.5 h-3.5" />
            预览
          </button>
        )}
      </div>
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
        <ToolDetailShell>
          <ToolSection label="命令">
            <pre className="font-mono bg-zinc-900 text-zinc-100 rounded px-2 py-1.5 whitespace-pre-wrap break-all max-h-32 overflow-auto">
              $ {cmd}
            </pre>
          </ToolSection>
          {toolOutput && (
            <ToolSection label={isError ? '错误' : '输出'}>
              <pre className={`font-mono rounded px-2 py-1.5 whitespace-pre-wrap break-all max-h-80 overflow-auto ${
                isError ? 'bg-red-50 text-red-900 border border-red-200/60' : 'bg-muted/40 text-foreground'
              }`}>
                {toolOutput}
              </pre>
            </ToolSection>
          )}
        </ToolDetailShell>
      </CollapsibleBlock>
    );
  }

  return null;
}
