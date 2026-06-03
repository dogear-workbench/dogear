// A1 · 会话清洗：JSONL 逐字稿确定性去噪
// 纯解析层 cleanTranscriptFromLines（可单测，无 IO）+ cleanTranscript（读文件后调它）
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

export function cleanTranscriptFromLines(
  sessionId: string, lines: string[], originalBytes: number, sourceMtime: number,
): CleanedTranscript {
  const out: string[] = [];
  let turnCount = 0;
  let lastTimestamp = '';
  for (const raw of lines) {
    let o: any;
    try { o = JSON.parse(raw); } catch { continue; }
    const t = o?.type;
    if (t !== 'user' && t !== 'assistant') continue;          // envelope 行
    if (o.isSidechain === true || o.isMeta === true) continue; // 子 agent / 注入
    const m = o.message;
    if (!m) continue;
    const ts = o.timestamp || '';
    const uuid = o.uuid || '';
    if (t === 'user') {
      const c = m.content;
      if (typeof c !== 'string') continue;                    // tool_result 数组 → 丢
      const stripped = c.replace(SYS_TAG_RE, '').trim();
      if (!stripped) continue;                                 // 剥完为空 → 丢
      out.push(`## [user · ${ts} · ${uuid}] ${stripped}`);
      turnCount++; if (ts) lastTimestamp = ts;
    } else {
      const c = m.content;
      if (!Array.isArray(c)) continue;
      const parts: string[] = [];
      const skeletons: string[] = [];
      for (const b of c) {
        if (b?.type === 'text' && b.text?.trim()) parts.push(b.text.trim());
        else if (b?.type === 'tool_use') skeletons.push(toolSkeleton(b.name, b.input));
        // thinking → 丢
      }
      if (!parts.length && !skeletons.length) continue;
      const head = parts.join('\n');
      out.push(`## [assistant · ${ts} · ${uuid}] ${head}` +
        (skeletons.length ? '\n' + skeletons.join('\n') : ''));
      turnCount++; if (ts) lastTimestamp = ts;
    }
  }
  const transcript = out.join('\n\n');
  return {
    sessionId, transcript, turnCount, lastTimestamp, sourceMtime,
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
