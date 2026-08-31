import { broadcastToWindows } from './renderer-broadcast.js';

export interface TerminalEntry {
  toolCallId: string;
  command: string;
  startedAt: number;
  exitCode?: number;
  text: string;
}

export type TerminalStreamEvent =
  | { conversationId: string; toolCallId: string; type: 'start'; command: string; startedAt: number }
  | { conversationId: string; toolCallId: string; type: 'append'; suffix: string }
  | { conversationId: string; toolCallId: string; type: 'replace'; text: string }
  | { conversationId: string; toolCallId: string; type: 'end'; exitCode?: number };

const MAX_ENTRIES_PER_CONVERSATION = 200;
// 按字符数（UTF-16 code units）封顶，ASCII 场景等价于 Plan 的 256KB，多字节字符下更保守
const MAX_TEXT_CHARS = 256 * 1024;

const buffers = new Map<string, ConversationBuffer>();

interface ConversationBuffer {
  entries: TerminalEntry[];
  // toolCallId -> entry，update/end 事件 O(1) 定位
  byToolCallId: Map<string, TerminalEntry>;
}

function getBuffer(conversationId: string): ConversationBuffer {
  let buffer = buffers.get(conversationId);
  if (!buffer) {
    buffer = { entries: [], byToolCallId: new Map() };
    buffers.set(conversationId, buffer);
  }
  return buffer;
}

function capText(text: string): string {
  return text.length > MAX_TEXT_CHARS ? text.slice(text.length - MAX_TEXT_CHARS) : text;
}

function broadcast(event: TerminalStreamEvent): void {
  broadcastToWindows((handlers) => handlers.terminalStreamAppend.send(event));
}

export function handleToolStart(conversationId: string, toolCallId: string, command: string, startedAt: number): void {
  if (!conversationId || !toolCallId) return;
  const buffer = getBuffer(conversationId);
  if (buffer.byToolCallId.has(toolCallId)) return;
  const entry: TerminalEntry = { toolCallId, command, startedAt, text: '' };
  buffer.entries.push(entry);
  buffer.byToolCallId.set(toolCallId, entry);
  if (buffer.entries.length > MAX_ENTRIES_PER_CONVERSATION) {
    const dropped = buffer.entries.splice(0, buffer.entries.length - MAX_ENTRIES_PER_CONVERSATION);
    for (const old of dropped) buffer.byToolCallId.delete(old.toolCallId);
  }
  broadcast({ conversationId, toolCallId, type: 'start', command, startedAt });
}

export function handleToolUpdate(conversationId: string, toolCallId: string, snapshotText: string): void {
  const buffer = buffers.get(conversationId);
  const entry = buffer?.byToolCallId.get(toolCallId);
  if (!entry || !snapshotText) return;
  const next = capText(snapshotText);
  if (snapshotText.startsWith(entry.text)) {
    const suffix = snapshotText.slice(entry.text.length);
    entry.text = next;
    // 截断生效（next 短于快照）时改走 replace，保证广播 payload 有界且渲染端无需自行 cap
    if (next.length === snapshotText.length && suffix) {
      broadcast({ conversationId, toolCallId, type: 'append', suffix });
    } else if (next.length !== snapshotText.length) {
      broadcast({ conversationId, toolCallId, type: 'replace', text: next });
    }
    return;
  }
  entry.text = next;
  broadcast({ conversationId, toolCallId, type: 'replace', text: next });
}

export function handleToolEnd(conversationId: string, toolCallId: string, isError: boolean, resultText: string): void {
  const buffer = buffers.get(conversationId);
  const entry = buffer?.byToolCallId.get(toolCallId);
  if (!entry) return;
  // pi-agent-core bash 工具非零退出时直接 throw（"Command exited with code N"），end 事件只有 isError；
  // exit code 只能从错误文本反解，abort/timeout 等异常终止保持 undefined
  let exitCode: number | undefined = isError ? undefined : 0;
  if (isError) {
    const match = /exited with code (\d+)/.exec(resultText);
    if (match) exitCode = Number(match[1]);
  }
  entry.exitCode = exitCode;
  broadcast({ conversationId, toolCallId, type: 'end', exitCode });
}

export function getTerminalBuffer(conversationId: string): TerminalEntry[] {
  return (buffers.get(conversationId)?.entries ?? []).map((entry) => ({ ...entry }));
}

export function clearConversation(conversationId: string): void {
  buffers.delete(conversationId);
}
