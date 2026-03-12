import { useState } from 'react';
import { Pencil, GitBranch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { ContentBlockItem } from './ContentBlockItem';
import { parseUserMessageReferences, formatModelName } from './utils';
import type { Message } from './types';

export function MessageItem({
  message,
  messageIndex,
  onEditResend,
  onFork,
  sessionId,
  onPermissionResolved,
  onAskUserResolved,
}: {
  message: Message;
  messageIndex: number;
  onEditResend?: (index: number, newContent: string) => void;
  onFork?: (assistantSdkUuid: string) => void;
  sessionId?: string | null;
  onPermissionResolved?: (requestId: string, behavior: 'allow' | 'deny' | 'always_allow', denyMessage?: string) => void;
  onAskUserResolved?: (requestId: string, answers: Record<string, string>) => void;
}) {
  const isUser = message.role === 'user';
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);

  return (
    <div className="w-full py-3 border-b border-gray-100 last:border-0 group">
      {isUser ? (
        // 用户消息
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
            <span className="text-white text-sm font-medium">你</span>
          </div>
          <div className="flex-1 min-w-0">
            {isEditing ? (
              // 编辑模式
              <div className="space-y-2">
                <Textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="text-sm resize-none min-h-[4.5rem]"
                  rows={3}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      if (editContent.trim() && onEditResend) {
                        onEditResend(messageIndex, editContent.trim());
                      }
                      setIsEditing(false);
                    }}
                  >
                    重新发送
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => { setIsEditing(false); setEditContent(message.content); }}
                  >
                    取消
                  </Button>
                </div>
              </div>
            ) : (
              // 显示模式：解析引用格式并渲染芯片
              (() => {
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
                            className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 border border-blue-200 rounded-full text-xs text-blue-700"
                            title={ref.title}
                          >
                            <span className="max-w-[160px] truncate">{ref.title}</span>
                            {ref.siteName && <span className="text-blue-400 flex-shrink-0">- {ref.siteName}</span>}
                          </span>
                        ))}
                        {parsed.snippetRefs.map((ref, i) => (
                          <span
                            key={`snippet-${i}`}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-purple-50 border border-purple-200 rounded-full text-xs text-purple-700"
                            title={`来自《${ref.articleTitle}》: ${ref.text}`}
                          >
                            <span className="max-w-[120px] truncate">{`"${ref.text}"`}</span>
                            <span className="text-purple-400 flex-shrink-0">- {ref.articleTitle.length > 8 ? ref.articleTitle.slice(0, 8) + '...' : ref.articleTitle}</span>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="text-sm text-gray-900 whitespace-pre-wrap break-words pr-8">
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
                            className="w-20 h-20 object-cover rounded-md border border-gray-200"
                          />
                        ))}
                      </div>
                    )}
                    {/* 编辑按钮 - hover 时显示 */}
                    {onEditResend && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => { setEditContent(message.content); setIsEditing(true); }}
                        className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-blue-600 h-7 w-7"
                        title="编辑并重新发送"
                      >
                        <Pencil size={14} />
                      </Button>
                    )}
                  </div>
                );
              })()
            )}
            {!isEditing && message.timestamp && (
              <div className="text-xs text-gray-400 mt-1">
                {new Date(message.timestamp).toLocaleTimeString()}
              </div>
            )}
          </div>
        </div>
      ) : (
        // AI 助手消息
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center">
              <span className="text-white text-sm font-medium">AI</span>
            </div>
            {/* 模型名称 */}
            {message.model && (
              <div className="text-[10px] text-gray-400 text-center mt-0.5 max-w-[80px] truncate" title={message.model}>
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
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <div className="flex space-x-1">
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></div>
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                </div>
                <span>思考中...</span>
              </div>
            )}

            {/* 底部操作栏：时间戳 + 分叉按钮 */}
            <div className="flex items-center gap-3 mt-1">
              {message.timestamp && (
                <div className="text-xs text-gray-400">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </div>
              )}
              {/* 分叉按钮 - 只在非流式且有 sdkUuid 时显示 */}
              {!message.isStreaming && message.sdkUuid && onFork && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onFork(message.sdkUuid!)}
                  className="h-6 px-1.5 text-xs text-gray-400 hover:text-purple-600 opacity-0 group-hover:opacity-100 transition-all"
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
