import { Check, X, ShieldAlert, ShieldCheck, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { client } from '@/lib/client';
import { useConversationStore } from '@/stores/conversation-store';
import { BASIC_TOOL_NAMES } from '@/types/settings';
import type { PermissionWaitRecord } from '@/types/usage';
import type { ContentBlock } from './types';

const BASIC_TOOL_SET = new Set<string>(BASIC_TOOL_NAMES);

export function PermissionRequestCard({
  block,
  sessionId,
  onResolved,
  readOnly = false,
}: {
  block: ContentBlock;
  sessionId: string | null;
  onResolved: (requestId: string, behavior: 'allow' | 'deny' | 'allow_session') => void;
  readOnly?: boolean;
}) {
  const isResolved = !!block.permissionResolved;

  const isBasicTool = !!block.permissionToolName && BASIC_TOOL_SET.has(block.permissionToolName);

  const reportWait = (decision: PermissionWaitRecord['decision']) => {
    const cid = useConversationStore.getState().selectedConversation?.id;
    const requestedAt = block.timestamp;
    const toolName = block.permissionToolName;
    if (!cid || !requestedAt || !toolName) return;
    client.recordPermissionWait({
      conversationId: cid,
      record: {
        toolName,
        decision,
        waitMs: Date.now() - requestedAt,
        requestedAt,
      },
    }).catch(() => {});
  };

  const handleAllow = async () => {
    if (readOnly || !sessionId || !block.permissionRequestId || isResolved) return;
    await client.respondPermissionRequest({
      sessionId,
      requestId: block.permissionRequestId,
      behavior: 'allow',
    });
    reportWait('allow');
    onResolved(block.permissionRequestId, 'allow');
  };

  const handleAllowSession = async () => {
    if (readOnly || !sessionId || !block.permissionRequestId || isResolved) return;
    await client.respondPermissionRequest({
      sessionId,
      requestId: block.permissionRequestId,
      behavior: 'allow_session',
    });
    reportWait('allow_session');
    onResolved(block.permissionRequestId, 'allow_session');
  };

  const handleDeny = async () => {
    if (readOnly || !sessionId || !block.permissionRequestId || isResolved) return;
    await client.respondPermissionRequest({
      sessionId,
      requestId: block.permissionRequestId,
      behavior: 'deny',
      message: '用户拒绝了此操作',
    });
    reportWait('deny');
    onResolved(block.permissionRequestId, 'deny');
  };

  const formatToolInput = (input: any): string => {
    if (!input) return '';
    if (typeof input === 'string') return input;
    if (input.command) return input.command;
    if (input.file_path) return input.file_path;
    if (input.pattern) return input.pattern;
    if (input.content) return input.content.substring(0, 100) + (input.content.length > 100 ? '...' : '');
    return JSON.stringify(input, null, 2).substring(0, 200);
  };

  const resolvedText = () => {
    switch (block.permissionResolved) {
      case 'allow': return '已允许执行';
      case 'always_allow': return '已允许执行';
      case 'allow_session': return '已允许执行（本会话内放行）';
      case 'deny': return '已拒绝执行';
      default: return '';
    }
  };

  return (
    <div className="py-2">
      <div className="flex items-center gap-2 mb-2">
        {isResolved && block.permissionResolved !== 'deny'
          ? <ShieldCheck size={16} className={isResolved ? 'text-muted-foreground/50' : 'text-emerald-500'} />
          : <ShieldAlert size={16} className={isResolved ? 'text-muted-foreground/50' : 'text-amber-500'} />
        }
        <span className={`text-sm font-medium ${isResolved ? 'text-muted-foreground/60' : 'text-foreground'}`}>
          {isResolved ? resolvedText() : '请求执行权限'}
        </span>
        <span className="text-xs px-1.5 py-0.5 bg-muted rounded text-muted-foreground font-mono">
          {block.permissionToolName}
        </span>
      </div>

      {block.permissionInput && (
        <div className="mb-2 text-xs text-muted-foreground bg-muted rounded p-2 font-mono max-h-32 overflow-y-auto whitespace-pre-wrap">
          {formatToolInput(block.permissionInput)}
        </div>
      )}

      {block.permissionDecisionReason && (
        <div className="mb-2 text-xs text-muted-foreground">
          原因: {block.permissionDecisionReason}
        </div>
      )}

      {!isResolved && !readOnly && (
        <div className="flex items-center gap-2 flex-wrap mt-2">
          <Button size="sm" onClick={handleAllow}>
            <Check size={12} />
            允许一次
          </Button>
          {isBasicTool && (
            <Button variant="outline" size="sm" onClick={handleAllowSession} title="仅本会话内放行，关闭会话即失效">
              <Clock size={12} />
              本会话允许
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleDeny} className="text-destructive hover:bg-destructive/10">
            <X size={12} />
            拒绝
          </Button>
        </div>
      )}
    </div>
  );
}
