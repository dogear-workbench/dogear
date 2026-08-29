import { useState, memo } from 'react';
import { GitBranch, FileText, Bot, ChevronDown, ChevronUp, MessageSquare, Settings2, ArrowLeftRight, Folder, Share2, StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { ContentBlockItem } from './ContentBlockItem';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { parseUserMessageReferences, formatModelName, parseSlashCommandMessage, isSdkInjectedUserMessage } from './utils';
import { isFailoverContinueMessage, stripFailoverContinueSentinel } from '@/lib/failover-markers';
import { highlightText } from './highlight';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { Message, ContentBlock } from './types';

/** failover 续跑提示（主进程注入的哨兵 user 消息）：系统提示条样式，剥掉哨兵不显示 */
function FailoverContinueNotice({ content, timestamp }: { content: string; timestamp?: number }) {
  return (
    <div className="w-full my-2 flex items-center gap-2 px-3 py-1.5 rounded-md bg-secondary/60 border border-dashed border-border text-xs text-muted-foreground">
      <ArrowLeftRight size={12} className="flex-shrink-0" />
      <span className="flex-1 min-w-0">{stripFailoverContinueSentinel(content)}</span>
      {typeof timestamp === 'number' && (
        <span className="text-muted-foreground/60 flex-shrink-0">{new Date(timestamp).toLocaleTimeString()}</span>
      )}
    </div>
  );
}

/**
 * 将连续的 tool_use（中间可夹 thinking）合并为 tool_group 虚拟 block。
 * - ≥2 个工具才分组；单个工具 / 单个 thinking / Task/Agent 子代理 不分组
 * - 遇到 text / permission_request / ask_user_question 等其他类型 → 结束当前分组
 */
function groupBlocks(blocks: ContentBlock[]): ContentBlock[] {
  const result: ContentBlock[] = [];
  let buffer: ContentBlock[] = [];
  let toolCount = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    if (toolCount >= 2) {
      result.push({
        type: 'tool_group',
        children: buffer,
        timestamp: buffer[0].timestamp,
      });
    } else {
      result.push(...buffer);
    }
    buffer = [];
    toolCount = 0;
  };

  for (const block of blocks) {
    if (block.type === 'tool_use') {
      buffer.push(block);
      toolCount++;
    } else if (block.type === 'thinking' && buffer.length > 0) {
      buffer.push(block);
    } else {
      flush();
      result.push(block);
    }
  }
  flush();
  return result;
}

export const MessageItem = memo(function MessageItem({
  message,
  messageId,
  onFork,
  sessionId,
  onPermissionResolved,
  onAskUserResolved,
  onInterrupt,
  searchQuery,
  activeMatchId,
  isAgentConversation,
  readOnly = false,
}: {
  message: Message;
  messageId?: string;
  onFork?: (assistantSdkUuid: string) => void;
  sessionId?: string | null;
  onPermissionResolved?: (requestId: string, behavior: 'allow' | 'deny' | 'allow_session') => void;
  onAskUserResolved?: (requestId: string, answers: Record<string, string>) => void;
  onInterrupt?: () => void | Promise<void>;
  searchQuery?: string;
  activeMatchId?: string | null;
  /** 当前会话是否 agent 会话（用于判断"用户介入"徽章） */
  isAgentConversation?: boolean;
  readOnly?: boolean;
}) {
  const isUser = message.role === 'user';
  const displayMode = useSettingsStore(s => s.settings?.ui?.messageDisplayMode ?? 'compact');
  const currentWorkspaceId = useWorkspaceStore(s => s.workspace?.id);

  // sticky 展开/收起状态（用户消息默认折叠为 2 行）
  const [isStickyExpanded, setIsStickyExpanded] = useState(false);

  // 压缩摘要消息：特殊卡片样式
  if (message.isCompactSummary) {
    return (
      <div className="w-full py-2 group">
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-secondary border border-border text-xs text-muted-foreground hover:bg-muted transition-colors cursor-pointer">
            <FileText size={14} />
            <span className="font-medium">压缩摘要</span>
            <span className="text-muted-foreground/60 ml-auto">点击展开</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-1 px-3 py-2 rounded-lg bg-secondary/50 border border-border text-xs text-foreground whitespace-pre-wrap max-h-[400px] overflow-y-auto">
              {message.content}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    );
  }

  // failover 续跑提示：哨兵前缀标识，渲染为系统提示条而非用户气泡
  if (isUser && isFailoverContinueMessage(message.content)) {
    return <FailoverContinueNotice content={message.content} timestamp={message.timestamp} />;
  }

  // SDK 注入的用户消息（/model 命令、命令输出等）：渲染为居中内联系统指示，
  // 不进 sticky 气泡，不挂 data-message-id（避免 Minimap 把它当用户轮次）
  if (isUser && isSdkInjectedUserMessage(message.content)) {
    const slashCmd = parseSlashCommandMessage(message.content);
    const parsed = parseUserMessageReferences(message.content);
    const modelArg = (slashCmd.isCommand && slashCmd.commandName === 'model')
      ? slashCmd.commandArgs
      : parsed.modelSwitch;
    if (modelArg) {
      return (
        <div className="w-full my-2 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Settings2 className="w-3.5 h-3.5" />
          <span>切换模型至</span>
          <Badge variant="subtle" className="h-5 rounded-md text-xs font-medium">
            {formatModelName(modelArg)}
          </Badge>
          {message.timestamp && (
            <span className="text-muted-foreground/60">
              {new Date(message.timestamp).toLocaleTimeString()}
            </span>
          )}
        </div>
      );
    }
    // 其他 SDK 注入命令兜底：渲染为命令芯片
    if (slashCmd.isCommand) {
      return (
        <div className="w-full my-2 flex items-center justify-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-secondary border border-border rounded-md text-xs text-muted-foreground font-mono">
            <span className="text-muted-foreground/60">/</span>
            {slashCmd.commandName}
            {slashCmd.commandArgs && (
              <span className="text-muted-foreground ml-1">{slashCmd.commandArgs}</span>
            )}
          </span>
        </div>
      );
    }
    return null;
  }

  return (
    <div
      className={cn(
        'w-full my-2 group',
        // sticky 在最外层: 用 margin 而非 padding,避免 padding 区出现多余底色
        isUser && 'sticky top-0 z-10',
      )}
      data-message-id={message.id ?? messageId}
    >
      {isUser ? (
        // 用户消息: 加粗外框+阴影+完全不透明,遮挡后面滚过的 AI 回答
        <div className="relative border-2 border-muted-foreground/25 rounded-lg px-4 py-2 bg-background shadow-md">
          {message.source === 'wechat-bot' && (
            <Bot className="w-3 h-3 text-green-500 absolute top-2 right-2" />
          )}
          <div className="min-w-0">
            {(
              // SDK 注入的命令已在上方提前 return，此处只处理真实用户输入
              (() => {
                const parsed = parseUserMessageReferences(message.content);
                const hasRefs =
                  parsed.articleRefs.length > 0 ||
                  parsed.snippetRefs.length > 0 ||
                  parsed.fileRefs.length > 0 ||
                  parsed.conversationRefs.length > 0 ||
                  parsed.sharedFileRefs.length > 0 ||
                  parsed.noteRefs.length > 0;
                return (
                  <div className="relative">
                    {/* Sender 徽章：agent 跨会话消息 / 用户在 agent 会话里介入 */}
                    {parsed.senderKind === 'agent' && (
                      <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
                        <Bot className="w-3 h-3 flex-shrink-0" />
                        <span>来自</span>
                        <span className="font-medium truncate max-w-[200px]">
                          {parsed.senderDisplayName ?? '未知会话'}
                        </span>
                        {parsed.senderIsDelivery && (
                          <span className="px-1.5 py-0.5 rounded bg-green-50 text-green-700 text-[10px] dark:bg-green-900/30 dark:text-green-300">交付</span>
                        )}
                      </div>
                    )}
                    {isAgentConversation && !parsed.senderKind && (
                      <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
                        <MessageSquare className="w-3 h-3 flex-shrink-0" />
                        <span>你</span>
                      </div>
                    )}
                    {/* 引用芯片（只读，无关闭按钮） */}
                    {hasRefs && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {parsed.articleRefs.map((ref, i) => (
                          <span
                            key={`article-${i}`}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-sky-50 border border-sky-200 rounded-full text-xs text-sky-700"
                            title={ref.title}
                          >
                            <span className="max-w-[160px] truncate">{ref.title}</span>
                            {ref.siteName && <span className="text-sky-400 flex-shrink-0">- {ref.siteName}</span>}
                          </span>
                        ))}
                        {parsed.snippetRefs.map((ref, i) => (
                          <span
                            key={`snippet-${i}`}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 border border-slate-200 rounded-full text-xs text-slate-600"
                            title={`来自《${ref.articleTitle}》: ${ref.text}`}
                          >
                            <span className="max-w-[120px] truncate">{`"${ref.text}"`}</span>
                            <span className="text-slate-400 flex-shrink-0">- {ref.articleTitle.length > 8 ? ref.articleTitle.slice(0, 8) + '...' : ref.articleTitle}</span>
                          </span>
                        ))}
                        {parsed.fileRefs.map((ref, i) => (
                          <span
                            key={`file-${i}`}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-teal-50 border border-teal-200 rounded-full text-xs text-teal-700"
                            title={ref.path}
                          >
                            {ref.type === 'folder'
                              ? <Folder className="w-3 h-3 flex-shrink-0" />
                              : <FileText className="w-3 h-3 flex-shrink-0" />}
                            <span className="max-w-[160px] truncate">{ref.name}</span>
                          </span>
                        ))}
                        {parsed.conversationRefs.map((ref, i) => (
                          <span
                            key={`conv-${i}`}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-purple-50 border border-purple-200 rounded-full text-xs text-purple-700"
                            title={ref.title}
                          >
                            <MessageSquare className="w-3 h-3 flex-shrink-0" />
                            <span className="max-w-[160px] truncate">{ref.title}</span>
                            {ref.workspaceId && ref.workspaceId !== currentWorkspaceId && (
                              <span className="px-1 rounded bg-purple-100 text-purple-500 text-[10px] flex-shrink-0">跨工作区</span>
                            )}
                          </span>
                        ))}
                        {parsed.sharedFileRefs.map((ref, i) => (
                          <span
                            key={`shared-file-${i}`}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 border border-amber-200 rounded-full text-xs text-amber-700"
                            title={ref.absPath}
                          >
                            <Share2 className="w-3 h-3 flex-shrink-0" />
                            <span className="max-w-[160px] truncate">{`共享文件 · ${ref.relPath}`}</span>
                          </span>
                        ))}
                        {parsed.noteRefs.map((ref, i) => (
                          <span
                            key={`note-${i}`}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-rose-50 border border-rose-200 rounded-full text-xs text-rose-700"
                            title={`引用笔记: ${ref.title}`}
                          >
                            <StickyNote className="w-3 h-3 flex-shrink-0" />
                            <span className="max-w-[160px] truncate">{ref.title}</span>
                          </span>
                        ))}
                      </div>
                    )}
                    {/* 消息文本：默认 2 行折叠，通过右下角 chevron 按钮展开 */}
                    <div
                      className={cn(
                        "whitespace-pre-wrap break-words text-sm text-foreground",
                        !isStickyExpanded && "line-clamp-2",
                        isStickyExpanded && "max-h-[40vh] overflow-y-auto"
                      )}
                    >
                      {searchQuery && messageId
                        ? highlightText(parsed.userMessage, searchQuery, `${messageId}-u`, activeMatchId ?? null)
                        : parsed.userMessage
                      }
                    </div>
                    {/* 用户附带的图片缩略图 */}
                    {message.images && message.images.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {message.images.map((img, i) => (
                          <img
                            key={i}
                            src={img.preview}
                            alt={`附件 ${i + 1}`}
                            className="w-20 h-20 object-cover rounded-md border border-border"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()
            )}
            {message.timestamp && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                <span>{new Date(message.timestamp).toLocaleTimeString()}</span>
                {message.isQueued && (
                  <span className="text-muted-foreground/50 text-[10px]">排队中</span>
                )}
              </div>
            )}
          </div>
          {/* 展开/收起按钮：右下角 chevron，避免选文字时意外触发 */}
          <button
            onClick={() => setIsStickyExpanded(v => !v)}
            className="absolute bottom-1 right-2 p-0.5 rounded hover:bg-muted/50 transition-colors"
            title={isStickyExpanded ? '收起' : '展开'}
          >
            {isStickyExpanded
              ? <ChevronUp size={12} className="text-muted-foreground/60" />
              : <ChevronDown size={12} className="text-muted-foreground/60" />
            }
          </button>
        </div>
      ) : (
        // AI 助手消息：无头像无外框，正文平齐左边缘
        <div className="min-w-0">
            {/* 模型名 badge：显示在消息正文上方 */}
            {message.model && (
              <Badge variant="subtle" className="mb-1 h-5 rounded-md text-xs font-medium">
                {formatModelName(message.model)}
              </Badge>
            )}
            {/* 按照接收顺序渲染所有内容块 */}
            {(() => {
              const blocksToRender = (message.contentBlocks && displayMode === 'compact')
                ? groupBlocks(message.contentBlocks)
                : (message.contentBlocks || []);
              return blocksToRender.length > 0 ? (
                <div className="space-y-2">
                  {blocksToRender.map((block, idx) => (
                    <ContentBlockItem
                      key={idx}
                      block={block}
                      blockIndex={idx}
                      sessionId={sessionId}
                      onPermissionResolved={onPermissionResolved}
                      onAskUserResolved={onAskUserResolved}
                      onInterrupt={onInterrupt}
                      searchQuery={searchQuery}
                      activeMatchId={activeMatchId}
                      messageId={messageId}
                      readOnly={readOnly}
                    />
                  ))}
                </div>
              ) : message.content ? (
                <MarkdownRenderer
                  content={message.content}
                  className="text-sm"
                  searchQuery={searchQuery}
                  matchIdPrefix={messageId !== undefined ? `${messageId}-c` : undefined}
                  activeMatchId={activeMatchId}
                />
              ) : null;
            })()}

            {/* 流式输出状态 */}
            {message.isStreaming && (!message.contentBlocks || message.contentBlocks.length === 0) && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="flex space-x-1">
                  <div className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce"></div>
                  <div className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                  <div className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                </div>
                <span>思考中...</span>
              </div>
            )}

            {/* 底部操作栏：时间戳 + 分叉按钮 */}
            <div className="flex items-center gap-3 mt-1">
              {message.timestamp && (
                <div className="text-xs text-muted-foreground">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </div>
              )}
              {/* 分叉按钮 - 只在非流式且有 sdkUuid 时显示 */}
              {!message.isStreaming && message.sdkUuid && onFork && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onFork(message.sdkUuid!)}
                  className="h-6 px-1.5 text-xs text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100 transition-all"
                  title="从此处创建分叉对话"
                >
                  <GitBranch size={12} />
                  <span>分叉</span>
                </Button>
              )}
            </div>
          </div>
      )}
    </div>
  );
});
