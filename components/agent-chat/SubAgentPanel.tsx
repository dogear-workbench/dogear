import { Bot, ChevronRight, ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ContentBlockItem } from './ContentBlockItem';
import { cn } from '@/lib/utils';
import { useUIStore, type SubAgentInfo } from '@/stores/ui-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSubAgentMessages, type SubAgentRawMessage } from './hooks/useSubAgentMessages';
import type { ContentBlock } from './types';

// ─── 消息转换 ───

/** 从子代理原始消息中提取 ContentBlock 和 user prompt */
interface SubAgentSection {
  type: 'prompt' | 'assistant';
  text?: string;           // prompt 文本
  contentBlocks?: ContentBlock[]; // assistant 的 contentBlocks
}

function convertToSections(rawMessages: SubAgentRawMessage[]): SubAgentSection[] {
  const sections: SubAgentSection[] = [];

  // 构建 tool_result 映射
  const toolResultMap = new Map<string, { content: string; isError: boolean }>();
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
      let text = '';
      if (typeof msg.content === 'string') {
        text = msg.content;
      } else if (Array.isArray(msg.content)) {
        text = msg.content
          .filter((b: any) => typeof b === 'string' || b?.type === 'text')
          .map((b: any) => typeof b === 'string' ? b : b.text || '')
          .join('');
      }
      if (text) {
        sections.push({ type: 'prompt', text });
      }
    } else if (msg.type === 'assistant') {
      const contentBlocks: ContentBlock[] = [];

      if (typeof msg.content === 'string' && msg.content) {
        contentBlocks.push({ type: 'text', content: msg.content, timestamp: Date.now() });
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (typeof block === 'string') {
            if (block) contentBlocks.push({ type: 'text', content: block, timestamp: Date.now() });
          } else if (block?.type === 'text' && block.text) {
            contentBlocks.push({ type: 'text', content: block.text, timestamp: Date.now() });
          } else if (block?.type === 'thinking') {
            contentBlocks.push({ type: 'thinking', content: block.thinking || '', timestamp: Date.now() });
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

      if (contentBlocks.length > 0) {
        sections.push({ type: 'assistant', contentBlocks });
      }
    }
  }

  return sections;
}

// ─── 子组件 ───

/** 子代理详情视图 — 无头像，轻量渲染 */
function SubAgentDetail({
  agent,
  onBack,
}: {
  agent: SubAgentInfo;
  onBack: () => void;
}) {
  const workspacePath = useWorkspaceStore((s) => s.workspace?.path);

  const { messages: rawMessages, loading, error } = useSubAgentMessages({
    agentId: agent.agentId,
    sdkSessionId: agent.sdkSessionId,
    status: agent.status,
    workspacePath,
  });

  const sections = convertToSections(rawMessages);

  // 优先用历史里第一条 assistant 消息的 model（最准确），否则回落到注册时的 model（toolInput.model）
  const modelFromHistory = rawMessages.find((m) => m.type === 'assistant' && m.model)?.model;
  const displayModel = modelFromHistory || agent.model;

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
        {displayModel && (
          <span className="text-[10px] text-muted-foreground shrink-0 px-1.5 py-0.5 rounded bg-muted">
            {displayModel}
          </span>
        )}
      </div>

      {/* 消息区域 */}
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
        ) : sections.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">暂无会话历史</div>
        ) : (
          <div className="px-3 py-4 space-y-5">
            {sections.map((section, i) => {
              if (section.type === 'prompt') {
                // 主会话发送的消息：灰色框
                return (
                  <div
                    key={i}
                    className="text-sm border border-border rounded-lg px-3 py-2 whitespace-pre-wrap"
                  >
                    {section.text!.length > 500 ? section.text!.substring(0, 500) + '...' : section.text}
                  </div>
                );
              }

              // 子代理回复：直接渲染 ContentBlock，无头像
              return (
                <div key={i} className="space-y-2">
                  {section.contentBlocks!.map((block, j) => (
                    <ContentBlockItem key={j} block={block} />
                  ))}
                </div>
              );
            })}
            {/* 底部间距 */}
            <div className="h-6" />
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// ─── 导出组件 ───

export function SubAgentPanel({ conversationId }: { conversationId?: string }) {
  const subAgentsMap = useUIStore((s) => s.subAgentsMap);
  const subAgents = conversationId ? (subAgentsMap[conversationId] || []) : [];
  const selectedSubAgentMap = useUIStore((s) => s.selectedSubAgentMap);
  const selectSubAgent = useUIStore((s) => s.selectSubAgent);
  const selectedSubAgentId = conversationId ? (selectedSubAgentMap[conversationId] ?? null) : null;

  const selectedAgent = selectedSubAgentId
    ? subAgents.find(a => a.agentId === selectedSubAgentId) || null
    : null;

  if (selectedAgent && conversationId) {
    return (
      <SubAgentDetail
        agent={selectedAgent}
        onBack={() => selectSubAgent(conversationId, null)}
      />
    );
  }

  const sortedAgents = [...subAgents].sort((a, b) => {
    return ((b.completedAt ?? b.startedAt ?? 0) - (a.completedAt ?? a.startedAt ?? 0));
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0">
        <Bot className="w-4 h-4 text-violet-600" />
        <span className="text-sm font-medium">子代理</span>
        <span className="text-[10px] text-muted-foreground">({subAgents.length})</span>
      </div>

      <ScrollArea className="flex-1 overflow-hidden">
        {sortedAgents.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">暂无子代理</div>
        ) : (
          <div className="divide-y">
            {sortedAgents.map((agent) => {
              const dotClass = agent.status === 'failed' ? 'bg-red-500' : 'bg-violet-500';
              const durationText = agent.durationMs ? ` · ${(agent.durationMs / 1000).toFixed(1)}s` : '';

              return (
                <button
                  key={agent.agentId}
                  onClick={() => conversationId && selectSubAgent(conversationId, agent.agentId)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
                >
                  <div className={cn('w-2 h-2 rounded-full shrink-0', dotClass)} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{agent.description || '子代理任务'}</div>
                    {(agent.subagentType || agent.model || durationText) && (
                      <div className="text-xs text-muted-foreground truncate mt-0.5">
                        {[agent.subagentType, agent.model].filter(Boolean).join(' · ')}{durationText}
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
