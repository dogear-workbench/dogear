import { CheckCircle2 } from 'lucide-react';
import { ToolDetailShell, ToolSection, KeyValueList, OutputBox } from './ToolDetailShell';

interface Props {
  toolInput?: Record<string, any>;
  toolOutput?: any;
  isError?: boolean;
}

function toOutputText(toolOutput: any): string {
  if (typeof toolOutput === 'string') return toolOutput;
  return toolOutput != null ? JSON.stringify(toolOutput, null, 2) : '';
}

function MessageBody({ content, boxed }: { content: string; boxed?: boolean }) {
  return (
    <div
      className={
        boxed
          ? 'whitespace-pre-wrap break-all text-foreground/90 max-h-40 overflow-y-auto bg-muted/30 rounded px-2 py-1.5'
          : 'whitespace-pre-wrap break-all text-foreground/90 max-h-40 overflow-y-auto'
      }
    >
      {content}
    </div>
  );
}

export function DeliveryCardRenderer({ toolInput, toolOutput, isError }: Props) {
  const outputText = toOutputText(toolOutput);
  const message = typeof toolInput?.message === 'string' ? toolInput.message : '';
  const toSessionId = typeof toolInput?.toSessionId === 'string' ? toolInput.toSessionId : '';

  const outputSection = outputText ? (
    <ToolSection label={isError ? '错误' : '输出'}>
      <OutputBox content={outputText} isError={isError} maxHeightClass="max-h-32" />
    </ToolSection>
  ) : null;

  if (toolInput?.options?.delivery !== true) {
    return (
      <ToolDetailShell>
        <ToolSection label="发送消息">
          <KeyValueList data={{ 目标会话: toSessionId }} />
        </ToolSection>
        {message && (
          <ToolSection label="消息">
            <MessageBody content={message} boxed />
          </ToolSection>
        )}
        {outputSection}
      </ToolDetailShell>
    );
  }

  return (
    <div className="space-y-2 text-xs rounded-md border border-green-300/60 bg-green-50/70 dark:bg-green-950/20 dark:border-green-800/60 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-green-700 dark:text-green-300">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        <span className="text-[10px] uppercase tracking-wider font-medium">交付</span>
      </div>
      {message && (
        <ToolSection label="交付摘要">
          <MessageBody content={message} />
        </ToolSection>
      )}
      <ToolSection label="交付目标">
        <div className="font-mono break-all text-muted-foreground">{toSessionId || '（未知会话）'}</div>
      </ToolSection>
      {outputSection}
    </div>
  );
}
