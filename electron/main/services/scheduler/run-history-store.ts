import path from 'node:path';
import fs from 'node:fs/promises';
import { getConfigDir } from '../settings-service.js';
import type { RunHistoryEntry, RunHistorySource } from './types.js';

const RETAIN_MONTHS = 3;
const MONTH_FILE_RE = /^(\d{4})-(\d{2})\.jsonl$/;

function getHistoryDir(): string {
  return path.join(getConfigDir(), 'run-history');
}

function monthKeyOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthIndexOf(fileName: string): number | null {
  const m = MONTH_FILE_RE.exec(fileName);
  if (!m) return null;
  return Number(m[1]) * 12 + (Number(m[2]) - 1);
}

let appendQueue: Promise<unknown> = Promise.resolve();

export async function appendHistoryEntry(entry: RunHistoryEntry): Promise<void> {
  const run = appendQueue.then(async () => {
    await fs.mkdir(getHistoryDir(), { recursive: true });
    const file = path.join(getHistoryDir(), `${monthKeyOf(entry.ts)}.jsonl`);
    await fs.appendFile(file, `${JSON.stringify(entry)}\n`, 'utf-8');
  });
  appendQueue = run.then(
    () => undefined,
    () => undefined,
  );
  await run;
}

export interface HistoryQuery {
  planId?: string;
  before?: number;
  limit?: number;
  source?: RunHistorySource;
}

export interface HistoryQueryResult {
  entries: RunHistoryEntry[];
  nextCursor?: number;
}

async function listMonthFiles(): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(getHistoryDir());
  } catch {
    return [];
  }
  return names.filter((n) => MONTH_FILE_RE.test(n)).sort().reverse();
}

async function readMonthEntries(fileName: string): Promise<RunHistoryEntry[]> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(getHistoryDir(), fileName), 'utf-8');
  } catch {
    return [];
  }
  const out: RunHistoryEntry[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as RunHistoryEntry);
    } catch {
      continue;
    }
  }
  return out;
}

export async function queryHistory(query: HistoryQuery = {}): Promise<HistoryQueryResult> {
  const limit = Math.max(1, query.limit ?? 50);
  const matched: RunHistoryEntry[] = [];
  for (const fileName of await listMonthFiles()) {
    for (const entry of await readMonthEntries(fileName)) {
      if (query.planId !== undefined && entry.planId !== query.planId) continue;
      if (query.before !== undefined && entry.ts >= query.before) continue;
      if (query.source !== undefined && (entry.source ?? 'scheduler') !== query.source) continue;
      matched.push(entry);
    }
  }
  matched.sort((a, b) => b.ts - a.ts);
  const entries = matched.slice(0, limit);
  if (entries.length === 0) return { entries };
  if (matched.length > entries.length) {
    return { entries, nextCursor: entries[entries.length - 1].ts };
  }
  return { entries };
}

export async function cleanupHistory(): Promise<void> {
  const nowIndex = monthIndexOf(`${monthKeyOf(Date.now())}.jsonl`);
  if (nowIndex === null) return;
  for (const fileName of await listMonthFiles()) {
    const idx = monthIndexOf(fileName);
    if (idx === null) continue;
    if (nowIndex - idx >= RETAIN_MONTHS) {
      await fs.rm(path.join(getHistoryDir(), fileName), { force: true });
    }
  }
}
