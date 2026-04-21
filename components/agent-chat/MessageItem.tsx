import { useState } from 'react';
import { GitBranch, FileText, Bot, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { ContentBlockItem } from './ContentBlockItem';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { parseUserMessageReferences, formatModelName, parseSlashCommandMessage } from './utils';
import type { Message } from './types';

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

  return (
    <div className="w-full py-4 group">
      {isUser ? (
        // 用户消息：淡色外框包裹，无头像；sticky 粘住滚动区顶部
        <div className="relative sticky top-0 z-10 border border-border rounded-lg px-4 py-2 bg-background/95 backdrop-blur-sm">
          {message.source === 'wechat-bot' && (
            <Bot className="w-3 h-3 text-green-500 absolute top-2 right-2" />
          )}
          <div className="min-w-0">
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
                    {/* 消息文本：默认 2 行折叠，通过右下角 chevron 按钮展开 */}
                    <div
                      className={cn(
                        "whitespace-pre-wrap break-words text-sm text-foreground",
                        !isStickyExpanded && "line-clamp-2",
                        isStickyExpanded && "max-h-[40vh] overflow-y-auto"
                      )}
                    >
                      {parsed.userMessage}
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
      )}
    </div>
  );
}
