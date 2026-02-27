'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Citation } from '@/types/electron-api';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import { ToolBlock } from './ToolBlock';
import { MarkdownRenderer } from './MarkdownRenderer';
import { Pencil, GitBranch, ChevronLeft, ChevronRight, X } from 'lucide-react';
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
  // 分支信息（v4 新增）
  branchVersions?: number;   // 此分叉点的分支总数
  currentBranch?: number;    // 当前显示的分支索引
  forkPointSdkUuid?: string; // 用户消息上记录对应的分叉点 assistant UUID
}

/**
 * 内容块类型
 * 按照实际接收顺序存储和渲染
 */
interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'status' | 'error' | 'result' | 'user';
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
  onSwitchBranch,
}: {
  message: Message;
  messageIndex: number;
  onEditResend?: (index: number, newContent: string) => void;
  onFork?: (assistantSdkUuid: string) => void;
  onSwitchBranch?: (sdkUuid: string, direction: 'prev' | 'next') => void;
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
            {/* 分支切换 UI（用户消息+AI回复作为整体切换） */}
            {message.branchVersions && message.branchVersions > 1 && (
              <div className="flex items-center gap-1 mb-2 text-xs text-gray-500">
                <button
                  onClick={() => message.forkPointSdkUuid && onSwitchBranch?.(message.forkPointSdkUuid, 'prev')}
                  disabled={(message.currentBranch ?? 0) <= 0}
                  className="p-0.5 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="font-mono">
                  {(message.currentBranch ?? 0) + 1}/{message.branchVersions}
                </span>
                <button
                  onClick={() => message.forkPointSdkUuid && onSwitchBranch?.(message.forkPointSdkUuid, 'next')}
                  disabled={(message.currentBranch ?? 0) >= (message.branchVersions - 1)}
                  className="p-0.5 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
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
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center">
            <span className="text-white text-sm font-medium">AI</span>
          </div>
          <div className="flex-1 min-w-0">
            {/* 按照接收顺序渲染所有内容块 */}
            {message.contentBlocks && message.contentBlocks.length > 0 ? (
              <div className="space-y-2">
                {message.contentBlocks.map((block, idx) => (
                  <ContentBlockItem key={idx} block={block} />
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
function ContentBlockItem({ block }: { block: ContentBlock }) {
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
      return (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-purple-800 mb-2">
            <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></div>
            思考过程
          </div>
          {block.content && (
            <div className="text-xs text-purple-700 whitespace-pre-wrap bg-purple-100 rounded p-2">
              {block.content}
            </div>
          )}
        </div>
      );

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

            // v4: 查询分支信息，恢复 branchVersions 和 currentBranch
            if (conversationId) {
              try {
                const branchesResult = await client.getBranches({ conversationId });
                if (!branchesResult.error && branchesResult.branches.length > 0) {
                  // 按 fork_point_sdk_uuid 分组统计分支数量
                  const branchCountMap = new Map<string, number>();
                  for (const branch of branchesResult.branches) {
                    const count = branchCountMap.get(branch.fork_point_sdk_uuid) || 0;
                    branchCountMap.set(branch.fork_point_sdk_uuid, count + 1);
                  }

                  // 为分叉点之后的用户消息设置分支信息
                  // +1 因为原始版本本身也算一个版本
                  for (let i = 0; i < historyMessages.length; i++) {
                    const msg = historyMessages[i];
                    if (msg.role === 'assistant' && msg.sdkUuid && branchCountMap.has(msg.sdkUuid)) {
                      const versions = branchCountMap.get(msg.sdkUuid)! + 1;
                      // 将分支信息设置到 forkPoint 后面的用户消息上
                      // 这样切换时用户消息和AI回复一起切换
                      if (i + 1 < historyMessages.length && historyMessages[i + 1].role === 'user') {
                        historyMessages[i + 1].branchVersions = versions;
                        historyMessages[i + 1].currentBranch = 0;
                        historyMessages[i + 1].forkPointSdkUuid = msg.sdkUuid;
                      }
                    }
                  }

                  console.log('✅ 已恢复分支信息:', branchCountMap.size, '个分叉点');
                }
              } catch (error) {
                console.warn('恢复分支信息失败（不影响正常使用）:', error);
              }
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

      // 传统模式：从数据库加载历史消息
      setIsResumeMode(false);

      try {
        // 先设置 historyLoaded 为 false，防止在加载期间保存消息
        setHistoryLoaded(false);

        const result = await client.getMessages({ conversationId });
        if (result.error) {
          console.error('加载历史消息失败:', result.error);
          return;
        }

        // 转换数据库消息格式到组件消息格式
        const historyMessages: Message[] = result.messages.map((msg) => {
          const message: Message = {
            role: msg.role as 'user' | 'assistant',
            content: msg.content,
            timestamp: msg.timestamp,
          };

          // 解析 content_blocks
          if (msg.content_blocks) {
            try {
              const blocks = JSON.parse(msg.content_blocks) as ContentBlock[];
              message.contentBlocks = blocks;
            } catch {
              // 解析失败，忽略 content_blocks
            }
          }

          return message;
        });

        setMessages(historyMessages);

        // 延迟设置 historyLoaded，确保消息状态已更新
        // 这样可以防止在加载过程中触发保存逻辑
        setTimeout(() => {
          setHistoryLoaded(true);
        }, 100);

        console.log('已从数据库加载历史消息:', historyMessages.length, '条');
      } catch (error) {
        console.error('加载历史消息失败:', error);
      }
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

        const response = await client.createQueryBasedSession({
          model: 'claude-sonnet-4-5-20250929',
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
              // 先添加用户消息到 UI（附带分支信息，立即显示切换 UI）
              const branchCount = forkParams.branchCount || 2; // 至少 原始+当前分支=2
              setMessages(prev => [
                ...prev,
                {
                  role: 'user',
                  content: forkParams.editedMessage!,
                  timestamp: Date.now(),
                  branchVersions: branchCount,
                  currentBranch: branchCount - 1,  // 当前是最新的分支
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

        // v4: 处理 assistant_uuid 消息（将 uuid 关联到当前 assistant 消息）
        if (extendedMsg.type === 'assistant_uuid') {
          if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
            updated[lastIdx] = {
              ...updated[lastIdx],
              sdkUuid: extendedMsg.uuid,
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
          };

          const newMessage: Message = {
            role: 'assistant',
            content: extendedMsg.type === 'text' ? (extendedMsg.content || '') : '',
            timestamp: Date.now(),
            isStreaming: extendedMsg.type !== 'result',
            contentBlocks: [newBlock],
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
   * 从 SDK JSONL 历史中解析 forkPoint 之后的消息
   * 复用的辅助函数，避免重复代码
   */
  const parseMessagesAfterForkPoint = (rawMessages: any[], forkPointUuid: string): Message[] => {
    let foundForkPoint = false;
    const afterMessages: Message[] = [];
    let currentAssistantMsg: Message | null = null;

    for (const msg of rawMessages) {
      if (msg.isMeta) continue;

      // 找到分叉点
      if (!foundForkPoint) {
        if (msg.type === 'assistant' && msg.uuid === forkPointUuid) {
          foundForkPoint = true;
        }
        continue;
      }

      // 分叉点之后的消息
      const isUser = msg.type === 'user';
      if (isUser) {
        // 跳过只包含 tool_result 的用户消息
        if (Array.isArray(msg.content)) {
          const onlyToolResult = msg.content.every((b: any) => b?.type === 'tool_result');
          if (onlyToolResult) continue;
        }
        if (!msg.content || (Array.isArray(msg.content) && msg.content.length === 0)) continue;

        if (currentAssistantMsg) {
          afterMessages.push(currentAssistantMsg);
          currentAssistantMsg = null;
        }

        let textContent = '';
        if (typeof msg.content === 'string') {
          textContent = msg.content;
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (typeof block === 'string') textContent += block;
            else if (block?.type === 'text') textContent += block.text || '';
          }
        }
        if (!textContent.trim()) continue;

        afterMessages.push({
          role: 'user',
          content: textContent,
          timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
        });
      } else {
        // assistant 消息
        let textContent = '';
        const blocks: ContentBlock[] = [];
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (typeof block === 'string') {
              textContent += block;
              blocks.push({ type: 'text', content: block, timestamp: Date.now() });
            } else if (block?.type === 'text') {
              textContent += block.text || '';
              if (block.text) blocks.push({ type: 'text', content: block.text, timestamp: Date.now() });
            } else if (block?.type === 'tool_use' || block?.type === 'server_tool_use') {
              blocks.push({
                type: 'tool_use',
                id: block.id,
                toolName: block.name,
                toolInput: block.input,
                toolUseId: block.id,
                timestamp: Date.now(),
              });
            }
          }
        } else if (typeof msg.content === 'string') {
          textContent = msg.content;
          if (msg.content) blocks.push({ type: 'text', content: msg.content, timestamp: Date.now() });
        }

        if (currentAssistantMsg) {
          currentAssistantMsg.contentBlocks = [...(currentAssistantMsg.contentBlocks || []), ...blocks];
          currentAssistantMsg.content += textContent;
          if (msg.uuid) currentAssistantMsg.sdkUuid = msg.uuid;
        } else {
          currentAssistantMsg = {
            role: 'assistant',
            content: textContent,
            timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
            contentBlocks: blocks.length > 0 ? blocks : undefined,
            sdkUuid: msg.uuid || undefined,
          };
        }
      }
    }
    if (currentAssistantMsg) afterMessages.push(currentAssistantMsg);
    return afterMessages;
  };

  /**
   * 重建会话（切换分支后需要以新的 sdk_session_id resume）
   * 关闭旧会话，创建新会话
   */
  const recreateSession = useCallback(async (targetSdkSessionId: string) => {
    if (!conversationId) return;

    // 使用 ref 获取最新的 sessionId，避免闭包过期
    const currentSessionId = sessionIdRef.current;
    if (currentSessionId) {
      try {
        await client.closeQueryBasedSession({ sessionId: currentSessionId });
      } catch (e) {
        console.warn('关闭旧会话失败（可忽略）:', e);
      }
    }

    // 创建新会话，resume 选中的分支
    let projectRoot = '';
    if (typeof window !== 'undefined' && (window as any).process?.cwd) {
      projectRoot = (window as any).process.cwd();
    }
    const response = await client.createQueryBasedSession({
      model: 'claude-sonnet-4-5-20250929',
      allowedTools: ['Read', 'Glob', 'Grep'],
      context,
      enableSkills: true,
      projectRoot,
      conversationId: conversationId || undefined,
      resume: targetSdkSessionId,
    });

    if (!response.error && response.sessionId) {
      setSessionId(response.sessionId);
      setIsSessionReady(true);
      console.log('✅ 分支切换后会话已重建:', response.sessionId);
    }
  }, [conversationId, context]);

  /**
   * 获取原始对话的 sdk_session_id（不含分支）
   * 对话的 sdk_session_id 保持不变（始终为原始值），分支 session 存在 branches 表中
   */
  const getOriginalSdkSessionId = useCallback(async (): Promise<string | null> => {
    if (!conversationId) return null;
    const convResult = await client.getById({ conversationId });
    return convResult.conversation?.sdk_session_id || null;
  }, [conversationId]);

  /**
   * 分支切换
   * 在原始版本和编辑分支之间切换
   * sdkUuid 是分叉点 assistant 消息的 UUID（来自用户消息上的 forkPointSdkUuid）
   *
   * 设计原则：conversation.sdk_session_id 始终保持为原始值，不随分支切换而修改。
   * 分支的 session ID 存储在 conversation_branches 表中。
   * 切换分支时，关闭旧会话并创建新会话 resume 目标分支的 session。
   */
  const handleSwitchBranch = useCallback(async (sdkUuid: string, direction: 'prev' | 'next') => {
    if (!conversationId) return;

    // 找到分叉点 assistant 消息
    const forkPointIdx = messages.findIndex(
      m => m.role === 'assistant' && m.sdkUuid === sdkUuid
    );
    if (forkPointIdx < 0) return;

    // 分支信息在 forkPoint 后面的用户消息上
    const userMsgIdx = forkPointIdx + 1;
    if (userMsgIdx >= messages.length || messages[userMsgIdx].role !== 'user') return;

    const userMsg = messages[userMsgIdx];
    const currentBranch = userMsg.currentBranch ?? 0;
    const totalBranches = userMsg.branchVersions ?? 1;

    const targetBranch = direction === 'prev'
      ? Math.max(0, currentBranch - 1)
      : Math.min(totalBranches - 1, currentBranch + 1);

    if (targetBranch === currentBranch) return;

    try {
      // 保留分叉点及其之前的消息
      const baseMessages = messages.slice(0, forkPointIdx + 1);

      if (targetBranch === 0) {
        // 切换回原始版本：conversation.sdk_session_id 就是原始 session（始终不变）
        const originalSdkSessionId = await getOriginalSdkSessionId();
        if (!originalSdkSessionId) return;

        const historyResult = await client.getSdkSessionHistory({ sdkSessionId: originalSdkSessionId, projectPath: workspacePath || undefined });
        if (historyResult.error) return;

        const afterMessages = parseMessagesAfterForkPoint(historyResult.messages, sdkUuid);

        if (afterMessages.length > 0 && afterMessages[0].role === 'user') {
          afterMessages[0].branchVersions = totalBranches;
          afterMessages[0].currentBranch = 0;
          afterMessages[0].forkPointSdkUuid = sdkUuid;
        }

        setMessages([...baseMessages, ...afterMessages]);
        // 重建会话 resume 原始 session
        await recreateSession(originalSdkSessionId);
      } else {
        // 切换到某个分支版本
        const branchesResult = await client.getBranches({
          conversationId, forkPointSdkUuid: sdkUuid
        });

        if (branchesResult.error || branchesResult.branches.length === 0) {
          console.warn('未找到分支数据');
          return;
        }

        // targetBranch 是 1-based（0=原始），branch_index 从 0 开始
        const targetBranchRecord = branchesResult.branches.find(
          b => b.branch_index === targetBranch - 1
        );

        if (!targetBranchRecord) {
          console.warn('未找到目标分支:', targetBranch - 1);
          return;
        }

        const branchSdkSessionId = targetBranchRecord.sdk_session_id;
        if (branchSdkSessionId.startsWith('pending-')) {
          console.warn('分支 SDK session ID 尚未更新，无法加载');
          return;
        }

        const historyResult = await client.getSdkSessionHistory({ sdkSessionId: branchSdkSessionId, projectPath: workspacePath || undefined });
        if (historyResult.error) {
          console.warn('加载分支 SDK 历史失败:', historyResult.error);
          return;
        }

        const afterMessages = parseMessagesAfterForkPoint(historyResult.messages, sdkUuid);

        if (afterMessages.length > 0 && afterMessages[0].role === 'user') {
          afterMessages[0].branchVersions = totalBranches;
          afterMessages[0].currentBranch = targetBranch;
          afterMessages[0].forkPointSdkUuid = sdkUuid;
        }

        setMessages([...baseMessages, ...afterMessages]);
        // 重建会话 resume 选中分支的 session
        await recreateSession(branchSdkSessionId);
      }
    } catch (error) {
      console.error('切换分支失败:', error);
    }
  }, [conversationId, messages, recreateSession, getOriginalSdkSessionId]);

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
              onSwitchBranch={handleSwitchBranch}
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
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder={placeholder}
            className="flex-1 border border-gray-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            rows={2}
            disabled={isLoading || !isSessionReady}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim() || !isSessionReady}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors self-end"
          >
            发送
          </button>
        </div>
        {showStatusHint && (
          <div className="mt-2 text-xs text-gray-500 flex items-center gap-2">
            <span>会话模式: {sessionId ? `已连接 (${sessionId.substring(0, 8)}...)` : '连接中...'}</span>
            {isSessionReady && <span className="text-green-600">● 就绪</span>}
          </div>
        )}
      </div>
    </div>
  );
}