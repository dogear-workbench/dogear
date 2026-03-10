'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Citation, type PermissionMode } from '@/types/electron-api';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import { ToolBlock } from './ToolBlock';
import { MarkdownRenderer } from './MarkdownRenderer';
import { Pencil, GitBranch, ChevronRight, X, Brain, Shield, Check, ShieldAlert, ShieldCheck, Send, MessageSquare } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useReferenceStore } from '@/stores/reference-store';

/**
 * Agent 聊天组件 v2
 * 使用主进程会话模式，会话生命周期与程序相同
 *
 * 核心特性：
 * - 使用 SDK 的 v2 API 在主进程中创建会话
 * - 显示完整的 AI 操作（工具调用、思考过程等）
 * - 内容占满整行，无气泡样式
 */

/**
 * 扩展的消息类型
 */
interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
  isStreaming?: boolean;  // 是否正在流式输出中
  // 统一的内容块数组，按接收顺序存储所有内容
  contentBlocks?: ContentBlock[];
  // SDK 消息 UUID（用于分叉定位，v4 新增）
  sdkUuid?: string;
  forkPointSdkUuid?: string; // 用户消息上记录对应的分叉点 assistant UUID
  // AI 模型名称
  model?: string;
}

/**
 * 内容块类型
 * 按照实际接收顺序存储和渲染
 */
interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'status' | 'error' | 'result' | 'user' | 'permission_request'
    // Hook 事件类型
    | 'session_start' | 'session_end' | 'stop' | 'tool_failure' | 'notification' | 'task_notification';
  id?: string;
  content?: string;
  toolName?: string;
  toolInput?: any;
  toolOutput?: any;
  toolUseId?: string;  // 工具调用 ID，用于关联工具调用和结果
  status?: string;
  error?: string;
  isError?: boolean;   // 工具执行是否出错
  timestamp: number;
  citations?: Citation[];
  // 是否为重放的历史消息（SDK resume 时使用）
  isReplay?: boolean;
  // 权限请求相关字段（type='permission_request' 时使用）
  permissionRequestId?: string;
  permissionToolName?: string;
  permissionInput?: any;
  permissionDecisionReason?: string;
  permissionResolved?: 'allow' | 'deny' | 'always_allow';  // 用户已响应的状态
  permissionDenyMessage?: string;  // 用户自定义的拒绝理由
  // Hook 事件相关字段
  sessionStartSource?: string;           // SessionStart: 启动来源
  sessionEndReason?: string;             // SessionEnd: 结束原因
  stopHookActive?: boolean;              // Stop: 停止钩子激活
  failedToolName?: string;               // PostToolUseFailure: 失败工具名
  failedToolError?: string;              // PostToolUseFailure: 失败错误信息
  notificationTitle?: string;            // Notification: 通知标题
  notificationMessage?: string;          // Notification: 通知内容
  notificationType?: string;             // Notification: 通知类型
  taskId?: string;                       // 子代理任务 ID
  taskStatus?: string;                   // 子代理任务状态
  taskSummary?: string;                  // 子代理任务摘要
}

interface AgentChatProps {
  /** 占位符文本 */
  placeholder?: string;
  /** 是否显示状态提示 */
  showStatusHint?: boolean;
  /** 是否使用 SDK 的 resume 功能（默认 true） */
  useSdkResume?: boolean;
  /** 是否显示重放的历史消息（仅当 useSdkResume=true 时有效） */
  showReplayMessages?: boolean;
}

/**
 * 解析用户消息中的引用格式，返回引用信息和实际消息文本
 * 严格匹配我们自己定义的格式，避免误解析
 */
interface ParsedArticleRef {
  title: string;
  articleId: string;
  siteName?: string;
}
interface ParsedSnippetRef {
  articleTitle: string;
  text: string;
}
interface ParsedUserMessage {
  articleRefs: ParsedArticleRef[];
  snippetRefs: ParsedSnippetRef[];
  userMessage: string;
}

/**
 * 格式化模型名称为简短显示
 * 例如：'claude-sonnet-4-5-20250929' -> 'Sonnet 4.5'
 *       'anthropic/claude-opus-4.6' -> 'Opus 4.6'
 */
function formatModelName(model: string): string {
  const name = model.includes('/') ? model.split('/').pop()! : model;
  if (name.includes('opus')) {
    const v = name.match(/opus[.-](\d+(?:\.\d+)?)/);
    return `Opus ${v?.[1] || '4'}`;
  }
  if (name.includes('sonnet-4-5') || name.includes('sonnet-4.5')) return 'Sonnet 4.5';
  if (name.includes('sonnet-4')) return 'Sonnet 4';
  if (name.includes('sonnet-3-5') || name.includes('sonnet-3.5')) return 'Sonnet 3.5';
  if (name.includes('haiku')) return 'Haiku';
  return name.length > 15 ? name.substring(0, 15) + '...' : name;
}

function parseUserMessageReferences(content: string): ParsedUserMessage {
  const result: ParsedUserMessage = { articleRefs: [], snippetRefs: [], userMessage: content };

  // 匹配 [引用文章] 头部，贪婪捕获到第一个空行（\n\n）之前的全部内容
  const articleBlockRegex = /^\[引用文章\] 以下文章已引用，可使用 ReadArticle 工具读取完整内容：\n([\s\S]+?)(?=\n\n|$)/;
  const articleBlockMatch = content.match(articleBlockRegex);

  if (articleBlockMatch) {
    // 逐行解析文章引用
    const articleLineRegex = /^- 《(.+?)》\(articleId: (.+?)\)(?:\s*-\s*(.+))?$/gm;
    let lineMatch;
    while ((lineMatch = articleLineRegex.exec(articleBlockMatch[1])) !== null) {
      result.articleRefs.push({
        title: lineMatch[1],
        articleId: lineMatch[2],
        siteName: lineMatch[3]?.trim() || undefined,
      });
    }
    // 移除已解析的 [引用文章] 区块
    content = content.slice(articleBlockMatch[0].length);
  }

  // 匹配 [引用片段] 区块，空行后跟 "来自《" 说明还在区块内，否则区块结束
  const snippetBlockRegex = /^\[引用片段\]\n([\s\S]+?)(?=\n\n(?!来自《)|$)/;
  // 先去掉可能的前导换行
  content = content.replace(/^\n+/, '');
  const snippetBlockMatch = content.match(snippetBlockRegex);

  if (snippetBlockMatch) {
    // 逐条解析片段引用：来自《title》:\n> text
    const snippetRegex = /来自《(.+?)》:\n> ([\s\S]+?)(?=\n\n来自《|$)/g;
    let snippetMatch;
    while ((snippetMatch = snippetRegex.exec(snippetBlockMatch[1])) !== null) {
      result.snippetRefs.push({
        articleTitle: snippetMatch[1],
        text: snippetMatch[2].trim(),
      });
    }
    // 移除已解析的 [引用片段] 区块
    content = content.slice(snippetBlockMatch[0].length);
  }

  // 剩余的就是用户实际消息（去掉前导换行）
  result.userMessage = content.replace(/^\n+/, '');

  return result;
}

/**
 * 消息渲染组件
 * 显示用户消息或 AI 消息（包含工具调用等）
 * v4: 支持编辑重发和分叉按钮
 */
function MessageItem({
  message,
  messageIndex,
  onEditResend,
  onFork,
  sessionId,
  onPermissionResolved,
}: {
  message: Message;
  messageIndex: number;
  onEditResend?: (index: number, newContent: string) => void;
  onFork?: (assistantSdkUuid: string) => void;
  sessionId?: string | null;
  onPermissionResolved?: (requestId: string, behavior: 'allow' | 'deny' | 'always_allow', denyMessage?: string) => void;
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
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  rows={3}
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (editContent.trim() && onEditResend) {
                        onEditResend(messageIndex, editContent.trim());
                      }
                      setIsEditing(false);
                    }}
                    className="px-3 py-1 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    重新发送
                  </button>
                  <button
                    onClick={() => { setIsEditing(false); setEditContent(message.content); }}
                    className="px-3 py-1 bg-gray-200 text-gray-700 text-xs rounded-lg hover:bg-gray-300 transition-colors"
                  >
                    取消
                  </button>
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
                    {/* 编辑按钮 - hover 时显示 */}
                    {onEditResend && (
                      <button
                        onClick={() => { setEditContent(message.content); setIsEditing(true); }}
                        className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 text-gray-400 hover:text-blue-600"
                        title="编辑并重新发送"
                      >
                        <Pencil size={14} />
                      </button>
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
                  <ContentBlockItem key={idx} block={block} sessionId={sessionId} onPermissionResolved={onPermissionResolved} />
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
                <button
                  onClick={() => onFork(message.sdkUuid!)}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-purple-600 opacity-0 group-hover:opacity-100 transition-all"
                  title="从此处创建分叉对话"
                >
                  <GitBranch size={12} />
                  <span>分叉</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 内容块组件
 * 按照接收顺序渲染文本、工具调用、思考等内容
 */
/**
 * 思考块组件
 * 可折叠面板，默认收起，点击展开查看思考内容
 */
function ThinkingBlock({ block }: { block: ContentBlock }) {
  const [isOpen, setIsOpen] = useState(false);
  const hasContent = !!block.content;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="rounded-lg border border-gray-200 bg-gray-50/50">
        <CollapsibleTrigger className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-100 transition-colors cursor-pointer">
          <ChevronRight
            className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${
              isOpen ? 'rotate-90' : ''
            }`}
          />
          {!hasContent ? (
            <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse" />
          ) : (
            <Brain size={14} className="text-gray-500" />
          )}
          <span className="text-sm text-gray-600">
            {hasContent ? '已思考' : '思考中...'}
          </span>
        </CollapsibleTrigger>

        <CollapsibleContent>
          {hasContent && (
            <div className="px-3 pb-3">
              <div className="border-t border-gray-200 pt-2">
                <div className="text-sm text-gray-600 whitespace-pre-wrap bg-gray-100/50 rounded p-3 max-h-80 overflow-y-auto">
                  {block.content}
                </div>
              </div>
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

/**
 * 权限确认卡片组件
 * 当 SDK 在 default 模式下请求工具执行权限时显示
 */
function PermissionRequestCard({
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

  const handleAllow = async () => {
    if (!sessionId || !block.permissionRequestId || isResolved) return;
    await client.respondPermissionRequest({
      sessionId,
      requestId: block.permissionRequestId,
      behavior: 'allow',
    });
    onResolved(block.permissionRequestId, 'allow');
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

  // 已处理状态的边框/背景颜色
  const resolvedStyle = () => {
    if (!isResolved) return 'border-amber-300 bg-amber-50/50';
    if (block.permissionResolved === 'deny') return 'border-red-200 bg-red-50/30';
    return 'border-green-200 bg-green-50/30';  // allow 和 always_allow
  };

  return (
    <div className={`rounded-lg border-2 ${resolvedStyle()} p-3`}>
      <div className="flex items-center gap-2 mb-2">
        {isResolved && block.permissionResolved !== 'deny'
          ? <ShieldCheck size={16} className="text-green-500" />
          : <ShieldAlert size={16} className={isResolved ? 'text-red-400' : 'text-amber-600'} />
        }
        <span className={`text-sm font-medium ${isResolved ? 'text-gray-500' : 'text-amber-800'}`}>
          {isResolved ? resolvedText() : '请求执行权限'}
        </span>
        <span className="text-xs px-1.5 py-0.5 bg-gray-100 rounded text-gray-600 font-mono">
          {block.permissionToolName}
        </span>
      </div>

      {/* 工具输入摘要 */}
      {block.permissionInput && (
        <div className="mb-2 text-xs text-gray-600 bg-gray-50 rounded p-2 font-mono max-h-32 overflow-y-auto whitespace-pre-wrap">
          {formatToolInput(block.permissionInput)}
        </div>
      )}

      {/* 权限请求原因 */}
      {block.permissionDecisionReason && (
        <div className="mb-2 text-xs text-gray-500">
          原因: {block.permissionDecisionReason}
        </div>
      )}

      {/* 已拒绝时显示用户的拒绝理由 */}
      {isResolved && block.permissionResolved === 'deny' && block.permissionDenyMessage && (
        <div className="mb-1 text-xs text-red-600 bg-red-50 rounded p-2">
          <MessageSquare size={10} className="inline mr-1" />
          {block.permissionDenyMessage}
        </div>
      )}

      {/* 操作按钮 */}
      {!isResolved && (
        <div className="space-y-2 mt-2">
          <div className="flex items-center gap-2">
            <button
              onClick={handleAllow}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-700 transition-colors cursor-pointer"
            >
              <Check size={12} />
              允许
            </button>
            <button
              onClick={handleAlwaysAllow}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-100 border border-green-300 rounded-md hover:bg-green-200 transition-colors cursor-pointer"
            >
              <ShieldCheck size={12} />
              总是允许
            </button>
            <button
              onClick={handleDeny}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 transition-colors cursor-pointer"
            >
              <X size={12} />
              拒绝
            </button>
            <button
              onClick={() => setShowDenyInput(!showDenyInput)}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                showDenyInput
                  ? 'text-amber-700 bg-amber-100 border border-amber-300'
                  : 'text-gray-600 bg-gray-50 border border-gray-200 hover:bg-gray-100'
              }`}
            >
              <Send size={12} />
              拒绝并说明
            </button>
          </div>

          {/* 用户输入拒绝理由 */}
          {showDenyInput && (
            <div className="flex gap-2">
              <input
                type="text"
                value={denyMessage}
                onChange={(e) => setDenyMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && denyMessage.trim()) handleDenyWithMessage(); }}
                placeholder="输入拒绝理由，AI 会根据你的说明调整..."
                className="flex-1 text-xs border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
                autoFocus
              />
              <button
                onClick={handleDenyWithMessage}
                disabled={!denyMessage.trim()}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-amber-500 rounded-md hover:bg-amber-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <Send size={12} />
                发送
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ContentBlockItem({ block, sessionId, onPermissionResolved }: {
  block: ContentBlock;
  sessionId?: string | null;
  onPermissionResolved?: (requestId: string, behavior: 'allow' | 'deny' | 'always_allow', denyMessage?: string) => void;
}) {
  switch (block.type) {
    case 'tool_use':
      // 使用新的 ToolBlock 组件，支持折叠和状态显示
      // 根据是否有输出结果判断状态
      const toolStatus = block.toolOutput !== undefined
        ? (block.isError ? 'error' : 'success')
        : 'running';
      return (
        <ToolBlock
          toolName={block.toolName || '未知工具'}
          toolInput={block.toolInput}
          toolOutput={block.toolOutput}
          toolUseId={block.toolUseId}
          status={toolStatus}
          isError={block.isError}
          citations={block.citations}
        />
      );

    case 'tool_result':
      // tool_result 不独立渲染，结果已整合到对应 tool_use 的 ToolBlock 中
      return null;

    case 'status':
      return (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-2">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
            {block.status}
          </div>
        </div>
      );

    case 'thinking':
      return <ThinkingBlock block={block} />;

    case 'permission_request':
      return (
        <PermissionRequestCard
          block={block}
          sessionId={sessionId || null}
          onResolved={onPermissionResolved || (() => {})}
        />
      );

    // ==================== Hook 事件渲染 ====================

    case 'session_start': {
      const sourceLabel: Record<string, string> = {
        startup: '会话已启动',
        resume: '会话已恢复',
        clear: '会话已重新开始',
        compact: '会话已压缩重启',
      };
      return (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-green-50 border border-green-200 text-xs text-green-700">
          <div className="w-1.5 h-1.5 bg-green-500 rounded-full"></div>
          {sourceLabel[block.sessionStartSource || ''] || '会话已启动'}
        </div>
      );
    }

    case 'session_end':
      return (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-gray-100 border border-gray-200 text-xs text-gray-500">
          <div className="w-1.5 h-1.5 bg-gray-400 rounded-full"></div>
          会话已结束{block.sessionEndReason ? `（${block.sessionEndReason}）` : ''}
        </div>
      );

    case 'stop':
      return (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-700">
          <div className="w-1.5 h-1.5 bg-amber-500 rounded-full"></div>
          执行已停止
        </div>
      );

    case 'tool_failure':
      return (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-red-700 mb-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            工具执行失败
            {block.failedToolName && (
              <span className="text-xs px-1.5 py-0.5 bg-red-100 rounded font-mono">{block.failedToolName}</span>
            )}
          </div>
          {block.failedToolError && (
            <div className="text-xs text-red-600 bg-red-100/50 rounded p-2 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
              {block.failedToolError}
            </div>
          )}
        </div>
      );

    case 'notification':
      return (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-blue-700 mb-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            {block.notificationTitle || '通知'}
          </div>
          {block.notificationMessage && (
            <div className="text-xs text-blue-600">{block.notificationMessage}</div>
          )}
        </div>
      );

    case 'task_notification': {
      // 根据任务状态设置颜色
      const statusColors: Record<string, { bg: string; border: string; text: string; dot: string }> = {
        completed: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', dot: 'bg-green-500' },
        failed: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', dot: 'bg-red-500' },
        cancelled: { bg: 'bg-gray-100', border: 'border-gray-200', text: 'text-gray-600', dot: 'bg-gray-400' },
      };
      const colors = statusColors[block.taskStatus || ''] || { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700', dot: 'bg-indigo-500' };
      const statusLabels: Record<string, string> = { completed: '已完成', failed: '失败', cancelled: '已取消', in_progress: '进行中' };
      return (
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-md ${colors.bg} border ${colors.border} text-xs ${colors.text}`}>
          <div className={`w-1.5 h-1.5 ${colors.dot} rounded-full`}></div>
          <span>子任务 {block.taskId ? `[${block.taskId.substring(0, 8)}]` : ''} {statusLabels[block.taskStatus || ''] || block.taskStatus}</span>
          {block.taskSummary && <span className="text-gray-500 ml-1">- {block.taskSummary}</span>}
        </div>
      );
    }

    case 'error':
      return (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-red-800">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            错误: {block.error}
          </div>
        </div>
      );

    case 'result':
      // result 类型不显示任何内容，只是标志消息结束
      return null;

    case 'user':
      // 用户消息（来自 SDK 重放）
      return (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-blue-800 mb-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            {block.isReplay && <span className="text-xs text-blue-500">(历史)</span>}
            用户消息
          </div>
          {block.content && (
            <div className="text-sm text-blue-700 whitespace-pre-wrap">
              {block.content}
            </div>
          )}
        </div>
      );

    case 'text':
    default:
      return block.content ? (
        <MarkdownRenderer content={block.content} className="text-sm" />
      ) : null;
  }
}

/**
 * 引用徽章组件
 * 显示引用来源，支持点击跳转到原文位置
 */
function CitationBadge({ citation }: { citation: Citation }) {
  const handleClick = async () => {
    try {
      await client.jumpToPosition({
        chapterId: citation.chapterId,
        position: citation.position,
      });
    } catch (error) {
      console.error('跳转失败:', error);
    }  
  };

  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 hover:bg-blue-100
                 rounded text-xs text-blue-700 cursor-pointer transition-colors border border-blue-200"
      title={`点击跳转到: ${citation.chapterTitle}`}
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
      <span className="font-medium">{citation.chapterTitle}</span>
      {citation.position && (
        <span className="text-gray-400">: {citation.position.start}-{citation.position.end}</span>
      )}
    </button>
  );
}

export function AgentChat({
  placeholder = '输入消息...',
  showStatusHint = true,
  useSdkResume = true,
  showReplayMessages = true,
}: AgentChatProps) {
  // 从 store 获取状态
  const bookId = useWorkspaceStore((s) => s.selectedBook?.id);
  const workspaceId = useWorkspaceStore((s) => s.workspace?.id);
  const conversationId = useConversationStore((s) => s.selectedConversation?.id) || null;
  const forkParams = useConversationStore((s) => s.forkParams);
  const forkConversation = useConversationStore((s) => s.forkConversation);
  const editResendAction = useConversationStore((s) => s.editResend);
  const referencedArticles = useReferenceStore((s) => s.referencedArticles);
  const removeReferencedArticle = useReferenceStore((s) => s.removeReferencedArticle);
  const clearReferencedArticles = useReferenceStore((s) => s.clearReferencedArticles);
  const quotedSnippets = useReferenceStore((s) => s.quotedSnippets);
  const removeQuotedSnippet = useReferenceStore((s) => s.removeQuotedSnippet);
  const clearQuotedSnippets = useReferenceStore((s) => s.clearQuotedSnippets);

  // 构建 context 对象
  const context = { bookId, workspaceId, chapterId: undefined, selectedText: undefined };
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // 思考等级：关闭=0, 低=2000, 中=6000, 高=10000（默认）
  const [thinkingLevel, setThinkingLevel] = useState<number>(10000);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
  // 会话 ID（同时用 ref 保持最新引用，避免 useEffect cleanup 闭包过期）
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [isSessionReady, setIsSessionReady] = useState(false);
  // 历史消息加载状态
  const [historyLoaded, setHistoryLoaded] = useState(false);
  // SDK resume 状态
  const [isResumeMode, setIsResumeMode] = useState(false);
  // 默认工作区路径（用于定位 SDK 会话文件）
  const [workspacePath, setWorkspacePath] = useState<string>('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 同步 sessionId 到 ref
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // 自动滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 获取默认工作区路径
  useEffect(() => {
    client.getDefault().then((ws) => {
      if (ws?.path) setWorkspacePath(ws.path);
    });
  }, []);

  // 加载历史消息（当 conversationId 变化时）
  useEffect(() => {
    const loadHistory = async () => {
      if (!conversationId) {
        setMessages([]);
        setHistoryLoaded(false);
        setIsResumeMode(false);
        return;
      }

      // fork 模式下跳过历史加载：
      // 新对话的 sdk_session_id 尚未写入数据库，此时读取必然失败。
      // fork 会话启动后，SDK 会通过 replay 消息流自动推送截断历史。
      if (forkParams) {
        console.log('🔀 Fork 模式，跳过 loadHistory，等待 SDK replay 消息流');
        setMessages([]);
        setHistoryLoaded(true);
        setIsResumeMode(true);
        return;
      }

      // 使用 SDK resume 模式时，从 SDK 的会话文件中读取历史消息
      if (useSdkResume) {
        console.log('使用 SDK resume 模式，从 SDK 会话文件加载历史...');

        try {
          // 获取对话信息，拿到 sdk_session_id
          const convResult = await client.getById({ conversationId });
          const sdkSessionId = convResult.conversation?.sdk_session_id;

          if (sdkSessionId) {
            console.log('✅ 找到 sdk_session_id:', sdkSessionId);

            // 从 SDK 的会话文件中读取历史消息
            const historyResult = await client.getSdkSessionHistory({ sdkSessionId, projectPath: workspacePath || undefined });

            if (historyResult.error) {
              console.error('读取 SDK 会话历史失败:', historyResult.error);
              return;
            }

            // 转换 SDK 历史消息格式到组件消息格式
            // 第一步：收集所有 tool_result，建立 tool_use_id -> result 的映射
            const toolResultMap = new Map<string, { content: any; isError: boolean }>();
            for (const msg of historyResult.messages) {
              if (msg.type === 'user' && Array.isArray(msg.content)) {
                for (const block of msg.content) {
                  if (block && typeof block === 'object' && block.type === 'tool_result') {
                    const toolUseId = block.tool_use_id;
                    // 处理 content，可能是字符串或数组
                    let resultContent = block.content;
                    if (Array.isArray(resultContent)) {
                      // 如果是数组，提取文本内容
                      resultContent = resultContent
                        .map((item: any) => {
                          if (typeof item === 'string') return item;
                          if (item?.type === 'text') return item.text;
                          return JSON.stringify(item);
                        })
                        .join('\n');
                    }
                    toolResultMap.set(toolUseId, {
                      content: resultContent,
                      isError: block.is_error || false
                    });
                  }
                }
              }
            }
            console.log('工具结果映射:', toolResultMap.size, '个');

            // 第二步：收集 isMeta 消息（skill 内容），建立 sourceToolUseID -> content 的映射
            const skillContentMap = new Map<string, string>();
            for (const msg of historyResult.messages) {
              if (msg.isMeta && msg.sourceToolUseID && msg.type === 'user') {
                // 提取 skill 内容
                let skillContent = '';
                if (Array.isArray(msg.content)) {
                  for (const block of msg.content) {
                    if (block?.type === 'text') {
                      skillContent += block.text || '';
                    }
                  }
                }
                if (skillContent) {
                  skillContentMap.set(msg.sourceToolUseID, skillContent);
                }
              }
            }
            console.log('Skill 内容映射:', skillContentMap.size, '个');

            // 第三步：合并连续的 assistant 消息，跳过空的 user 消息
            const historyMessages: Message[] = [];
            let currentAssistantMessage: Message | null = null;

            for (const msg of historyResult.messages) {
              const isUser = msg.type === 'user';
              const content = msg.content;

              // 跳过 isMeta 消息（skill 内容已经在上面收集了）
              if (msg.isMeta) {
                continue;
              }

              // 检查是否为空消息或只包含 tool_result 的用户消息
              let isEmpty = false;
              let onlyToolResult = false;
              if (isUser) {
                if (!content || (Array.isArray(content) && content.length === 0)) {
                  isEmpty = true;
                } else if (Array.isArray(content)) {
                  onlyToolResult = content.every((b: any) => b?.type === 'tool_result');
                }
              }

              // 跳过空的用户消息和只包含 tool_result 的用户消息
              if (isUser && (isEmpty || onlyToolResult)) {
                continue;
              }

              if (isUser) {
                // 用户消息：先保存之前的 assistant 消息
                if (currentAssistantMessage) {
                  historyMessages.push(currentAssistantMessage);
                  currentAssistantMessage = null;
                }

                // 创建用户消息
                let textContent = '';
                if (typeof content === 'string') {
                  textContent = content;
                } else if (Array.isArray(content)) {
                  for (const block of content) {
                    if (typeof block === 'string') {
                      textContent += block;
                    } else if (block?.type === 'text') {
                      textContent += block.text || '';
                    }
                  }
                }

                // 跳过空文本的用户消息
                if (!textContent.trim()) {
                  continue;
                }

                historyMessages.push({
                  role: 'user',
                  content: textContent,
                  timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),

                });
              } else {
                // assistant 消息：合并到当前的 assistant 消息中
                const blocks: ContentBlock[] = [];
                let textContent = '';

                if (typeof content === 'string') {
                  textContent = content;
                  if (content) {
                    blocks.push({
                      type: 'text',
                      content,
                      timestamp: Date.now()
                    });
                  }
                } else if (Array.isArray(content)) {
                  for (const block of content) {
                    if (typeof block === 'string') {
                      textContent += block;
                      blocks.push({
                        type: 'text',
                        content: block,
                        timestamp: Date.now()
                      });
                    } else if (block && typeof block === 'object') {
                      if (block.type === 'text') {
                        textContent += block.text || '';
                        if (block.text) {
                          blocks.push({
                            type: 'text',
                            content: block.text || '',
                            timestamp: Date.now()
                          });
                        }
                      } else if (block.type === 'tool_use' || block.type === 'server_tool_use') {
                        // 工具调用块 - 查找关联的结果
                        const toolResult = toolResultMap.get(block.id);

                        // 对于 Skill 工具，还要查找关联的 skill 内容
                        let toolOutput = toolResult?.content;
                        if (block.name === 'Skill' && skillContentMap.has(block.id)) {
                          // 将 skill 内容作为工具输出的一部分
                          const skillContent = skillContentMap.get(block.id);
                          toolOutput = toolOutput
                            ? `${toolOutput}\n\n--- Skill 内容 ---\n${skillContent}`
                            : skillContent;
                        }

                        blocks.push({
                          type: 'tool_use',
                          id: block.id,
                          toolName: block.name,
                          toolInput: block.input,
                          toolUseId: block.id,
                          // 关联工具执行结果
                          toolOutput: toolOutput,
                          isError: toolResult?.isError || false,
                          // 历史加载的工具块，有 output 说明已完成
                          status: toolOutput !== undefined ? 'completed' : 'pending',
                          timestamp: Date.now()
                        });
                      } else if (block.type === 'thinking') {
                        // 思考块 - 历史加载时也渲染
                        blocks.push({
                          type: 'thinking',
                          content: block.thinking || '',
                          timestamp: Date.now()
                        });
                      } else if (block.type === 'image' && block.source) {
                        textContent += '[图片]';
                        blocks.push({
                          type: 'text',
                          content: '[图片]',
                          timestamp: Date.now()
                        });
                      }
                    }
                  }
                }

                // v4: 提取 assistant 消息的 UUID
                const assistantUuid = msg.uuid || undefined;

                // 合并到当前的 assistant 消息，或创建新的
                if (currentAssistantMessage) {
                  // 合并内容块
                  currentAssistantMessage.contentBlocks = [
                    ...(currentAssistantMessage.contentBlocks || []),
                    ...blocks
                  ];
                  currentAssistantMessage.content += textContent;
                  // 更新 uuid（使用最后一个 assistant 消息的 uuid）
                  if (assistantUuid) {
                    currentAssistantMessage.sdkUuid = assistantUuid;
                  }
                } else {
                  // 创建新的 assistant 消息
                  currentAssistantMessage = {
                    role: 'assistant',
                    content: textContent,
                    timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
  
                    contentBlocks: blocks.length > 0 ? blocks : undefined,
                    sdkUuid: assistantUuid,
                  };
                }
              }
            }

            // 保存最后一个 assistant 消息
            if (currentAssistantMessage) {
              historyMessages.push(currentAssistantMessage);
            }

            setMessages(historyMessages);
            setTimeout(() => {
              setHistoryLoaded(true);
            }, 100);

            console.log(`✅ 已从 SDK 会话文件加载历史消息: ${historyMessages.length} 条`);
          } else {
            console.log('⚠️ 该对话没有 sdk_session_id，无法加载 SDK 历史消息');
            setMessages([]);
            setHistoryLoaded(true);
          }
        } catch (error) {
          console.error('加载 SDK 会话历史失败:', error);
          setMessages([]);
          setHistoryLoaded(true);
        }

        setIsResumeMode(true);
        return;
      }

      // 无 SDK resume 模式：新对话，空消息列表
      setIsResumeMode(false);
      setMessages([]);
      setHistoryLoaded(true);
    };

    loadHistory();
  }, [conversationId, useSdkResume, forkParams]);

  // 启动会话
  useEffect(() => {
    // 竞态保护：快速切换对话时，取消过时的异步操作结果
    let cancelled = false;

    const startSession = async () => {
      try {
        console.log('=== 启动基于 Query 的 Agent 会话 ===');
        console.log('conversationId:', conversationId);
        console.log('useSdkResume:', useSdkResume);

        // 自动确定项目根目录
        let projectRoot = '';
        if (typeof window !== 'undefined' && (window as any).process?.cwd) {
          projectRoot = (window as any).process.cwd();
        }

        // v4: 判断是否为 fork 模式
        let sdkSessionId: string | undefined;
        let forkSessionFlag: boolean | undefined;
        let resumeSessionAtFlag: string | undefined;

        if (forkParams) {
          // Fork 模式：使用父对话的 sdk_session_id + fork 参数
          sdkSessionId = forkParams.sdkSessionIdToResume;
          forkSessionFlag = true;
          resumeSessionAtFlag = forkParams.resumeSessionAt;
          console.log('🔀 Fork 模式启动:', { sdkSessionId, resumeSessionAt: resumeSessionAtFlag });
        } else if (conversationId) {
          // 正常 resume 模式
          try {
            const convResult = await client.getById({ conversationId });
            if (cancelled) return; // 检查是否已被取消
            console.log('getById 结果:', convResult);
            if (convResult.conversation?.sdk_session_id) {
              sdkSessionId = convResult.conversation.sdk_session_id;
              console.log('✅ 找到 sdk_session_id，将 resume 会话:', sdkSessionId);
            } else {
              console.log('⚠️ 该对话没有 sdk_session_id，将创建新会话');
            }
          } catch (error) {
            console.error('❌ 获取 sdk_session_id 失败:', error);
          }
        }

        if (cancelled) return; // 在创建会话前再次检查

        // 检查 Profile 配置是否完整
        const { useSettingsStore } = await import('@/stores/settings-store');
        const { isProfileComplete } = await import('@/types/settings');
        const settingsState = useSettingsStore.getState();
        const activeId = settingsState.settings.ai.activeProfileId;
        const activeProfile = settingsState.settings.profiles[activeId];
        if (!activeProfile || !isProfileComplete(activeProfile)) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: '当前模型方案未配置完整，请先前往设置页面完成配置（API Key、Base URL、模型映射）。',
            timestamp: Date.now(),
            type: 'text',
          }]);
          return;
        }

        const response = await client.createQueryBasedSession({
          allowedTools: ['Read', 'Glob', 'Grep'],
          context,
          enableSkills: true,
          projectRoot,
          conversationId: conversationId || undefined,
          resume: sdkSessionId,
          forkSession: forkSessionFlag,           // v4: 分叉参数
          resumeSessionAt: resumeSessionAtFlag,   // v4: 截断位置
          isForkNewConversation: forkParams?.isForkNewConversation, // v4: 区分分叉新对话/编辑重发
        });

        // 关键：异步操作完成后检查是否已被取消（用户已切换到其他对话）
        if (cancelled) {
          // 会话已创建但不再需要，立即关闭
          if (response.sessionId) {
            console.log('会话已创建但被取消（用户快速切换），关闭:', response.sessionId);
            client.closeQueryBasedSession({ sessionId: response.sessionId });
          }
          return;
        }

        console.log('createSession 响应:', response);

        if (response.error) {
          console.error('❌ 启动会话失败:', response.error);
          return;
        }

        const newSessionId = response.sessionId!;
        setSessionId(newSessionId);
        // 同步后端初始权限模式到 UI
        if (response.permissionMode) {
          setPermissionMode(response.permissionMode as PermissionMode);
        }
        console.log('✅ 会话已启动:', {
          sessionId: newSessionId,
          mode: sdkSessionId ? '(resume)' : '(new)',
          sdkMode: useSdkResume ? 'SDK模式' : '数据库模式'
        });
        setIsSessionReady(true);

        // v4: 编辑重发模式下，如果有 editedMessage，会话 ready 后自动发送
        // 纯分叉新对话（isForkNewConversation=true）不自动发送，只加载历史等待用户输入
        if (forkParams?.editedMessage && !forkParams?.isForkNewConversation && newSessionId) {
          console.log('🔀 编辑重发模式: 自动发送编辑后的消息:', forkParams.editedMessage);
          // 稍微延迟确保会话已完全初始化
          setTimeout(async () => {
            if (cancelled) return; // 延迟执行前再次检查
            try {
              // 先添加用户消息到 UI
              setMessages(prev => [
                ...prev,
                {
                  role: 'user',
                  content: forkParams.editedMessage!,
                  timestamp: Date.now(),
                  forkPointSdkUuid: forkParams.resumeSessionAt,
                },
                {
                  role: 'assistant',
                  content: '',
                  timestamp: Date.now(),
                  isStreaming: true,
                  contentBlocks: [],
                }
              ]);
              setIsLoading(true);
              await client.sendQueryBasedSessionMessage({
                sessionId: newSessionId,
                content: forkParams.editedMessage!
              });
            } catch (error) {
              console.error('编辑重发模式自动发送失败:', error);
            }
          }, 500);
        } else if (forkParams?.isForkNewConversation) {
          // 纯分叉新对话：SDK fork 后会话文件中已包含截断历史，
          // 历史消息会通过上面的 loadHistory useEffect 自动加载展示
          console.log('🔀 纯分叉模式: 等待历史加载完成，用户自行输入新消息');
        }
      } catch (error) {
        if (!cancelled) {
          console.error('❌ 启动会话异常:', error);
        }
      }
    };

    startSession();

    // 组件卸载或 conversationId/forkParams 变化时：标记取消 + 关闭旧会话
    return () => {
      cancelled = true;
      if (sessionIdRef.current) {
        console.log('关闭会话:', sessionIdRef.current);
        client.closeQueryBasedSession({ sessionId: sessionIdRef.current });
        sessionIdRef.current = null;
      }
      // 重置会话状态，避免残留的旧会话 ID 被后续操作使用
      setSessionId(null);
      setIsSessionReady(false);
    };
  }, [conversationId, forkParams]); // 当 conversationId 或 forkParams 变化时重启会话

  // 监听会话消息
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = rendererEvents.queryBasedSessionMessage.listen((data) => {
      if (data.sessionId !== sessionId) return;

      const extendedMsg = data.message;

      // ==================== 前端消息接收日志 ====================
      console.log('');
      console.log('══════════════════════════════════════════════════════════════════');
      console.log('📨 [前端] 收到会话消息');
      console.log('══════════════════════════════════════════════════════════════════');
      console.log('  Session ID:', data.sessionId?.substring(0, 8));
      console.log('  消息类型:', extendedMsg.type);
      console.log('  时间戳:', new Date(extendedMsg.timestamp || Date.now()).toISOString());
      console.log('  内容:', extendedMsg.content ? extendedMsg.content.substring(0, 100) + (extendedMsg.content.length > 100 ? '...' : '') : '(无)');
      if (extendedMsg.toolName) console.log('  工具名称:', extendedMsg.toolName);
      if (extendedMsg.status) console.log('  状态:', extendedMsg.status);
      if (extendedMsg.error) console.log('  错误:', extendedMsg.error);
      if (extendedMsg.isReplay) console.log('  重放消息: 是');
      console.log('══════════════════════════════════════════════════════════════════');
      console.log('');

      // 如果是重放消息且不显示重放消息，跳过
      if (extendedMsg.isReplay && !showReplayMessages) {
        console.log('⚠️  跳过重放消息（showReplayMessages=false）');
        return;
      }

      setMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;

        console.log('🔄 [前端] 更新消息状态:');
        console.log('  当前消息数:', updated.length);
        console.log('  最后一条索引:', lastIdx);
        console.log('  最后一条角色:', lastIdx >= 0 ? updated[lastIdx].role : 'N/A');
        console.log('  最后一条流式状态:', lastIdx >= 0 ? updated[lastIdx].isStreaming : 'N/A');

        // v4: 处理 assistant_uuid 消息（将 uuid 和 model 关联到当前 assistant 消息）
        if (extendedMsg.type === 'assistant_uuid') {
          if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
            updated[lastIdx] = {
              ...updated[lastIdx],
              sdkUuid: extendedMsg.uuid,
              ...(extendedMsg.model ? { model: extendedMsg.model } : {}),
            };
          }
          return updated;
        }

        // 处理用户消息
        if (extendedMsg.type === 'user') {
          const newUserMessage: Message = {
            role: 'user',
            content: extendedMsg.content || '',
            timestamp: extendedMsg.timestamp || Date.now(),
          };
          updated.push(newUserMessage);
          setHistoryLoaded(true);  // 收到消息后标记历史已加载
          return updated;
        }

        if (lastIdx >= 0 && updated[lastIdx].role === 'assistant' && updated[lastIdx].isStreaming) {
          // 更新最后一条流式消息
          console.log('  → 更新流式消息，追加内容块');
          const lastMsg = updated[lastIdx];
          const blocks = lastMsg.contentBlocks || [];

          // 问题1修复：tool_result 应该更新之前的 tool_use 块，而不是创建新块
          if (extendedMsg.type === 'tool_result' && extendedMsg.toolUseId) {
            // 查找对应的 tool_use 块
            const toolUseIdx = blocks.findIndex(b => b.toolUseId === extendedMsg.toolUseId);
            if (toolUseIdx >= 0) {
              // 更新找到的 tool_use 块
              const updatedBlocks = [...blocks];
              updatedBlocks[toolUseIdx] = {
                ...updatedBlocks[toolUseIdx],
                toolOutput: extendedMsg.toolOutput,
                isError: extendedMsg.isError,
              };
              updated[lastIdx] = {
                ...lastMsg,
                contentBlocks: updatedBlocks,
              };
              return updated;
            }
          }

          // 对于 thinking 类型，合并到最后一个 thinking 块
          if (extendedMsg.type === 'thinking' && blocks.length > 0 && blocks[blocks.length - 1].type === 'thinking') {
            const lastBlock = blocks[blocks.length - 1];
            const mergedBlock: ContentBlock = {
              ...lastBlock,
              content: (lastBlock.content || '') + (extendedMsg.content || ''),
            };
            updated[lastIdx] = {
              ...lastMsg,
              contentBlocks: [...blocks.slice(0, -1), mergedBlock],
              isStreaming: true,
            };
            return updated;
          }

          // 对于文本类型，如果最后一个块也是 text，合并它们而不是创建新块
          if (extendedMsg.type === 'text' && blocks.length > 0 && blocks[blocks.length - 1].type === 'text') {
            // 合并到最后一个文本块
            const lastBlock = blocks[blocks.length - 1];
            const mergedBlock: ContentBlock = {
              ...lastBlock,
              content: (lastBlock.content || '') + (extendedMsg.content || ''),
            };
            updated[lastIdx] = {
              ...lastMsg,
              contentBlocks: [...blocks.slice(0, -1), mergedBlock],
              content: (lastMsg.content || '') + (extendedMsg.content || ''),
              isStreaming: true, // 文本类型继续保持流式状态
            };
          } else {
            // tool_result 不作为独立块添加，结果已通过上面的逻辑整合到 tool_use 块中
            if (extendedMsg.type === 'tool_result') {
              console.log('⚠️ tool_result 未找到对应 tool_use，忽略:', extendedMsg.toolUseId);
              return updated;
            }

            // tool_use 类型：查找同 toolUseId 的已有块并更新（统一逻辑，和历史加载一致）
            if (extendedMsg.type === 'tool_use' && extendedMsg.toolUseId) {
              const existingIdx = blocks.findIndex(
                b => b.toolUseId === extendedMsg.toolUseId
              );
              if (existingIdx >= 0) {
                // 更新已有块：只在有新 input 时覆盖（避免 progress 事件的 null 覆盖已有 input）
                const existingBlock = blocks[existingIdx];
                const updatedBlocks = [...blocks];
                updatedBlocks[existingIdx] = {
                  ...existingBlock,
                  type: 'tool_use',
                  toolName: extendedMsg.toolName || existingBlock.toolName,
                  toolInput: extendedMsg.toolInput ?? existingBlock.toolInput,
                  timestamp: extendedMsg.timestamp || Date.now(),
                };
                updated[lastIdx] = {
                  ...lastMsg,
                  contentBlocks: updatedBlocks,
                  isStreaming: true,
                };
                return updated;
              }
            }

            // 创建新块
            const newBlock: ContentBlock = {
              type: extendedMsg.type,
              content: extendedMsg.content,
              toolName: extendedMsg.toolName,
              toolInput: extendedMsg.toolInput,
              toolOutput: extendedMsg.toolOutput,
              toolUseId: extendedMsg.toolUseId,
              status: extendedMsg.status,
              error: extendedMsg.error,
              isError: extendedMsg.isError,
              timestamp: extendedMsg.timestamp || Date.now(),
              citations: extendedMsg.citations,
              isReplay: extendedMsg.isReplay,
              // Hook 事件相关字段
              sessionStartSource: extendedMsg.sessionStartSource,
              sessionEndReason: extendedMsg.sessionEndReason,
              stopHookActive: extendedMsg.stopHookActive,
              failedToolName: extendedMsg.failedToolName,
              failedToolError: extendedMsg.failedToolError,
              notificationTitle: extendedMsg.notificationTitle,
              notificationMessage: extendedMsg.notificationMessage,
              notificationType: extendedMsg.notificationType,
              taskId: extendedMsg.taskId,
              taskStatus: extendedMsg.taskStatus,
              taskSummary: extendedMsg.taskSummary,
            };

            updated[lastIdx] = {
              ...lastMsg,
              contentBlocks: [...blocks, newBlock],
              // 对于文本类型，同时更新 content 字段以保持兼容
              content: extendedMsg.type === 'text'
                ? (lastMsg.content || '') + (extendedMsg.content || '')
                : lastMsg.content,
              isStreaming: extendedMsg.type !== 'result'  // 收到结果时结束流式状态
            };
          }
        } else {
          // tool_result 不应创建新的助手消息
          if (extendedMsg.type === 'tool_result') {
            return updated;
          }

          // 创建新的助手消息
          console.log('  → 创建新的助手消息');
          const newBlock: ContentBlock = {
            type: extendedMsg.type,
            content: extendedMsg.content,
            toolName: extendedMsg.toolName,
            toolInput: extendedMsg.toolInput,
            toolOutput: extendedMsg.toolOutput,
            toolUseId: extendedMsg.toolUseId,
            status: extendedMsg.status,
            error: extendedMsg.error,
            isError: extendedMsg.isError,
            timestamp: extendedMsg.timestamp || Date.now(),
            citations: extendedMsg.citations,
            isReplay: extendedMsg.isReplay,
            // Hook 事件相关字段
            sessionStartSource: extendedMsg.sessionStartSource,
            sessionEndReason: extendedMsg.sessionEndReason,
            stopHookActive: extendedMsg.stopHookActive,
            failedToolName: extendedMsg.failedToolName,
            failedToolError: extendedMsg.failedToolError,
            notificationTitle: extendedMsg.notificationTitle,
            notificationMessage: extendedMsg.notificationMessage,
            notificationType: extendedMsg.notificationType,
            taskId: extendedMsg.taskId,
            taskStatus: extendedMsg.taskStatus,
            taskSummary: extendedMsg.taskSummary,
          };

          const newMessage: Message = {
            role: 'assistant',
            content: extendedMsg.type === 'text' ? (extendedMsg.content || '') : '',
            timestamp: Date.now(),
            isStreaming: extendedMsg.type !== 'result',
            contentBlocks: [newBlock],
            model: extendedMsg.model,
          };
          updated.push(newMessage);
        }

        return updated;
      });

      // 收到结果消息时结束加载状态
      if (extendedMsg.type === 'result') {
        setIsLoading(false);
        setHistoryLoaded(true);  // 确保历史加载标记已设置
      }
    });

    return () => {
      unsubscribe();
    };
  }, [sessionId, showReplayMessages]);

  // 监听会话完成事件
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = rendererEvents.queryBasedSessionComplete.listen((data) => {
      if (data.sessionId !== sessionId) return;

      console.log('收到会话完成事件:', data);

      // 结束加载状态
      setIsLoading(false);

      // 更新最后一条消息的流式状态
      setMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
          updated[lastIdx] = {
            ...updated[lastIdx],
            isStreaming: false
          };
        }
        return updated;
      });
    });

    return () => {
      unsubscribe();
    };
  }, [sessionId]);

  // 监听权限确认请求事件
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = rendererEvents.permissionRequest.listen((data) => {
      if (data.sessionId !== sessionId) return;

      console.log('📋 收到权限确认请求:', data);

      // 将权限请求作为内容块插入到当前 assistant 消息中
      setMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;

        // 找到当前 assistant 消息，插入权限请求块
        if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
          const lastMsg = updated[lastIdx];
          const blocks = lastMsg.contentBlocks || [];
          const newBlock: ContentBlock = {
            type: 'permission_request',
            timestamp: Date.now(),
            permissionRequestId: data.requestId,
            permissionToolName: data.toolName,
            permissionInput: data.toolInput,
            permissionDecisionReason: data.decisionReason,
          };
          updated[lastIdx] = {
            ...lastMsg,
            contentBlocks: [...blocks, newBlock],
          };
        }

        return updated;
      });
    });

    // 监听后端权限模式变更（双向同步）
    const unsubPermission = rendererEvents.permissionModeChanged.listen((data) => {
      if (data.sessionId !== sessionId) return;
      console.log('🔄 权限模式已由后端变更:', data.mode);
      setPermissionMode(data.mode as PermissionMode);
    });

    return () => {
      unsubscribe();
      unsubPermission();
    };
  }, [sessionId]);

  // 监听 Agent 通知事件（Notification hook 触发的系统级通知）
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = rendererEvents.agentNotification.listen((data) => {
      if (data.sessionId !== sessionId) return;
      console.log('🔔 收到 Agent 通知:', data);
      // 未来可接入 Toast 组件展示通知
    });

    return () => {
      unsubscribe();
    };
  }, [sessionId]);

  // ==================== v4: 编辑重发和分叉处理 ====================

  /**
   * 编辑重发处理
   * 截断消息到编辑点的 assistant 消息，然后在当前对话内重新发送
   */
  const handleEditResend = useCallback((messageIndex: number, newContent: string) => {
    if (!conversationId) return;

    // 找到该用户消息前面最近的 assistant 消息的 sdkUuid 作为截断点
    let targetAssistantUuid: string | undefined;
    let targetAssistantIdx = -1;
    for (let i = messageIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && messages[i].sdkUuid) {
        targetAssistantUuid = messages[i].sdkUuid;
        targetAssistantIdx = i;
        break;
      }
    }

    if (!targetAssistantUuid || targetAssistantIdx < 0) {
      console.warn('编辑的是第一条消息，无法使用 resumeSessionAt，暂不支持');
      return;
    }

    // 截断消息：保留到 forkPoint assistant（含）
    const truncatedMessages = messages.slice(0, targetAssistantIdx + 1);
    setMessages(truncatedMessages);

    // 通过 store action 处理（设置 forkParams + 创建分支记录）
    editResendAction({
      forkPointSdkUuid: targetAssistantUuid,
      editedMessage: newContent,
    });
  }, [conversationId, messages, editResendAction]);

  /**
   * 从某条 assistant 消息处分叉新对话
   */
  const handleFork = useCallback((assistantSdkUuid: string) => {
    if (!conversationId) return;
    forkConversation({
      parentConversationId: conversationId,
      forkMessageSdkUuid: assistantSdkUuid,
    });
  }, [conversationId, forkConversation]);

  /**
   * 设计原则：conversation.sdk_session_id 始终保持为原始值，不随分支切换而修改。
   * 分支的 session ID 存储在 conversation_branches 表中。
   * 切换分支时，关闭旧会话并创建新会话 resume 目标分支的 session。
   */
  // 权限模式名称映射
  const modeLabels: Record<string, string> = {
    'bypassPermissions': '自动执行',
    'acceptEdits': '允许编辑',
    'default': '需确认',
    'plan': '仅规划',
  };

  // 在对话中插入模式切换通知
  const insertModeChangeNotice = useCallback((newMode: string) => {
    setMessages(prev => {
      const updated = [...prev];
      const lastIdx = updated.length - 1;
      const noticeBlock: ContentBlock = {
        type: 'status',
        status: `权限模式已切换为「${modeLabels[newMode] || newMode}」`,
        timestamp: Date.now(),
      };
      // 插入到当前 assistant 消息中，或创建新 assistant 消息
      if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
        const lastMsg = updated[lastIdx];
        updated[lastIdx] = {
          ...lastMsg,
          contentBlocks: [...(lastMsg.contentBlocks || []), noticeBlock],
        };
      } else {
        updated.push({
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          contentBlocks: [noticeBlock],
        });
      }
      return updated;
    });
  }, []);

  // 权限确认响应回调：更新消息中对应权限请求块的状态
  const handlePermissionResolved = useCallback(async (requestId: string, behavior: 'allow' | 'deny' | 'always_allow', denyMessage?: string) => {
    setMessages(prev => prev.map(msg => {
      if (!msg.contentBlocks) return msg;
      const hasTarget = msg.contentBlocks.some(b => b.permissionRequestId === requestId);
      if (!hasTarget) return msg;
      return {
        ...msg,
        contentBlocks: msg.contentBlocks.map(b =>
          b.permissionRequestId === requestId
            ? { ...b, permissionResolved: behavior, ...(denyMessage ? { permissionDenyMessage: denyMessage } : {}) }
            : b
        ),
      };
    }));

    // "总是允许"：切换到自动执行模式并插入通知
    if (behavior === 'always_allow' && sessionId) {
      setPermissionMode('bypassPermissions');
      await client.setPermissionMode({ sessionId, mode: 'bypassPermissions' });
      // 插入模式切换通知
      insertModeChangeNotice('bypassPermissions');
    }
  }, [sessionId]);

  const handleSend = async () => {
    if (!input.trim() || isLoading || !sessionId || !isSessionReady) return;

    const userMessage = input;
    setInput('');

    // 构建实际发送的内容：如果有引用文章或片段，在消息前追加引用提示
    let messageToSend = userMessage;
    const prefixParts: string[] = [];

    // 清理文本中的换行符，确保引用格式每条引用都在单行内，方便后续解析
    const sanitize = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

    // 整篇文章引用：只传 ID，agent 通过 ReadArticle tool 读取
    if (referencedArticles.length > 0) {
      const refLines = referencedArticles.map(a =>
        `- 《${sanitize(a.title)}》(articleId: ${a.id})${a.siteName ? ` - ${sanitize(a.siteName)}` : ''}`
      ).join('\n');
      prefixParts.push(`[引用文章] 以下文章已引用，可使用 ReadArticle 工具读取完整内容：\n${refLines}`);
      clearReferencedArticles();
    }

    // 文字片段引用：直接内联内容，不需要 agent 调 tool
    if (quotedSnippets.length > 0) {
      const snippetLines = quotedSnippets.map(s =>
        `来自《${sanitize(s.articleTitle)}》:\n> ${sanitize(s.text)}`
      ).join('\n\n');
      prefixParts.push(`[引用片段]\n${snippetLines}`);
      clearQuotedSnippets();
    }

    if (prefixParts.length > 0) {
      messageToSend = `${prefixParts.join('\n\n')}\n\n${userMessage}`;
    }

    // ==================== 前端发送消息日志 ====================
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    [前端] 发送用户消息                          ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('  Session ID:', sessionId?.substring(0, 8));
    console.log('  消息长度:', messageToSend.length, '字符');
    console.log('  引用文章数:', referencedArticles.length);
    console.log('  用户消息:', userMessage);
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');

    // 创建用户消息对象（存储完整内容含引用前缀，由 parseUserMessageReferences 解析渲染）
    const newUserMessage: Message = {
      role: 'user',
      content: messageToSend,
      timestamp: Date.now()
    };

    // 添加用户消息
    setMessages(prev => [...prev, newUserMessage]);

    // 添加一个空的助手消息占位，准备接收流式响应
    setMessages(prev => [
      ...prev,
      {
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
        contentBlocks: []
      }
    ]);

    setIsLoading(true);

    try {
      // 发送消息到会话（包含引用提示）
      await client.sendQueryBasedSessionMessage({ sessionId, content: messageToSend });
    } catch (error) {
      console.error('发送消息失败:', error);
      setMessages(prev => [
        ...prev.slice(0, -1), // 移除占位消息
        {
          role: 'assistant',
          content: `错误: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: Date.now(),
          contentBlocks: [{
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
            timestamp: Date.now()
          }]
        }
      ]);
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-lg border">
      {/* 消息区域 */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-20">
            <p>开始与 Agent 对话...</p>
          </div>
        )}

        {(() => {
          // 仅最后一条用户消息可编辑重发，历史消息只读
          const lastUserIdx = messages.reduce((acc, m, i) => m.role === 'user' ? i : acc, -1);
          return messages.map((message, index) => (
            <MessageItem
              key={index}
              message={message}
              messageIndex={index}
              onEditResend={index === lastUserIdx ? handleEditResend : undefined}
              onFork={handleFork}
              sessionId={sessionId}
              onPermissionResolved={handlePermissionResolved}
            />
          ));
        })()}

        <div ref={messagesEndRef} />
      </div>

      {/* 输入区域 */}
      <div className="border-t p-4 bg-gray-50">
        {/* 引用芯片区域（整篇文章 + 文字片段） */}
        {(referencedArticles.length > 0 || quotedSnippets.length > 0) && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {/* 蓝色芯片：整篇文章引用 */}
            {referencedArticles.map(article => (
              <span
                key={article.id}
                className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 border border-blue-200 rounded-full text-xs text-blue-700"
                title={article.title}
              >
                <span className="max-w-[160px] truncate">{article.title}</span>
                <button
                  onClick={() => removeReferencedArticle(article.id)}
                  className="flex-shrink-0 p-0.5 rounded-full hover:bg-blue-200 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            {/* 紫色芯片：文字片段引用 */}
            {quotedSnippets.map(snippet => (
              <span
                key={snippet.id}
                className="inline-flex items-center gap-1 px-2 py-1 bg-purple-50 border border-purple-200 rounded-full text-xs text-purple-700"
                title={`来自《${snippet.articleTitle}》: ${snippet.text}`}
              >
                <span className="max-w-[120px] truncate">{`"${snippet.text}"`}</span>
                <span className="text-purple-400 flex-shrink-0">- {snippet.articleTitle.length > 8 ? snippet.articleTitle.slice(0, 8) + '...' : snippet.articleTitle}</span>
                <button
                  onClick={() => removeQuotedSnippet(snippet.id)}
                  className="flex-shrink-0 p-0.5 rounded-full hover:bg-purple-200 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex space-x-2">
          <div className="flex-1 relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder={placeholder}
              className="w-full border border-gray-300 rounded-lg p-3 pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows={2}
              disabled={isLoading || !isSessionReady}
            />
            {/* 思考等级选择 — 通过 setMaxThinkingTokens 即时生效 */}
            <div className="absolute right-2 bottom-2 flex items-center">
              <Brain size={14} className={thinkingLevel > 0 ? 'text-blue-500' : 'text-gray-400'} />
              <select
                value={thinkingLevel}
                onChange={async (e) => {
                  const newLevel = Number(e.target.value);
                  setThinkingLevel(newLevel);
                  if (sessionId) {
                    await client.setMaxThinkingTokens({
                      sessionId,
                      maxThinkingTokens: newLevel === 0 ? 0 : newLevel,
                    });
                  }
                }}
                className={`bg-transparent border-none text-xs cursor-pointer focus:outline-none pl-1 pr-0 py-0 ${
                  thinkingLevel > 0 ? 'text-blue-600' : 'text-gray-400'
                }`}
                title="思考深度"
              >
                <option value={0}>关闭</option>
                <option value={2000}>低</option>
                <option value={6000}>中</option>
                <option value={10000}>高</option>
              </select>
            </div>
          </div>
          {isLoading ? (
            <button
              onClick={async () => {
                if (sessionId) {
                  await client.interruptQueryBasedSession({ sessionId });
                  setIsLoading(false);
                }
              }}
              className="px-6 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors self-end"
            >
              停止
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim() || !isSessionReady}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors self-end"
            >
              发送
            </button>
          )}
        </div>
        {/* 底部工具栏：权限模式 + 会话状态 */}
        <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
          {/* 权限模式选择 */}
          <div className="flex items-center gap-1">
            <Shield size={12} className="text-gray-400" />
            <select
              value={permissionMode}
              onChange={async (e) => {
                const newMode = e.target.value as PermissionMode;
                setPermissionMode(newMode);
                if (sessionId) {
                  await client.setPermissionMode({ sessionId, mode: newMode });
                  insertModeChangeNotice(newMode);
                }
              }}
              className="bg-transparent border-none text-xs text-gray-600 cursor-pointer focus:outline-none hover:text-gray-900"
            >
              <option value="bypassPermissions">自动执行</option>
              <option value="acceptEdits">允许编辑</option>
              <option value="default">需确认</option>
              <option value="plan">仅规划</option>
            </select>
          </div>
          {showStatusHint && (
            <>
              <span className="text-gray-300">|</span>
              <span>{sessionId ? `${sessionId.substring(0, 8)}...` : '连接中...'}</span>
              {isSessionReady && <span className="text-green-600">● 就绪</span>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}