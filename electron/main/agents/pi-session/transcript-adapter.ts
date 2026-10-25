/**
 * Harness 版逐字稿清洗（语义对齐旧的 SDK JSONL 文本行清洗实现，
 * 但输入源从 SDK JSONL 文本行换成 Harness SessionTreeEntry[]）。
 *
 * 只允许经 session-history-reader.ts 读 Harness session（全局决策：Harness 类型不得泄漏出本目录），
 * 因此 SessionTreeEntry/MessageEntry 相关的解析逻辑只能留在这里。
 *
 * uuid 策略：直接复用 Harness MessageEntry.id——与 history-adapter.ts 里 sdkUuid 用的是同一个概念，
 * 保证同一条消息在"历史展示"和"组摘要引用"两条链路里 id 一致。
 */
import fs from 'node:fs/promises';
import type { TextContent, UserMessage, AssistantMessage, ToolCall, ToolResultMessage } from '@earendil-works/pi-ai';
import { readSessionBranchEntries, type SessionBranchEntry } from './session-history-reader.js';
import { getPiSessionRepository } from './pi-session-repository.js';

const SYS_TAG_RE = /<(system-reminder|command-name|command-message|command-args|local-command-stdout|user-prompt-submit-hook)>[\s\S]*?<\/\1>/g;

const TOOL_KEY: Record<string, string[]> = {
  Read: ['file_path'], Edit: ['file_path'], Write: ['file_path'], NotebookEdit: ['notebook_path'],
  Bash: ['description', 'command'], Grep: ['pattern'], Glob: ['pattern'],
  Skill: ['skill'], TaskCreate: ['subject'], TaskUpdate: ['status'],
  Agent: ['description'], Task: ['description'], WebFetch: ['url'],
};

function basename(p: string): string { return p.split(/[\\/]/).pop() || p; }

function toolSkeleton(name: string, input: any): string {
  if (name?.startsWith('mcp__')) return `[${name}]`;
  const keys = TOOL_KEY[name];
  if (!keys || !input) return `[${name}]`;
  for (const k of keys) {
    let v = input[k];
    if (typeof v === 'string' && v) {
      if (k === 'file_path' || k === 'notebook_path') v = basename(v);
      if (v.length > 60) v = v.slice(0, 60) + '…';
      return `[${name} ${v}]`;
    }
  }
  return `[${name}]`;
}

export type TranscriptDetail = 'clean' | 'full';

const FULL_RESULT_CLIP = 300;
const FULL_OUTPUT_MAX = 60_000;

function collectToolResults(entries: SessionBranchEntry[]): Map<string, ToolResultMessage> {
  const map = new Map<string, ToolResultMessage>();
  for (const entry of entries) {
    if (entry.type !== 'message') continue;
    const message = entry.message as { role: string };
    if (message.role !== 'toolResult') continue;
    const tr = message as unknown as ToolResultMessage;
    map.set(tr.toolCallId, tr);
  }
  return map;
}

function fullToolCallLine(block: ToolCall, toolResults: Map<string, ToolResultMessage>): string {
  const args = JSON.stringify(block.arguments) ?? '{}';
  let line = `[${block.name} ${args}]`;
  if (block.argumentsError) line += `\n→ [arguments 无效] ${block.argumentsError}`;
  const result = toolResults.get(block.id);
  if (result) {
    const text = result.content
      .filter((b): b is TextContent => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const clipped = text.length > FULL_RESULT_CLIP ? text.slice(0, FULL_RESULT_CLIP) + '…' : text;
    line += `\n→ [result${result.isError ? ' · isError' : ''}] ${clipped}`;
  }
  return line;
}

function extractUserText(content: UserMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter((block): block is TextContent => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

export interface CleanedMessage {
  role: 'user' | 'assistant';
  timestamp: string;
  uuid: string;
  formatted: string; // "## [role · ts · uuid] text\n[Tool ...]" 完整块
}

/**
 * 纯函数：Harness branch entries → 去噪后消息数组，保留顺序。
 * 只处理 type='message' 的 user/assistant；toolResult 角色不单独成条（切片/tail 计数在两种 detail 下一致）：
 * detail='clean'（默认）时完全跳过，toolCall 用 toolSkeleton 生成骨架不含执行结果；
 * detail='full' 时 toolCall 保留完整 arguments，并把 toolCallId 关联的 toolResult 文本（截 300 字/条）附在同一条 assistant 消息里。
 * compaction/branch_summary/custom 等非消息 entry 也跳过。
 * Harness 没有 SDK CLI 的 isSidechain/isMeta 概念（子会话是独立 session 文件，不会内嵌到同一份 entries 里），
 * 因此不需要对应的过滤条件。
 */
export function cleanMessagesFromEntries(entries: SessionBranchEntry[], detail: TranscriptDetail = 'clean'): CleanedMessage[] {
  const out: CleanedMessage[] = [];
  const toolResults = detail === 'full' ? collectToolResults(entries) : null;
  for (const entry of entries) {
    if (entry.type !== 'message') continue;
    const message = entry.message as { role: string };
    if (message.role === 'toolResult') continue;
    const timestamp = new Date(entry.timestamp).toISOString();

    if (message.role === 'user') {
      const um = message as unknown as UserMessage;
      const stripped = extractUserText(um.content).replace(SYS_TAG_RE, '').trim();
      if (!stripped) continue;
      out.push({
        role: 'user',
        timestamp,
        uuid: entry.id,
        formatted: `## [user · ${timestamp} · ${entry.id}] ${stripped}`,
      });
      continue;
    }

    const am = message as unknown as AssistantMessage;
    const parts: string[] = [];
    const toolLines: string[] = [];
    for (const block of am.content) {
      if (block.type === 'text' && block.text?.trim()) parts.push(block.text.trim());
      else if (block.type === 'toolCall') {
        toolLines.push(toolResults ? fullToolCallLine(block, toolResults) : toolSkeleton(block.name, block.arguments));
      }
    }
    if (!parts.length && !toolLines.length) continue;
    const head = parts.join('\n');
    out.push({
      role: 'assistant',
      timestamp,
      uuid: entry.id,
      formatted: `## [assistant · ${timestamp} · ${entry.id}] ${head}` +
        (toolLines.length ? '\n' + toolLines.join('\n') : ''),
    });
  }
  return out;
}

// ─── 高层读+切片 API ───

export interface ReadCleanTranscriptOptions {
  /** 尾 N 条消息（去噪后计数） */
  tail?: number;
  /** 起止 index（去噪后 index，闭开区间 [start, end)） */
  range?: [number, number];
  /** 按 uuid 回溯，返回该消息 + 前后 uuidContext 条 */
  uuid?: string;
  /** uuid 模式下的前后 context 条数，默认 5 */
  uuidContext?: number;
  /** 输出保真度：clean 只含文本与工具骨架（默认）；full 保留完整工具参数与结果摘要 */
  detail?: TranscriptDetail;
}

export type ReadCleanTranscriptResult =
  | {
      ok: true;
      text: string;
      /** 切片包含的消息数 */
      count: number;
      /** 会话去噪后总消息数（切片前） */
      totalCount: number;
      lastTimestamp: string;
      originalBytes: number;
      sourceMtime: number;
      ratio: number;
    }
  | { ok: false; error: string };

/**
 * 读取 Harness session 当前 branch → 去噪 → 按 options 切片。
 * session 不存在 / 读取失败 → 返回 { ok: false }，调用方决定怎么呈现。
 */
export async function readCleanTranscript(
  workspaceId: string,
  sessionId: string,
  options?: ReadCleanTranscriptOptions,
): Promise<ReadCleanTranscriptResult> {
  let entries: SessionBranchEntry[];
  let originalBytes = 0;
  let sourceMtime = 0;
  try {
    const repository = getPiSessionRepository();
    const sessionPath = await repository.getSessionPath(workspaceId, sessionId);
    const stat = await fs.stat(sessionPath);
    originalBytes = stat.size;
    sourceMtime = stat.mtimeMs;
    entries = await readSessionBranchEntries(workspaceId, sessionId);
  } catch (err) {
    return { ok: false, error: `会话不存在或读取失败: ${sessionId}（${err instanceof Error ? err.message : String(err)}）` };
  }

  const messages = cleanMessagesFromEntries(entries, options?.detail);
  const totalCount = messages.length;

  let sliced: CleanedMessage[];
  if (options?.uuid) {
    const ctx = options.uuidContext ?? 5;
    const idx = messages.findIndex((m) => m.uuid === options.uuid);
    if (idx < 0) {
      return { ok: false, error: `uuid ${options.uuid} 未在会话 ${sessionId} 中找到` };
    }
    const start = Math.max(0, idx - ctx);
    const end = Math.min(totalCount, idx + ctx + 1);
    sliced = messages.slice(start, end);
  } else if (options?.range) {
    const [s, e] = options.range;
    sliced = messages.slice(Math.max(0, s), Math.min(totalCount, e));
  } else if (options?.tail != null) {
    sliced = messages.slice(Math.max(0, totalCount - options.tail));
  } else {
    sliced = messages;
  }

  const fullText = sliced.map((m) => m.formatted).join('\n\n');
  let text = fullText;
  if (options?.detail === 'full' && fullText.length > FULL_OUTPUT_MAX) {
    text = fullText.slice(0, FULL_OUTPUT_MAX) + '\n\n[full 输出超过 60K 字符已截断；可用 rangeStart/rangeEnd 或 tail 按消息分段读取]';
  }
  return {
    ok: true,
    text,
    count: sliced.length,
    totalCount,
    lastTimestamp: messages.length ? (messages[messages.length - 1].timestamp || '') : '',
    originalBytes,
    sourceMtime,
    ratio: fullText.length ? originalBytes / fullText.length : 0,
  };
}
