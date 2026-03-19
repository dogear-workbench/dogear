import { useState, useEffect } from 'react';
import { Bot, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { useUIStore, type SubAgentInfo } from '@/stores/ui-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

// ─── 消息提取工具函数 ───

interface SubAgentMessage {
  type: string;
  role?: string;
  content?: any;
  timestamp?: string;
  uuid?: string;
  model?: string;
}

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

/** 子代理切换列表项 */
function SubAgentListItem({ agent, isSelected, onClick }: {
  agent: SubAgentInfo;
  isSelected: boolean;
  onClick: () => void;
}) {
  const statusDot = agent.status === 'failed'
    ? 'bg-red-500'
    : agent.status === 'completed'
      ? 'bg-violet-500'
      : 'bg-violet-500 animate-pulse';

  return (
    <button
      className={cn(
        'w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors',
        isSelected
          ? 'bg-violet-100 text-violet-800'
          : 'hover:bg-muted/50 text-muted-foreground',
      )}
      onClick={onClick}
    >
      <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', statusDot)} />
      <span className="truncate flex-1">{agent.description || '子代理任务'}</span>
      <span className="text-[10px] text-gray-400 shrink-0">{agent.agentId.substring(0, 6)}</span>
    </button>
  );
}

/** 子代理会话详情内容 */
function SubAgentDetail({ agent }: { agent: SubAgentInfo }) {
  const workspacePath = useWorkspaceStore((s) => s.workspace?.path);
  const [messages, setMessages] = useState<SubAgentMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await client.getSubAgentHistory({
          sdkSessionId: agent.sdkSessionId,
          agentId: agent.agentId,
          projectPath: workspacePath || undefined,
        });
        if (result.error) {
          setError(result.error as string);
        } else {
          setMessages((result.messages || []) as SubAgentMessage[]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [agent.agentId, agent.sdkSessionId, workspacePath]);

  // 构建 tool_result 映射
  const toolResultMap = new Map<string, { content: string; isError: boolean }>();
  for (const msg of messages) {
    if (msg.type === 'user' && Array.isArray(msg.content)) {
      const results = extractToolResults(msg.content);
      results.forEach((v, k) => toolResultMap.set(k, v));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <div className="w-5 h-5 rounded-full border-2 border-violet-300 border-t-violet-600 animate-spin mr-2" />
        <span className="text-sm">加载中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mx-3">
        {error}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-8">
        {agent.status === 'running' ? '子代理正在运行中...' : '暂无会话历史'}
      </div>
    );
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

// ─── 导出组件 ───

/**
 * 子代理面板 — 嵌入右侧预览区域
 * 顶部是子代理切换列表，下方是选中子代理的会话历史
 */
export function SubAgentPanel() {
  const subAgents = useUIStore((s) => s.subAgents);
  const selectedSubAgentId = useUIStore((s) => s.selectedSubAgentId);
  const selectSubAgent = useUIStore((s) => s.selectSubAgent);
  const closeSubAgentPanel = useUIStore((s) => s.closeSubAgentPanel);

  const selectedAgent = subAgents.find(a => a.agentId === selectedSubAgentId) || null;

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0">
        <Button variant="ghost" size="icon-sm" onClick={closeSubAgentPanel} className="h-6 w-6" title="返回预览">
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <Bot className="w-4 h-4 text-violet-600" />
        <span className="text-sm font-medium">子代理</span>
        <span className="text-[10px] text-muted-foreground">({subAgents.length})</span>
      </div>

      {/* 子代理切换列表 */}
      {subAgents.length > 1 && (
        <div className="border-b shrink-0 max-h-40 overflow-y-auto">
          {subAgents.map((agent) => (
            <SubAgentListItem
              key={agent.agentId}
              agent={agent}
              isSelected={agent.agentId === selectedSubAgentId}
              onClick={() => selectSubAgent(agent.agentId)}
            />
          ))}
        </div>
      )}

      {/* 详情内容（滚动区域） */}
      <ScrollArea className="flex-1">
        {selectedAgent ? (
          <SubAgentDetail agent={selectedAgent} />
        ) : (
          <div className="text-sm text-muted-foreground text-center py-8">
            选择一个子代理查看详情
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
