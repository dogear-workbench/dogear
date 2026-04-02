import { useState } from 'react';
import { Bot, ChevronRight, ArrowLeft, Loader2, Wrench } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { cn } from '@/lib/utils';
import { useUIStore, type SubAgentInfo } from '@/stores/ui-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSubAgentMessages, type SubAgentRawMessage } from './hooks/useSubAgentMessages';

// ─── 消息提取工具函数 ───

function extractText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => typeof b === 'string' || b?.type === 'text')
      .map((b: any) => typeof b === 'string' ? b : b.text || '')
      .join('');
  }
  return '';
}

function extractToolUses(content: any): Array<{ id: string; name: string; input: any }> {
  if (!Array.isArray(content)) return [];
  return content
    .filter((b: any) => b?.type === 'tool_use')
    .map((b: any) => ({ id: b.id, name: b.name, input: b.input }));
}

function extractToolResults(content: any): Map<string, { content: string; isError: boolean }> {
  const map = new Map<string, { content: string; isError: boolean }>();
  if (!Array.isArray(content)) return map;
  for (const b of content) {
    if (b?.type === 'tool_result' && b.tool_use_id) {
      let resultContent = '';
      if (typeof b.content === 'string') {
        resultContent = b.content;
      } else if (Array.isArray(b.content)) {
        resultContent = b.content
          .map((c: any) => typeof c === 'string' ? c : c?.text || '')
          .join('\n');
      }
      map.set(b.tool_use_id, { content: resultContent, isError: b.is_error || false });
    }
  }
  return map;
}

function getToolSummary(name: string, input: any): string {
  if (!input) return '';
  switch (name) {
    case 'Read': return (input.file_path || '').split('/').pop() || '';
    case 'Glob': return input.pattern || '';
    case 'Grep': return `"${input.pattern || ''}"`;
    case 'Bash': return (input.command || '').substring(0, 40);
    default: return '';
  }
}

// ─── 子组件 ───

/** 工具调用小卡片 */
function MiniToolBlock({ name, input, result }: {
  name: string;
  input: any;
  result?: { content: string; isError: boolean };
}) {
  const [open, setOpen] = useState(false);
  const isError = result?.isError;
  const summary = getToolSummary(name, input);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className={cn(
        'rounded border text-xs',
        isError ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200',
      )}>
        <CollapsibleTrigger className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left cursor-pointer hover:bg-black/5">
          {(input || result) && (
            <ChevronRight className={cn('w-3 h-3 text-gray-400 transition-transform', open && 'rotate-90')} />
          )}
          <Wrench className="w-3 h-3 text-gray-400 shrink-0" />
          <span className="font-medium text-gray-700">{name}</span>
          {summary && <span className="text-gray-400 truncate flex-1 ml-1">{summary}</span>}
          {result && (
            <span className={cn('shrink-0', isError ? 'text-red-500' : 'text-green-500')}>
              {isError ? '✗' : '✓'}
            </span>
          )}
          {!result && (
            <div className="w-3 h-3 rounded-full border border-gray-300 border-t-gray-500 animate-spin shrink-0" />
          )}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-2 pb-2 space-y-1">
            <div className="border-t border-gray-200" />
            {input && (
              <pre className="text-[10px] bg-white/50 rounded p-1 max-h-24 overflow-auto whitespace-pre-wrap">
                {JSON.stringify(input, null, 2)}
              </pre>
            )}
            {result?.content && (
              <pre className={cn(
                'text-[10px] rounded p-1 max-h-32 overflow-auto whitespace-pre-wrap',
                isError ? 'bg-red-100/50' : 'bg-white/50',
              )}>
                {result.content.length > 2000 ? result.content.substring(0, 2000) + '...' : result.content}
              </pre>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

/** 子代理会话详情内容（消息列表渲染） */
function SubAgentMessageList({ messages, status }: {
  messages: SubAgentRawMessage[];
  status?: 'running' | 'completed' | 'failed';
}) {
  if (messages.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-8">
        {status === 'running' ? '等待消息...' : '暂无会话历史'}
      </div>
    );
  }

  // 构建 tool_result 映射
  const toolResultMap = new Map<string, { content: string; isError: boolean }>();
  for (const msg of messages) {
    if (msg.type === 'user' && Array.isArray(msg.content)) {
      const results = extractToolResults(msg.content);
      results.forEach((v, k) => toolResultMap.set(k, v));
    }
  }

  return (
    <div className="p-3 space-y-3">
      {messages.map((msg, idx) => {
        if (msg.type === 'user') {
          const text = extractText(msg.content);
          const hasToolResults = Array.isArray(msg.content) && msg.content.some((b: any) => b?.type === 'tool_result');
          if (!text && hasToolResults) return null;
          if (!text) return null;

          return (
            <div key={idx} className="flex gap-2">
              <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-white text-[9px]">主</span>
              </div>
              <div className="flex-1 text-xs text-gray-800 whitespace-pre-wrap bg-blue-50 rounded-lg px-2.5 py-1.5">
                {text.length > 300 ? text.substring(0, 300) + '...' : text}
              </div>
            </div>
          );
        }

        if (msg.type === 'assistant') {
          const text = extractText(msg.content);
          const toolUses = extractToolUses(msg.content);

          return (
            <div key={idx} className="flex gap-2">
              <div className="w-5 h-5 rounded-full bg-violet-600 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="w-3 h-3 text-white" />
              </div>
              <div className="flex-1 min-w-0 space-y-1.5">
                {msg.model && (
                  <span className="text-[10px] text-gray-400">{msg.model}</span>
                )}
                {text && (
                  <div className="text-xs">
                    <MarkdownRenderer content={text} className="text-xs" />
                  </div>
                )}
                {toolUses.map((tool) => (
                  <MiniToolBlock
                    key={tool.id}
                    name={tool.name}
                    input={tool.input}
                    result={toolResultMap.get(tool.id)}
                  />
                ))}
              </div>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

/** 子代理详情视图（头部 + 消息列表） */
function SubAgentDetail({
  agent,
  onBack,
}: {
  agent: SubAgentInfo;
  onBack: () => void;
}) {
  const workspacePath = useWorkspaceStore((s) => s.workspace?.path);

  // parentSessionId 不在 SubAgentInfo 中，这里仅用于实时监听
  // 实际上 agentId 对应的父 sessionId 需要从外部传入
  // 对于已完成的子代理，只需要 sdkSessionId + agentId 加载历史
  const { messages, loading, error } = useSubAgentMessages({
    parentSessionId: null, // 已完成子代理不需要实时监听
    agentId: agent.agentId,
    sdkSessionId: agent.sdkSessionId,
    status: agent.status,
    workspacePath,
  });

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

      {/* 消息区域 */}
      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm">加载中...</span>
          </div>
        ) : error ? (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mx-3 mt-3">
            {error}
          </div>
        ) : (
          <SubAgentMessageList messages={messages} status={agent.status} />
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
 * - 第一级：所有子代理列表（运行中蓝色脉冲在前，已完成按时间倒序）
 * - 第二级：点击某个子代理，展示其完整会话流
 */
export function SubAgentPanel() {
  const subAgents = useUIStore((s) => s.subAgents);
  const selectedSubAgentId = useUIStore((s) => s.selectedSubAgentId);
  const selectSubAgent = useUIStore((s) => s.selectSubAgent);

  const selectedAgent = selectedSubAgentId
    ? subAgents.find(a => a.agentId === selectedSubAgentId) || null
    : null;

  // 已选中子代理 → 显示详情
  if (selectedAgent) {
    return (
      <SubAgentDetail
        agent={selectedAgent}
        onBack={() => selectSubAgent(null)}
      />
    );
  }

  // 排序：运行中在前，已完成按 completedAt 倒序
  const sortedAgents = [...subAgents].sort((a, b) => {
    const aRunning = a.status === 'running';
    const bRunning = b.status === 'running';
    if (aRunning && !bRunning) return -1;
    if (!aRunning && bRunning) return 1;
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
      <ScrollArea className="flex-1">
        {sortedAgents.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">暂无子代理</div>
        ) : (
          <div className="divide-y">
            {sortedAgents.map((agent) => {
              const dotClass = agent.status === 'failed'
                ? 'bg-red-500'
                : agent.status === 'running'
                  ? 'bg-blue-500 animate-pulse'
                  : 'bg-violet-500';

              const durationText = agent.status !== 'running' && agent.durationMs
                ? ` · ${(agent.durationMs / 1000).toFixed(1)}s`
                : agent.status === 'running'
                  ? ' · 运行中...'
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
