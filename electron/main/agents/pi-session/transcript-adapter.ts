/**
 * Harness 版逐字稿清洗（对齐旧 electron/main/services/memory/transcript-cleaner.ts 的语义，
 * 但输入源从 SDK JSONL 文本行换成 Harness SessionTreeEntry[]）。
 *
 * 只允许经 session-history-reader.ts 读 Harness session（全局决策：Harness 类型不得泄漏出本目录），
 * 因此 SessionTreeEntry/MessageEntry 相关的解析逻辑只能留在这里，
 * transcript-cleaner.ts 对外只做类型无关的薄转发。
 *
 * uuid 策略：直接复用 Harness MessageEntry.id——与 history-adapter.ts 里 sdkUuid 用的是同一个概念，
 * 保证同一条消息在"历史展示"和"组摘要引用"两条链路里 id 一致。
 */
import fs from 'node:fs/promises';
import type { MessageEntry, SessionTreeEntry } from '@earendil-works/pi-agent-core';
import type { TextContent, UserMessage, AssistantMessage } from '@earendil-works/pi-ai';
import { readSessionBranchEntries } from './session-history-reader.js';
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
 * 只处理 type='message' 的 user/assistant；toolResult 角色跳过（同旧行为，
 * toolSkeleton 只基于 toolCall.arguments 生成骨架，不含执行结果）；
 * compaction/model_change/label 等非消息 entry 也跳过。
 * Harness 没有 SDK CLI 的 isSidechain/isMeta 概念（子会话是独立 session 文件，不会内嵌到同一份 entries 里），
 * 因此不需要对应的过滤条件。
 */
export function cleanMessagesFromEntries(entries: SessionTreeEntry[]): CleanedMessage[] {
  const out: CleanedMessage[] = [];
  for (const entry of entries) {
    if (entry.type !== 'message') continue;
    const messageEntry = entry as MessageEntry;
    const message = messageEntry.message as { role: string };
    if (message.role === 'toolResult') continue;

    if (message.role === 'user') {
      const um = message as unknown as UserMessage;
      const stripped = extractUserText(um.content).replace(SYS_TAG_RE, '').trim();
      if (!stripped) continue;
      out.push({
        role: 'user',
        timestamp: entry.timestamp,
        uuid: messageEntry.id,
        formatted: `## [user · ${entry.timestamp} · ${messageEntry.id}] ${stripped}`,
      });
      continue;
    }

    const am = message as unknown as AssistantMessage;
    const parts: string[] = [];
    const skeletons: string[] = [];
    for (const block of am.content) {
      if (block.type === 'text' && block.text?.trim()) parts.push(block.text.trim());
      else if (block.type === 'toolCall') skeletons.push(toolSkeleton(block.name, block.arguments));
    }
    if (!parts.length && !skeletons.length) continue;
    const head = parts.join('\n');
    out.push({
      role: 'assistant',
      timestamp: entry.timestamp,
      uuid: messageEntry.id,
      formatted: `## [assistant · ${entry.timestamp} · ${messageEntry.id}] ${head}` +
        (skeletons.length ? '\n' + skeletons.join('\n') : ''),
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
  let entries: SessionTreeEntry[];
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

  const messages = cleanMessagesFromEntries(entries);
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

  const text = sliced.map((m) => m.formatted).join('\n\n');
  return {
    ok: true,
    text,
    count: sliced.length,
    totalCount,
    lastTimestamp: messages.length ? (messages[messages.length - 1].timestamp || '') : '',
    originalBytes,
    sourceMtime,
    ratio: text.length ? originalBytes / text.length : 0,
  };
}

/**
 * 批量建「sessionId → 去噪后 uuid 集合」索引，供 source-fidelity.ts 校验组卡引用保真度。
 * 打开失败（session 不存在等）一律映射为 null——PiSessionRepository 对"未找到"只抛通用 Error，
 * 没有类似 fs 的 ENOENT code 可供区分真实 IO 故障，所以此处不像旧版 fs 实现那样区分并重新抛出，
 * 统一按"缺失"处理交给 source-fidelity 的 session_missing 分支兜底。
 */
export async function buildSessionUuidIndex(
  workspaceId: string,
  sessionIds: string[],
): Promise<Map<string, Set<string> | null>> {
  const index = new Map<string, Set<string> | null>();
  await Promise.all(sessionIds.map(async (sid) => {
    try {
      const entries = await readSessionBranchEntries(workspaceId, sid);
      const messages = cleanMessagesFromEntries(entries);
      index.set(sid, new Set(messages.map((m) => m.uuid).filter(Boolean)));
    } catch {
      index.set(sid, null);
    }
  }));
  return index;
}
