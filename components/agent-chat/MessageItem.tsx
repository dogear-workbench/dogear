import { useState, useEffect, useMemo, memo } from 'react';
import { GitBranch, FileText, Bot, ChevronDown, ChevronUp, MessageSquare, Settings2, ArrowLeftRight, Folder, Share2, StickyNote, ListTodo } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ContentBlockItem } from './ContentBlockItem';
import { ShuntAwareMarkdown } from './shunt-suggestions';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { parseUserMessageReferences, formatModelName, parseSlashCommandMessage, isSdkInjectedUserMessage, isInjectedUserMessage, parseTaskExecution, resolveInjectionTag } from './utils';
import { SESSION_MESSAGE_TOOL_NAMES } from './session-tools';
import { INJECTION_TAG_STYLES } from './injection-tags';
import { CommCollapseBar, SessionPeerLink } from './AgentCommCard';
import { GatedPathChip, useWorkspacePath, useWorkspaceRoots, resolvePathCandidates } from './path-link';
import { useWorkspaceId } from './workspace-id-context';
import { isFailoverContinueMessage, stripFailoverContinueSentinel } from '@/lib/failover-markers';
import { highlightText } from './highlight';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { Message, ContentBlock, InjectionTag, ParsedUserMessage, ParsedTaskExecution } from './types';

/** 跨会话注入消息卡：默认收起一行标识（来源+徽章+首行预览），点击展开全文；左彩色竖线 + 浅底色，脱离用户气泡 */
function InjectedMessageCard({
  message,
  parsed,
  forcedTag,
  messageId,
  searchQuery,
  activeMatchId,
}: {
  message: Message;
  parsed: ParsedUserMessage;
  forcedTag?: InjectionTag;
  messageId?: string;
  searchQuery?: string;
  activeMatchId?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const tag = forcedTag ?? resolveInjectionTag(parsed);
  const styles = INJECTION_TAG_STYLES[tag];
  const sourceName = parsed.senderDisplayName
    ?? (forcedTag === 'task-execution' ? '任务系统' : '未知会话');
  const preview = parsed.userMessage.replace(/\s+/g, ' ').trim();

  // 搜索命中本消息正文（user 域 blockIndex=-1）时自动展开折叠卡
  const ownMatchPrefix = `${message.id ?? messageId}--1-`;
  useEffect(() => {
    if (!activeMatchId || expanded) return;
    if (!activeMatchId.startsWith(ownMatchPrefix)) return;
    setExpanded(true);
  }, [activeMatchId, expanded, ownMatchPrefix]);

  return (
    <div
      className={cn('w-full my-2 rounded-r-lg border-l-[3px] px-3 py-2', styles.bar, styles.card)}
      data-message-id={message.id ?? messageId}
    >
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleTrigger className="flex items-center gap-1.5 w-full text-xs text-muted-foreground cursor-pointer">
          <Bot className="w-3 h-3 flex-shrink-0" />
          <span className="font-medium truncate max-w-[160px] text-foreground/80 flex-shrink-0">{sourceName}</span>
          <span className={cn('px-1.5 py-0.5 rounded text-[10px] flex-shrink-0', styles.badge)}>{styles.label}</span>
          <span className="truncate flex-1 min-w-0 text-foreground/70">{preview}</span>
          {message.timestamp && (
            <span className="flex-shrink-0 text-muted-foreground/60">
              {new Date(message.timestamp).toLocaleTimeString()}
            </span>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-1 pt-1 border-t border-border/40">
            <div className="mb-1 text-xs text-muted-foreground break-all">
              来源：
              {parsed.senderSessionId
                ? <SessionPeerLink sessionId={parsed.senderSessionId} displayName={sourceName} />
                : <span className="break-all">{sourceName}</span>}
              {parsed.senderSessionId && ` · ${parsed.senderSessionId}`}
            </div>
            <div className="whitespace-pre-wrap break-words text-xs text-foreground">
              {searchQuery && messageId
                ? highlightText(parsed.userMessage, searchQuery, `${messageId}--1`, activeMatchId ?? null)
                : parsed.userMessage
              }
            </div>
            <CommCollapseBar onCollapse={() => setExpanded(false)} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/** task-execution 折叠卡：收起一行标题，展开显示任务元信息（计划文档走存在性管道后可点）与执行约定全文 */
function TaskExecutionCard({
  message,
  parsed,
  messageId,
}: {
  message: Message;
  parsed: ParsedTaskExecution;
  messageId?: string;
}) {
  const workspaceId = useWorkspaceId();
  const roots = useWorkspaceRoots(workspaceId);
  const planCandidates = useMemo(
    () => (parsed.planPath && roots ? resolvePathCandidates(parsed.planPath, roots) : []),
    [parsed.planPath, roots],
  );
  return (
    <div className="w-full my-2" data-message-id={message.id ?? messageId}>
      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-secondary border border-border text-xs text-muted-foreground hover:bg-muted transition-colors cursor-pointer">
          <ListTodo size={14} className="flex-shrink-0" />
          <span className="font-medium flex-shrink-0">任务执行会话</span>
          <span className="truncate">《{parsed.title}》</span>
          <span className="ml-auto flex-shrink-0 text-muted-foreground/60">点击展开</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-1 px-3 py-2 rounded-lg bg-secondary/50 border border-border text-xs text-foreground max-h-[400px] overflow-y-auto">
            <div className="flex flex-col gap-1 mb-2 pb-2 border-b border-border/60">
              <div className="text-muted-foreground">
                任务 ID：<span className="font-mono text-foreground break-all">{parsed.taskId}</span>
              </div>
              {parsed.planPath && workspaceId && planCandidates.length > 0 && (
                <div className="text-muted-foreground">
                  计划文档：
                  <GatedPathChip text={parsed.planPath} candidates={planCandidates} workspaceId={workspaceId} />
                </div>
              )}
            </div>
            <div className="whitespace-pre-wrap">{parsed.body}</div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/** failover 续跑提示（主进程注入的哨兵 user 消息）：系统提示条样式，剥掉哨兵不显示 */
function FailoverContinueNotice({ content, timestamp, messageId }: { content: string; timestamp?: number; messageId?: string }) {
  return (
    <div className="w-full my-2 flex items-center gap-2 px-3 py-1.5 rounded-md bg-secondary/60 border border-dashed border-border text-xs text-muted-foreground" data-message-id={messageId}>
      <ArrowLeftRight size={12} className="flex-shrink-0" />
      <span className="flex-1 min-w-0">{stripFailoverContinueSentinel(content)}</span>
      {typeof timestamp === 'number' && (
        <span className="text-muted-foreground/60 flex-shrink-0">{new Date(timestamp).toLocaleTimeString()}</span>
      )}
    </div>
  );
}

/** 渲染条目：block 附带其在原始 contentBlocks 中的索引（供搜索命中 id 与块级定位使用） */
interface RenderBlockEntry {
  block: ContentBlock;
  originalIndex: number;
  /** tool_group 时为各子块的原始索引 */
  childOriginalIndices?: number[];
}

/**
 * 将连续的 tool_use（中间可夹 thinking）合并为 tool_group 虚拟 block。
 * - ≥2 个工具才分组；单个工具 / 单个 thinking / Task/Agent 子代理 不分组
 * - 会话性质工具（申报/勾选卡）渲染为消息卡，排除出分组
 * - 遇到 text / permission_request / ask_user_question 等其他类型 → 结束当前分组
 * - 分组与不分组均保留原始 contentBlocks 索引，保证搜索命中模型与渲染端一致
 */
function groupBlocks(blocks: ContentBlock[]): RenderBlockEntry[] {
  const result: RenderBlockEntry[] = [];
  let buffer: RenderBlockEntry[] = [];
  let toolCount = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    if (toolCount >= 2) {
      result.push({
        block: {
          type: 'tool_group',
          children: buffer.map(b => b.block),
          timestamp: buffer[0].block.timestamp,
        },
        originalIndex: buffer[0].originalIndex,
        childOriginalIndices: buffer.map(b => b.originalIndex),
      });
    } else {
      result.push(...buffer);
    }
    buffer = [];
    toolCount = 0;
  };

  blocks.forEach((block, originalIndex) => {
    if (block.type === 'tool_use' && SESSION_MESSAGE_TOOL_NAMES.has(block.toolName ?? '')) {
      flush();
      result.push({ block, originalIndex });
    } else if (block.type === 'tool_use') {
      buffer.push({ block, originalIndex });
      toolCount++;
    } else if (block.type === 'thinking' && buffer.length > 0) {
      buffer.push({ block, originalIndex });
    } else {
      flush();
      result.push({ block, originalIndex });
    }
  });
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
  activeBlockMatchCount,
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
  activeBlockMatchCount?: number;
  /** 当前会话是否 agent 会话（用于判断"用户介入"徽章） */
  isAgentConversation?: boolean;
  readOnly?: boolean;
}) {
  const isUser = message.role === 'user';
  const displayMode = useSettingsStore(s => s.settings?.ui?.messageDisplayMode ?? 'compact');
  const currentWorkspaceId = useWorkspaceStore(s => s.workspace?.id);
  const conversationWorkspaceId = useWorkspaceId();
  const conversationWorkspacePath = useWorkspacePath(conversationWorkspaceId);

  // sticky 展开/收起状态（用户消息默认折叠为 2 行）
  const [isStickyExpanded, setIsStickyExpanded] = useState(false);

  // 搜索激活命中落在当前用户消息内时自动解除两行截断，保证命中可见
  useEffect(() => {
    if (!activeMatchId || isStickyExpanded) return;
    const mid = message.id ?? messageId;
    if (!mid || !activeMatchId.startsWith(`${mid}-`)) return;
    setIsStickyExpanded(true);
  }, [activeMatchId, isStickyExpanded, message.id, messageId]);

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
    return <FailoverContinueNotice content={message.content} timestamp={message.timestamp} messageId={messageId} />;
  }

  // 跨会话注入消息（交付/回复/终态/恢复卡、task-execution 折叠卡），优先于 SDK 注入与用户气泡判定
  if (isUser && isInjectedUserMessage(message.content)) {
    const taskExec = parseTaskExecution(message.content);
    if (taskExec) {
      return (
        <TaskExecutionCard
          message={message}
          parsed={taskExec}
          messageId={messageId}
        />
      );
    }
    const injectedParsed = parseUserMessageReferences(message.content);
    const forcedTag = message.content.includes('<task-execution>')
      ? ('task-execution' as const)
      : undefined;
    return (
      <InjectedMessageCard
        message={message}
        parsed={injectedParsed}
        forcedTag={forcedTag}
        messageId={messageId}
        searchQuery={searchQuery}
        activeMatchId={activeMatchId}
      />
    );
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
            <Bot className="w-3 h-3 text-green-500 dark:text-green-400 absolute top-2 right-2" />
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
                    {/* 「你」徽章：用户在 agent 会话里介入（跨会话 agent 消息已走注入卡提前 return） */}
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
                            className="inline-flex items-center gap-1 px-2 py-1 bg-sky-50 border border-sky-200 rounded-full text-xs text-sky-700 dark:bg-sky-950/40 dark:border-sky-800/60 dark:text-sky-300"
                            title={ref.title}
                          >
                            <span className="max-w-[160px] truncate">{ref.title}</span>
                            {ref.siteName && <span className="text-sky-400 flex-shrink-0">- {ref.siteName}</span>}
                          </span>
                        ))}
                        {parsed.snippetRefs.map((ref, i) => (
                          <span
                            key={`snippet-${i}`}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 border border-slate-200 rounded-full text-xs text-slate-600 dark:bg-slate-800/60 dark:border-slate-700 dark:text-slate-300"
                            title={`来自《${ref.articleTitle}》: ${ref.text}`}
                          >
                            <span className="max-w-[120px] truncate">{`"${ref.text}"`}</span>
                            <span className="text-slate-400 flex-shrink-0">- {ref.articleTitle.length > 8 ? ref.articleTitle.slice(0, 8) + '...' : ref.articleTitle}</span>
                          </span>
                        ))}
                        {parsed.fileRefs.map((ref, i) => (
                          <span
                            key={`file-${i}`}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-teal-50 border border-teal-200 rounded-full text-xs text-teal-700 dark:bg-teal-950/40 dark:border-teal-800/60 dark:text-teal-300"
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
                            className="inline-flex items-center gap-1 px-2 py-1 bg-purple-50 border border-purple-200 rounded-full text-xs text-purple-700 dark:bg-purple-950/40 dark:border-purple-800/60 dark:text-purple-300"
                            title={ref.title}
                          >
                            <MessageSquare className="w-3 h-3 flex-shrink-0" />
                            <span className="max-w-[160px] truncate">{ref.title}</span>
                            {ref.workspaceId && ref.workspaceId !== currentWorkspaceId && (
                              <span className="px-1 rounded bg-purple-100 text-purple-500 text-[10px] flex-shrink-0 dark:bg-purple-900/40 dark:text-purple-300">跨工作区</span>
                            )}
                          </span>
                        ))}
                        {parsed.sharedFileRefs.map((ref, i) => (
                          <span
                            key={`shared-file-${i}`}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 border border-amber-200 rounded-full text-xs text-amber-700 dark:bg-amber-950/40 dark:border-amber-800/60 dark:text-amber-300"
                            title={ref.absPath}
                          >
                            <Share2 className="w-3 h-3 flex-shrink-0" />
                            <span className="max-w-[160px] truncate">{`共享文件 · ${ref.relPath}`}</span>
                          </span>
                        ))}
                        {parsed.noteRefs.map((ref, i) => (
                          <span
                            key={`note-${i}`}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-rose-50 border border-rose-200 rounded-full text-xs text-rose-700 dark:bg-rose-950/40 dark:border-rose-800/60 dark:text-rose-300"
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
                        ? highlightText(parsed.userMessage, searchQuery, `${messageId}--1`, activeMatchId ?? null)
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
              const entries: RenderBlockEntry[] = (message.contentBlocks && displayMode === 'compact')
                ? groupBlocks(message.contentBlocks)
                : (message.contentBlocks || []).map((block, originalIndex) => ({ block, originalIndex }));
              return entries.length > 0 ? (
                <div className="space-y-2">
                  {entries.map((entry, idx) => (
                    <div key={idx} data-block-index={entry.originalIndex}>
                      <ContentBlockItem
                        block={entry.block}
                        blockIndex={entry.originalIndex}
                        childOriginalIndices={entry.childOriginalIndices}
                        sessionId={sessionId}
                        onPermissionResolved={onPermissionResolved}
                        onAskUserResolved={onAskUserResolved}
                        onInterrupt={onInterrupt}
                        searchQuery={searchQuery}
                        activeMatchId={activeMatchId}
                        activeBlockMatchCount={activeBlockMatchCount}
                        messageId={messageId}
                        readOnly={readOnly}
                        workspacePath={conversationWorkspacePath ?? undefined}
                      />
                    </div>
                  ))}
                </div>
              ) : message.content ? (
                <ShuntAwareMarkdown
                  content={message.content}
                  className="text-sm"
                  searchQuery={searchQuery}
                  matchIdPrefix={messageId !== undefined ? `${messageId}--2` : undefined}
                  activeMatchId={activeMatchId}
                  workspacePath={conversationWorkspacePath ?? undefined}
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
