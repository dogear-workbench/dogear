// A1 · 会话清洗：JSONL 逐字稿确定性去噪
// 纯解析层 cleanMessagesFromLines / cleanTranscriptFromLines（无 IO，可单测）
// + readCleanTranscript（读文件后调纯函数并按 options 切片）
import fs from 'node:fs/promises';
import { getSessionJsonlPath } from './session-paths.js';
import type { CleanedTranscript } from '../../types.js';

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

export interface CleanedMessage {
  role: 'user' | 'assistant';
  timestamp: string;
  uuid: string;
  formatted: string; // "## [role · ts · uuid] text\n[Tool ...]" 完整块
}

/** 纯函数：JSONL 行 → 去噪后消息数组，保留顺序 */
export function cleanMessagesFromLines(lines: string[]): CleanedMessage[] {
  const out: CleanedMessage[] = [];
  for (const raw of lines) {
    let o: any;
    try { o = JSON.parse(raw); } catch { continue; }
    const t = o?.type;
    if (t !== 'user' && t !== 'assistant') continue;
    if (o.isSidechain === true || o.isMeta === true) continue;
    const m = o.message;
    if (!m) continue;
    const ts = o.timestamp || '';
    const uuid = o.uuid || '';
    if (t === 'user') {
      const c = m.content;
      if (typeof c !== 'string') continue;
      const stripped = c.replace(SYS_TAG_RE, '').trim();
      if (!stripped) continue;
      out.push({
        role: 'user', timestamp: ts, uuid,
        formatted: `## [user · ${ts} · ${uuid}] ${stripped}`,
      });
    } else {
      const c = m.content;
      if (!Array.isArray(c)) continue;
      const parts: string[] = [];
      const skeletons: string[] = [];
      for (const b of c) {
        if (b?.type === 'text' && b.text?.trim()) parts.push(b.text.trim());
        else if (b?.type === 'tool_use') skeletons.push(toolSkeleton(b.name, b.input));
      }
      if (!parts.length && !skeletons.length) continue;
      const head = parts.join('\n');
      out.push({
        role: 'assistant', timestamp: ts, uuid,
        formatted: `## [assistant · ${ts} · ${uuid}] ${head}` +
          (skeletons.length ? '\n' + skeletons.join('\n') : ''),
      });
    }
  }
  return out;
}

export function cleanTranscriptFromLines(
  sessionId: string, lines: string[], originalBytes: number, sourceMtime: number,
): CleanedTranscript {
  const messages = cleanMessagesFromLines(lines);
  const transcript = messages.map((m) => m.formatted).join('\n\n');
  const lastTimestamp = messages.length ? (messages[messages.length - 1].timestamp || '') : '';
  return {
    sessionId, transcript, turnCount: messages.length, lastTimestamp, sourceMtime,
    stats: {
      originalBytes, cleanedChars: transcript.length,
      ratio: transcript.length ? originalBytes / transcript.length : 0,
    },
  };
}

export async function cleanTranscript(
  workspacePath: string, sdkSessionId: string,
): Promise<CleanedTranscript> {
  const file = getSessionJsonlPath(workspacePath, sdkSessionId);
  const stat = await fs.stat(file);
  const text = await fs.readFile(file, 'utf-8');
  const lines = text.split('\n').filter(Boolean);
  return cleanTranscriptFromLines(sdkSessionId, lines, stat.size, stat.mtimeMs);
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
 * 读取会话 JSONL → 去噪 → 按 options 切片。
 * 文件不存在 / 解析失败 → 返回 { ok: false }，调用方决定怎么呈现。
 */
export async function readCleanTranscript(
  workspacePath: string,
  sessionId: string,
  options?: ReadCleanTranscriptOptions,
): Promise<ReadCleanTranscriptResult> {
  let stat: import('node:fs').Stats;
  let raw: string;
  try {
    const file = getSessionJsonlPath(workspacePath, sessionId);
    stat = await fs.stat(file);
    raw = await fs.readFile(file, 'utf-8');
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return { ok: false, error: `会话 JSONL 不存在: ${sessionId}` };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  let messages: CleanedMessage[];
  try {
    const lines = raw.split('\n').filter(Boolean);
    messages = cleanMessagesFromLines(lines);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

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
    originalBytes: stat.size,
    sourceMtime: stat.mtimeMs,
    ratio: text.length ? stat.size / text.length : 0,
  };
}
