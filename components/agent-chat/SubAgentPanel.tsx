import { Bot, ChevronRight, ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useUIStore, type SubAgentInfo } from '@/stores/ui-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSubAgentMessages, type SubAgentRawMessage } from './hooks/useSubAgentMessages';
import { MessageItem } from './MessageItem';
import type { Message, ContentBlock } from './types';

// ─── 消息转换 ───

/** 将子代理原始消息转换为主会话 Message 类型，复用 MessageItem 渲染 */
function convertToMessages(rawMessages: SubAgentRawMessage[]): Message[] {
  const messages: Message[] = [];

  // 构建 tool_result 映射（tool_use_id → result）
  const toolResultMap = new Map<string, { content: any; isError: boolean }>();
  for (const msg of rawMessages) {
    if (msg.type === 'user' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block?.type === 'tool_result' && block.tool_use_id) {
          let resultContent = '';
          if (typeof block.content === 'string') {
            resultContent = block.content;
          } else if (Array.isArray(block.content)) {
            resultContent = block.content.map((c: any) => typeof c === 'string' ? c : c?.text || '').join('\n');
          }
          toolResultMap.set(block.tool_use_id, { content: resultContent, isError: block.is_error || false });
        }
      }
    }
  }

  for (const msg of rawMessages) {
    if (msg.type === 'user') {
      // 提取文本内容（跳过纯 tool_result 消息）
      let text = '';
      if (typeof msg.content === 'string') {
        text = msg.content;
      } else if (Array.isArray(msg.content)) {
        text = msg.content
          .filter((b: any) => typeof b === 'string' || b?.type === 'text')
          .map((b: any) => typeof b === 'string' ? b : b.text || '')
          .join('');
      }
      if (!text) continue; // 跳过纯 tool_result 的 user 消息
      messages.push({
        role: 'user',
        content: text,
        timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : undefined,
        isMeta: true, // 标记为系统消息样式（子代理的 prompt 不是用户输入）
      });
    } else if (msg.type === 'assistant') {
      // 提取文本和工具调用，构建 contentBlocks
      const contentBlocks: ContentBlock[] = [];
      let text = '';

      if (typeof msg.content === 'string') {
        text = msg.content;
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (typeof block === 'string') {
            text += block;
          } else if (block?.type === 'text') {
            text += block.text || '';
            if (block.text) {
              contentBlocks.push({ type: 'text', content: block.text, timestamp: Date.now() });
            }
          } else if (block?.type === 'thinking') {
            contentBlocks.push({
              type: 'thinking',
              content: block.thinking || '',
              timestamp: Date.now(),
            });
          } else if (block?.type === 'tool_use') {
            const result = toolResultMap.get(block.id);
            contentBlocks.push({
              type: 'tool_use',
              toolName: block.name,
              toolUseId: block.id,
              toolInput: block.input,
              toolOutput: result?.content,
              isError: result?.isError,
              timestamp: Date.now(),
            });
          }
        }
      }

      // 如果没有 contentBlocks 但有文本，添加一个 text block
      if (contentBlocks.length === 0 && text) {
        contentBlocks.push({ type: 'text', content: text, timestamp: Date.now() });
      }

      messages.push({
        role: 'assistant',
        content: text,
        contentBlocks,
        model: msg.model,
        timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : undefined,
      });
    }
  }

  return messages;
}

// ─── 子组件 ───

/** 子代理详情视图 */
function SubAgentDetail({
  agent,
  onBack,
}: {
  agent: SubAgentInfo;
  onBack: () => void;
}) {
  const workspacePath = useWorkspaceStore((s) => s.workspace?.path);

  const { messages: rawMessages, loading, error } = useSubAgentMessages({
    parentSessionId: null,
    agentId: agent.agentId,
    sdkSessionId: agent.sdkSessionId,
    status: agent.status,
    workspacePath,
  });

  const messages = convertToMessages(rawMessages);

  const statusDot = agent.status === 'failed'
    ? 'bg-red-500'
    : agent.status === 'running'
      ? 'bg-blue-500 animate-pulse'
      : 'bg-violet-500';

  return (
    <div className="flex flex-col h-full">
      {/* 头部导航 */}
      <div className="flex items-center gap-1.5 px-2 py-2 border-b shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onBack}
          title="返回子代理列表"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className={cn('w-2 h-2 rounded-full shrink-0', statusDot)} />
        <span className="text-sm font-medium truncate flex-1">{agent.description || '子代理任务'}</span>
      </div>

      {/* 消息区域 - 复用 MessageItem */}
      <ScrollArea className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm">加载中...</span>
          </div>
        ) : error ? (
          <div className="text-sm text-muted-foreground bg-muted/50 border border-border rounded-md p-3 mx-3 mt-3">
            <p>文件丢失或该对话为分叉对话，请在原对话查看</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            {agent.status === 'running' ? '等待消息...' : '暂无会话历史'}
          </div>
        ) : (
          <div className="py-4 space-y-4 px-2">
            {messages.map((msg, i) => (
              <MessageItem key={i} message={msg} />
            ))}
            {/* 底部间距，防止内容被遮盖 */}
            <div className="h-4" />
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// ─── 导出组件 ───

/**
 * 子代理面板 — 嵌入右侧预览区域的子代理 tab 内容
 *
 * 两级结构：
 * - 第一级：当前对话的子代理列表
 * - 第二级：点击某个子代理，展示其完整会话流（复用 MessageItem 渲染）
 */
export function SubAgentPanel({ conversationId }: { conversationId?: string }) {
  const subAgentsMap = useUIStore((s) => s.subAgentsMap);
  const subAgents = conversationId ? (subAgentsMap[conversationId] || []) : [];
  const selectedSubAgentId = useUIStore((s) => s.selectedSubAgentId);
  const selectSubAgent = useUIStore((s) => s.selectSubAgent);

  const selectedAgent = selectedSubAgentId
    ? subAgents.find(a => a.agentId === selectedSubAgentId) || null
    : null;

  if (selectedAgent) {
    return (
      <SubAgentDetail
        agent={selectedAgent}
        onBack={() => selectSubAgent(null)}
      />
    );
  }

  // 排序：已完成按时间倒序
  const sortedAgents = [...subAgents].sort((a, b) => {
    return ((b.completedAt ?? b.startedAt ?? 0) - (a.completedAt ?? a.startedAt ?? 0));
  });

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0">
        <Bot className="w-4 h-4 text-violet-600" />
        <span className="text-sm font-medium">子代理</span>
        <span className="text-[10px] text-muted-foreground">({subAgents.length})</span>
      </div>

      {/* 列表 */}
      <ScrollArea className="flex-1 overflow-hidden">
        {sortedAgents.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">暂无子代理</div>
        ) : (
          <div className="divide-y">
            {sortedAgents.map((agent) => {
              const dotClass = agent.status === 'failed'
                ? 'bg-red-500'
                : 'bg-violet-500';

              const durationText = agent.durationMs
                ? ` · ${(agent.durationMs / 1000).toFixed(1)}s`
                : '';

              return (
                <button
                  key={agent.agentId}
                  onClick={() => selectSubAgent(agent.agentId)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
                >
                  <div className={cn('w-2 h-2 rounded-full shrink-0', dotClass)} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{agent.description || '子代理任务'}</div>
                    {(agent.subagentType || durationText) && (
                      <div className="text-xs text-muted-foreground truncate mt-0.5">
                        {agent.subagentType || ''}{durationText}
                      </div>
                    )}
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
