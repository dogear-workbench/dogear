import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { getConfigDir } from '../settings-service.js';
import { mainLogger } from '../../agents/logger.js';

const logger = mainLogger.child('tool-usage-service');

const RETENTION_DAYS = 90;
const FILE_PATTERN = /^tool-usage-(\d{4}-\d{2}-\d{2})\.jsonl$/;

export type ToolUsageSessionType = 'main' | 'sub' | 'executor' | 'scheduler';

export interface ToolUsageEntry {
  ts: string;
  tool: string;
  pack: string | null;
  conv: string;
  sessionType: ToolUsageSessionType;
  profile?: string;
  ws: string | null;
  ok: boolean;
  ms: number;
}

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toolUsageFilePath(day: string): string {
  return path.join(getConfigDir(), 'tool-usage', `tool-usage-${day}.jsonl`);
}

let trippedDay = '';

// 埋点位于工具执行热路径，失败必须静默降级：当日熔断避免逐次调用刷日志
export function recordToolUsage(entry: ToolUsageEntry): void {
  const day = dayKey(new Date());
  if (trippedDay === day) return;
  try {
    const file = toolUsageFilePath(day);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (err) {
    trippedDay = day;
    logger.warn('recordToolUsage 写入失败，当日工具调用记录熔断', err);
  }
}

export async function cleanupOldToolUsage(): Promise<void> {
  const dir = path.join(getConfigDir(), 'tool-usage');
  let names: string[];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  await Promise.all(
    names.map(async (name) => {
      const m = FILE_PATTERN.exec(name);
      if (!m) return;
      const dayMs = Date.parse(`${m[1]}T00:00:00`);
      if (Number.isNaN(dayMs) || dayMs >= cutoff) return;
      try {
        await fsp.unlink(path.join(dir, name));
      } catch (err) {
        logger.warn('cleanupOldToolUsage 删除失败', name, err);
      }
    }),
  );
}
