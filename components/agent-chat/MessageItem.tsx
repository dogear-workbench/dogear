import { useState } from 'react';
import { GitBranch, ChevronDown, ChevronRight, FileText, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { ContentBlockItem } from './ContentBlockItem';
import { parseUserMessageReferences, formatModelName, parseSlashCommandMessage } from './utils';
import type { Message } from './types';

/** 长文本折叠阈值 */
const COLLAPSE_THRESHOLD = 300;

export function MessageItem({
  message,
  onFork,
  sessionId,
  onPermissionResolved,
  onAskUserResolved,
}: {
  message: Message;
  onFork?: (assistantSdkUuid: string) => void;
  sessionId?: string | null;
  onPermissionResolved?: (requestId: string, behavior: 'allow' | 'deny' | 'always_allow', denyMessage?: string) => void;
  onAskUserResolved?: (requestId: string, answers: Record<string, string>) => void;
}) {
  const isUser = message.role === 'user';

  // 长文本折叠状态
  const [isExpanded, setIsExpanded] = useState(false);
  const needsCollapse = isUser && message.content.length > COLLAPSE_THRESHOLD;

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

  return (
    <div className="w-full py-4 group">
      {isUser ? (
        // 用户消息
        <div className="flex items-start gap-3">
            {/* 头像 */}
            <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-foreground relative">
              <span className="text-background text-sm font-medium">你</span>
              {message.source === 'wechat-bot' && (
                <Bot className="w-3 h-3 text-green-500 absolute -bottom-0.5 -right-0.5" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              {(
                // 显示模式：先检测斜杠命令格式，再解析引用
                (() => {
                  // 检测 SDK 斜杠命令格式 (<command-name> 标签)
                  const slashCmd = parseSlashCommandMessage(message.content);
                  if (slashCmd.isCommand) {
                    return (
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-secondary border border-border rounded-md text-xs text-muted-foreground font-mono">
                          <span className="text-muted-foreground/60">/</span>
                          {slashCmd.commandName}
                          {slashCmd.commandArgs && (
                            <span className="text-muted-foreground ml-1">{slashCmd.commandArgs}</span>
                          )}
                        </span>
                        {message.timestamp && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(message.timestamp).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                    );
                  }

                  const parsed = parseUserMessageReferences(message.content);
                  const hasRefs = parsed.articleRefs.length > 0 || parsed.snippetRefs.length > 0;
                  return (
                    <div className="relative">
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
                        </div>
                      )}
                      {/* 消息文本；长文本支持折叠 */}
                      <div className="whitespace-pre-wrap break-words pr-8 text-sm text-foreground">
                        {needsCollapse && !isExpanded ? (
                          <>
                            <span className="line-clamp-3">
                              {parsed.userMessage}
                            </span>
                            <button
                              onClick={() => setIsExpanded(true)}
                              className="text-xs text-primary hover:text-primary/80 mt-1 flex items-center gap-0.5"
                            >
                              <ChevronRight size={12} />
                              展开全部
                            </button>
                          </>
                        ) : (
                          <>
                            {parsed.userMessage}
                            {needsCollapse && isExpanded && (
                              <button
                                onClick={() => setIsExpanded(false)}
                                className="text-xs text-primary hover:text-primary/80 mt-1 flex items-center gap-0.5"
                              >
                                <ChevronDown size={12} />
                                收起
                              </button>
                            )}
                          </>
                        )}
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
          </div>
      ) : (
        // AI 助手消息
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <span className="text-primary-foreground text-sm font-medium">AI</span>
            </div>
            {/* 模型名称 */}
            {message.model && (
              <div className="text-[10px] text-muted-foreground text-center mt-0.5 max-w-[80px] truncate" title={message.model}>
                {formatModelName(message.model)}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            {/* 按照接收顺序渲染所有内容块 */}
            {message.contentBlocks && message.contentBlocks.length > 0 ? (
              <div className="space-y-2">
                {message.contentBlocks.map((block, idx) => (
                  <ContentBlockItem key={idx} block={block} sessionId={sessionId} onPermissionResolved={onPermissionResolved} onAskUserResolved={onAskUserResolved} />
                ))}
              </div>
            ) : message.content ? (
              <MarkdownRenderer content={message.content} className="text-sm" />
            ) : null}

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
        </div>
      )}
    </div>
  );
}
