/**
 * Harness session entry → 前端历史消息格式的转换层（UI history adapter）。
 * 唯一数据来源是 session-history-reader.ts 的共享 reader，不直接触碰 Harness Session/Storage。
 *
 * 输出的 HistoryMessage/HistoryContentBlock 是 Dogear 自定义的中立形状，字段与
 * components/agent-chat/types.ts 的 Message/ContentBlock 对齐，供前端直接消费；
 * 主进程 rootDir 限制无法跨目录 import 前端类型，因此在此镜像必要字段（同 ContractMetadata 的做法）。
 */
import type {
  TextContent,
  ImageContent,
  ToolResultMessage,
  UserMessage,
  AssistantMessage,
} from '@earendil-works/pi-ai';
import { readSessionBranchEntries, type SessionBranchEntry } from './session-history-reader.js';

export interface HistoryContentBlock {
  type: 'text' | 'thinking' | 'tool_use' | 'compact_boundary';
  content?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  toolUseId?: string;
  isError?: boolean;
  timestamp: number;
  compactTrigger?: 'manual' | 'auto';
  compactPreTokens?: number;
}

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  contentBlocks?: HistoryContentBlock[];
  /** Harness SessionBranchEntry id（仅助手消息填充），供前端"分叉"按钮作为稳定 entry 定位信息回传 */
  sdkUuid?: string;
  /** 消息级稳定 ID = SessionBranchEntry.id；assistant 合并消息 = 最后一个 entry id（与 sdkUuid 同值） */
  id?: string;
  /** assistant 合并消息覆盖的全部 SessionBranchEntry id（按落盘顺序）；user/compaction 为单元素 */
  entryIds?: string[];
  model?: string;
  images?: Array<{ preview: string }>;
  isCompactBoundary?: boolean;
  compactMetadata?: { trigger?: 'manual' | 'auto'; preTokens?: number };
}

function extractUserContent(content: UserMessage['content']): { text: string; images: Array<{ preview: string }> } {
  if (typeof content === 'string') return { text: content, images: [] };
  let text = '';
  const images: Array<{ preview: string }> = [];
  for (const block of content) {
    if (block.type === 'text') text += block.text;
    else if (block.type === 'image') images.push({ preview: `data:${block.mimeType};base64,${block.data}` });
  }
  return { text, images };
}

function extractToolResultText(content: (TextContent | ImageContent)[]): string {
  return content
    .filter((block): block is TextContent => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

function compactionToMessage(entry: Extract<SessionBranchEntry, { type: 'compaction' }>): HistoryMessage {
  const ts = entry.timestamp;
  // trigger 不映射：历史 entry 只有 durable CompactionEntry 的 reason（自动压缩策略类别），
  // 与旧 manual/auto 语义不同轴，渲染层对 undefined 不标注避免错标
  return {
    role: 'assistant',
    content: '',
    timestamp: ts,
    id: entry.id,
    entryIds: [entry.id],
    isCompactBoundary: true,
    compactMetadata: { trigger: 'auto' },
    contentBlocks: [{ type: 'compact_boundary', compactTrigger: 'auto', timestamp: ts }],
  };
}

/**
 * 把 Harness 当前 branch 的 entry 序列转成前端消息数组。
 * 只展示 message（user/assistant，toolResult 并入对应 tool_use 块）和 compaction（映射为
 * compact boundary 元消息）；branch_summary/custom 等非展示 entry 一律跳过，不进入消息流。
 */
export async function buildSessionHistory(workspaceId: string, sessionId: string): Promise<HistoryMessage[]> {
  const entries = await readSessionBranchEntries(workspaceId, sessionId);

  const toolResults = new Map<string, { text: string; isError: boolean }>();
  for (const entry of entries) {
    if (entry.type !== 'message') continue;
    const message = entry.message as { role: string };
    if (message.role !== 'toolResult') continue;
    const tr = message as unknown as ToolResultMessage;
    toolResults.set(tr.toolCallId, { text: extractToolResultText(tr.content), isError: tr.isError });
  }

  const result: HistoryMessage[] = [];
  let current: HistoryMessage | null = null;
  const flush = () => {
    if (current) result.push(current);
    current = null;
  };

  for (const entry of entries) {
    if (entry.type === 'compaction') {
      flush();
      result.push(compactionToMessage(entry));
      continue;
    }

    if (entry.type !== 'message') continue;
    const message = entry.message as { role: string };

    if (message.role === 'toolResult') continue;

    if (message.role === 'user') {
      const um = message as unknown as UserMessage;
      const { text, images } = extractUserContent(um.content);
      if (!text.trim() && images.length === 0) continue;
      flush();
      result.push({
        role: 'user',
        content: text,
        timestamp: um.timestamp,
        id: entry.id,
        entryIds: [entry.id],
        ...(images.length > 0 ? { images } : {}),
      });
      continue;
    }

    const am = message as unknown as AssistantMessage;
    const blocks: HistoryContentBlock[] = [];
    let text = '';
    for (const block of am.content) {
      if (block.type === 'text') {
        text += block.text;
        blocks.push({ type: 'text', content: block.text, timestamp: am.timestamp });
      } else if (block.type === 'thinking') {
        blocks.push({ type: 'thinking', content: block.thinking, timestamp: am.timestamp });
      } else if (block.type === 'toolCall') {
        const toolResult = toolResults.get(block.id);
        blocks.push({
          type: 'tool_use',
          toolName: block.name,
          toolInput: block.arguments,
          toolUseId: block.id,
          toolOutput: toolResult?.text,
          isError: toolResult?.isError ?? false,
          timestamp: am.timestamp,
        });
      }
    }

    if (!text && blocks.length === 0 && !current) continue;

    if (current && current.role === 'assistant' && !current.isCompactBoundary) {
      current.contentBlocks = [...(current.contentBlocks ?? []), ...blocks];
      current.content += text;
      current.sdkUuid = entry.id;
      current.id = entry.id;
      current.entryIds = [...(current.entryIds ?? []), entry.id];
      if (am.model) current.model = am.model;
    } else {
      flush();
      current = {
        role: 'assistant',
        content: text,
        timestamp: am.timestamp,
        contentBlocks: blocks.length > 0 ? blocks : undefined,
        sdkUuid: entry.id,
        id: entry.id,
        entryIds: [entry.id],
        model: am.model,
      };
    }
  }
  flush();
  return result;
}
