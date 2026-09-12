import { ToolBlock } from '@/components/ToolBlock';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, ArrowLeftRight } from 'lucide-react';
import { ThinkingBlock } from './ThinkingBlock';
import { AskUserQuestionCard } from './AskUserQuestionCard';
import { PermissionRequestCard } from './PermissionRequestCard';
import { ToolGroupBlock } from './ToolGroupBlock';
import { TaskReportMessage } from './TaskReportMessage';
import { UserActionsCard } from './UserActionsCard';
import { AgentCommCard } from './AgentCommCard';
import { SessionDispatchCard } from './SessionDispatchCard';
import { useCompactCollapseStore } from '@/stores/compact-collapse-store';
import { useConversationStore } from '@/stores/conversation-store';
import { isQuotaErrorText, hasFailoverTakeover } from '@/lib/failover-markers';
import { useConversationId } from './conversation-id-context';
import type { ContentBlock } from './types';

function CompactBoundaryDivider({ block }: { block: ContentBlock }) {
  const conversationId = useConversationId();
  const isCollapsed = useCompactCollapseStore((s) => s.isCollapsed(conversationId));
  const toggle = useCompactCollapseStore((s) => s.toggle);
  return (
    <button
      type="button"
      onClick={() => conversationId && toggle(conversationId)}
      className="flex items-center gap-3 py-2 w-full group/compact"
      title={isCollapsed ? '点击展开此前历史' : '点击折叠此前历史'}
    >
      <div className="flex-1 border-t border-dashed border-border"></div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-secondary px-3 py-1 rounded-full border border-border group-hover/compact:bg-muted transition-colors">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
        对话已压缩
        {block.compactTrigger === 'manual' ? '（手动）' : block.compactTrigger === 'auto' ? '（自动）' : ''}
        {block.compactPreTokens && (
          <span className="text-muted-foreground/60">· 压缩前 {block.compactPreTokens.toLocaleString()} tokens</span>
        )}
        <span className="text-muted-foreground/60 ml-1">· {isCollapsed ? '展开历史' : '折叠历史'}</span>
      </div>
      <div className="flex-1 border-t border-dashed border-border"></div>
    </button>
  );
}

/** 解析错误消息，提取用户友好的标题和描述 */
function parseErrorMessage(error: string): { title: string; description: string; detail?: string } {
  const lower = error.toLowerCase();

  // API 过载
  if (lower.includes('overloaded') || lower.includes('529')) {
    return { title: '模型服务过载', description: '服务器当前繁忙，请稍后重试。', detail: error };
  }

  // 速率限制
  if (lower.includes('rate_limit') || lower.includes('rate limit') || lower.includes('429')) {
    return { title: '请求频率过高', description: '已超出 API 速率限制，请稍候再试。', detail: error };
  }

  // API Key 无效
  if (lower.includes('invalid_api_key') || lower.includes('invalid api key') || lower.includes('401') || lower.includes('authentication')) {
    return { title: 'API Key 无效', description: '请前往设置页面检查 API Key 配置。', detail: error };
  }

  // 上下文长度超限
  if (lower.includes('context_length') || (lower.includes('token') && lower.includes('limit')) || lower.includes('max_tokens')) {
    return { title: '对话长度超出限制', description: '上下文已满，尝试使用 /compact 压缩对话。', detail: error };
  }

  // 网络/超时错误
  if (lower.includes('network') || lower.includes('timeout') || lower.includes('econnrefused') || lower.includes('fetch failed') || lower.includes('enotfound')) {
    return { title: '网络连接失败', description: '无法连接到 API 服务器，请检查网络连接。', detail: error };
  }

  // 权限不足
  if (lower.includes('permission') || lower.includes('403') || lower.includes('forbidden')) {
    return { title: '权限不足', description: 'API 访问被拒绝，请检查账号权限。', detail: error };
  }

  // 服务端错误
  if (lower.includes('500') || lower.includes('internal server error') || lower.includes('502') || lower.includes('503')) {
    return { title: '服务端错误', description: 'API 服务端发生错误，请稍后重试。', detail: error };
  }

  // 默认：如果错误信息较短，直接显示；较长则折叠
  if (error.length <= 100) {
    return { title: '错误', description: error };
  }
  return { title: '错误', description: error.substring(0, 100) + '...', detail: error };
}

function ErrorAlertBlock({ block }: { block: ContentBlock }) {
  const conversationId = useConversationId();
  const notices = useConversationStore(
    (s) => (conversationId ? s.failoverNoticesByConversation[conversationId] : undefined),
  );
  const errorText = block.error || '未知错误';

  // quota 失败且 failover 已接管（notice 在错误后短窗口内到达）：降级为一行摘要，不展示 429 技术详情
  if (isQuotaErrorText(errorText) && hasFailoverTakeover(notices, block.timestamp)) {
    return (
      <div className="my-1 flex items-center gap-2 text-xs text-muted-foreground">
        <ArrowLeftRight size={12} className="flex-shrink-0" />
        <span>请求因供应商费率受限中断，已自动切换模型续跑</span>
      </div>
    );
  }

  const { title, description, detail } = parseErrorMessage(errorText);
  return (
    <Alert variant="destructive" className="my-1">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{description}</p>
        {detail && (
          <details className="mt-2">
            <summary className="text-xs cursor-pointer opacity-70 hover:opacity-100">
              技术详情
            </summary>
            <pre className="mt-1 text-xs bg-destructive/10 rounded p-2 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
              {detail}
            </pre>
          </details>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function ContentBlockItem({ block, sessionId, onPermissionResolved, onAskUserResolved, onInterrupt, searchQuery, activeMatchId, messageId, blockIndex, readOnly = false }: {
  block: ContentBlock;
  sessionId?: string | null;
  onPermissionResolved?: (requestId: string, behavior: 'allow' | 'deny' | 'allow_session') => void;
  onAskUserResolved?: (requestId: string, answers: Record<string, string>) => void;
  onInterrupt?: () => void | Promise<void>;
  searchQuery?: string;
  activeMatchId?: string | null;
  messageId?: string;
  blockIndex?: number;
  readOnly?: boolean;
}) {
  switch (block.type) {
    case 'tool_group':
      return (
        <ToolGroupBlock
          blocks={block.children || []}
          sessionId={sessionId}
          onPermissionResolved={onPermissionResolved}
          onAskUserResolved={onAskUserResolved}
          onInterrupt={onInterrupt}
          searchQuery={searchQuery}
          activeMatchId={activeMatchId}
          messageId={messageId}
          blockIndex={blockIndex}
          readOnly={readOnly}
        />
      );

    case 'tool_use': {
      // toolOutput 已通过 tool_result 合并到 tool_use block 中
      // 通过 toolOutput 是否存在决定状态：undefined=running, 否则success/error
      const toolStatus = block.toolOutput !== undefined
        ? (block.isError ? 'error' : 'success')
        : 'running';
      if (block.toolName === 'dogear__ReportTaskResult') {
        return <TaskReportMessage toolInput={block.toolInput} toolOutput={block.toolOutput} isError={block.isError} />;
      }
      if (block.toolName === 'dogear__TrackUserActions') {
        return <UserActionsCard toolInput={block.toolInput} toolUseId={block.toolUseId} />;
      }
      if (block.toolName === 'dogear__SendMessage') {
        return (
          <AgentCommCard
            toolInput={block.toolInput}
            toolOutput={block.toolOutput}
            isError={block.isError}
            timestamp={block.timestamp}
          />
        );
      }
      if (block.toolName === 'dogear__CreateSession' || block.toolName === 'dogear__CreateSessionBatch') {
        return (
          <SessionDispatchCard
            toolInput={block.toolInput}
            toolOutput={block.toolOutput}
            isError={block.isError}
            timestamp={block.timestamp}
          />
        );
      }
      return (
        <ToolBlock
          toolName={block.toolName || '未知工具'}
          toolInput={block.toolInput}
          toolOutput={block.toolOutput}
          toolUseId={block.toolUseId}
          status={toolStatus}
          isError={block.isError}
        />
      );
    }

    case 'tool_result':
      // tool_result 不独立渲染，结果已整合到对应 tool_use 的 ToolBlock 中
      return null;

    case 'thinking':
      return <ThinkingBlock block={block} />;

    case 'permission_request':
      return (
        <PermissionRequestCard
          block={block}
          sessionId={sessionId || null}
          onResolved={onPermissionResolved || (() => {})}
          readOnly={readOnly}
        />
      );

    case 'ask_user_question':
      return (
        <AskUserQuestionCard
          block={block}
          sessionId={sessionId || null}
          onResolved={onAskUserResolved || (() => {})}
          onInterrupt={onInterrupt}
          readOnly={readOnly}
        />
      );

    // ==================== 斜杠命令相关消息 ====================

    case 'compact_boundary':
      return <CompactBoundaryDivider block={block} />;

    case 'compacting':
      return (
        <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
          <div className="w-1.5 h-1.5 bg-muted-foreground rounded-full"></div>
          正在压缩对话历史...
        </div>
      );

    case 'error':
      return <ErrorAlertBlock block={block} />;

    case 'result':
      // result 类型不显示任何内容，只是标志消息结束
      return null;

    case 'text':
    default:
      return block.content ? (
        <MarkdownRenderer
          content={block.content}
          className="text-sm"
          searchQuery={searchQuery}
          matchIdPrefix={messageId !== undefined && blockIndex !== undefined ? `${messageId}-${blockIndex}` : undefined}
          activeMatchId={activeMatchId}
        />
      ) : null;
  }
}
