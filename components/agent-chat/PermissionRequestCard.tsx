import { useState } from 'react';
import { Check, X, ShieldAlert, ShieldCheck, Send, MessageSquare, PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { client } from '@/lib/client';
import type { ContentBlock } from './types';

/**
 * 权限确认卡片组件
 * 当 SDK 在 default 模式下请求工具执行权限时显示
 */
export function PermissionRequestCard({
  block,
  sessionId,
  onResolved,
}: {
  block: ContentBlock;
  sessionId: string | null;
  onResolved: (requestId: string, behavior: 'allow' | 'deny' | 'always_allow', denyMessage?: string) => void;
}) {
  const isResolved = !!block.permissionResolved;
  const [showDenyInput, setShowDenyInput] = useState(false);
  const [denyMessage, setDenyMessage] = useState('');
  const [isEditingInput, setIsEditingInput] = useState(false);
  const [editedInput, setEditedInput] = useState('');

  const handleAllow = async () => {
    if (!sessionId || !block.permissionRequestId || isResolved) return;
    await client.respondPermissionRequest({
      sessionId,
      requestId: block.permissionRequestId,
      behavior: 'allow',
    });
    onResolved(block.permissionRequestId, 'allow');
  };

  // 允许并使用修改后的参数
  const handleAllowWithEdits = async () => {
    if (!sessionId || !block.permissionRequestId || isResolved) return;
    try {
      const parsed = JSON.parse(editedInput);
      await client.respondPermissionRequest({
        sessionId,
        requestId: block.permissionRequestId,
        behavior: 'allow',
        updatedInput: parsed,
      });
      onResolved(block.permissionRequestId, 'allow');
    } catch {
      // JSON 解析失败，不做操作
    }
  };

  // 总是允许：allow 当前请求 + 切换到自动执行模式
  const handleAlwaysAllow = async () => {
    if (!sessionId || !block.permissionRequestId || isResolved) return;
    await client.respondPermissionRequest({
      sessionId,
      requestId: block.permissionRequestId,
      behavior: 'allow',
    });
    onResolved(block.permissionRequestId, 'always_allow');
  };

  const handleDeny = async () => {
    if (!sessionId || !block.permissionRequestId || isResolved) return;
    await client.respondPermissionRequest({
      sessionId,
      requestId: block.permissionRequestId,
      behavior: 'deny',
      message: '用户拒绝了此操作',
    });
    onResolved(block.permissionRequestId, 'deny');
  };

  // 带自定义消息的拒绝
  const handleDenyWithMessage = async () => {
    if (!sessionId || !block.permissionRequestId || isResolved || !denyMessage.trim()) return;
    await client.respondPermissionRequest({
      sessionId,
      requestId: block.permissionRequestId,
      behavior: 'deny',
      message: denyMessage.trim(),
    });
    onResolved(block.permissionRequestId, 'deny', denyMessage.trim());
  };

  // 格式化工具输入为简短摘要
  const formatToolInput = (input: any): string => {
    if (!input) return '';
    if (typeof input === 'string') return input;
    if (input.command) return input.command;
    if (input.file_path) return input.file_path;
    if (input.pattern) return input.pattern;
    if (input.content) return input.content.substring(0, 100) + (input.content.length > 100 ? '...' : '');
    return JSON.stringify(input, null, 2).substring(0, 200);
  };

  // 已处理状态的显示文本
  const resolvedText = () => {
    switch (block.permissionResolved) {
      case 'allow': return '已允许执行';
      case 'always_allow': return '已允许执行（已切换自动模式）';
      case 'deny': return '已拒绝执行';
      default: return '';
    }
  };

  // 已处理状态的边框/背景颜色（统一中性色）
  const resolvedStyle = () => {
    if (!isResolved) return 'border-border bg-secondary/50';
    if (block.permissionResolved === 'deny') return 'border-border bg-secondary/30';
    return 'border-border bg-secondary/30';
  };

  return (
    <div className={`rounded-lg border ${resolvedStyle()} p-3`}>
      <div className="flex items-center gap-2 mb-2">
        {isResolved && block.permissionResolved !== 'deny'
          ? <ShieldCheck size={16} className="text-muted-foreground" />
          : <ShieldAlert size={16} className={isResolved ? 'text-destructive' : 'text-foreground'} />
        }
        <span className={`text-sm font-medium ${isResolved ? 'text-muted-foreground' : 'text-foreground'}`}>
          {isResolved ? resolvedText() : '请求执行权限'}
        </span>
        <span className="text-xs px-1.5 py-0.5 bg-muted rounded text-muted-foreground font-mono">
          {block.permissionToolName}
        </span>
      </div>

      {/* 工具输入摘要 */}
      {block.permissionInput && (
        <div className="mb-2 text-xs text-muted-foreground bg-muted rounded p-2 font-mono max-h-32 overflow-y-auto whitespace-pre-wrap">
          {formatToolInput(block.permissionInput)}
        </div>
      )}

      {/* 权限请求原因 */}
      {block.permissionDecisionReason && (
        <div className="mb-2 text-xs text-muted-foreground">
          原因: {block.permissionDecisionReason}
        </div>
      )}

      {/* 已拒绝时显示用户的拒绝理由 */}
      {isResolved && block.permissionResolved === 'deny' && block.permissionDenyMessage && (
        <div className="mb-1 text-xs text-destructive bg-destructive/10 rounded p-2">
          <MessageSquare size={10} className="inline mr-1" />
          {block.permissionDenyMessage}
        </div>
      )}

      {/* 操作按钮 */}
      {!isResolved && (
        <div className="space-y-2 mt-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" onClick={handleAllow}>
              <Check size={12} />
              允许
            </Button>
            <Button variant="outline" size="sm" onClick={handleAlwaysAllow}>
              <ShieldCheck size={12} />
              总是允许
            </Button>
            <Button variant="outline" size="sm" onClick={handleDeny} className="text-destructive hover:bg-destructive/10">
              <X size={12} />
              拒绝
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDenyInput(!showDenyInput)}
              className={showDenyInput ? 'bg-muted' : ''}
            >
              <Send size={12} />
              拒绝并说明
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!isEditingInput) {
                  setEditedInput(JSON.stringify(block.permissionInput, null, 2));
                }
                setIsEditingInput(!isEditingInput);
              }}
              className={isEditingInput ? 'bg-muted' : ''}
            >
              <PenLine size={12} />
              编辑参数
            </Button>
          </div>

          {/* 用户输入拒绝理由 */}
          {showDenyInput && (
            <div className="flex gap-2">
              <Input
                value={denyMessage}
                onChange={(e) => setDenyMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && denyMessage.trim()) handleDenyWithMessage(); }}
                placeholder="输入拒绝理由，AI 会根据你的说明调整..."
                className="flex-1 text-xs"
                autoFocus
              />
              <Button size="sm" onClick={handleDenyWithMessage} disabled={!denyMessage.trim()}>
                <Send size={12} />
                发送
              </Button>
            </div>
          )}

          {/* 编辑工具参数 */}
          {isEditingInput && (
            <div className="space-y-2">
              <Textarea
                value={editedInput}
                onChange={(e) => setEditedInput(e.target.value)}
                className="text-xs font-mono resize-none bg-muted/30"
                rows={6}
                autoFocus
              />
              <Button size="sm" onClick={handleAllowWithEdits}>
                <Check size={12} />
                允许（已修改）
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
