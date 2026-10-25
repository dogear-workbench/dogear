/**
 * 用户偏好层：config/preferences.md 的存取与写入治理
 *
 * - 文件形态：'# 用户偏好' 标题 + `- ` 单行条目；用户手动编辑读取即生效（无缓存）
 * - 准入：一条一事、单行 ≤200 字符；bigram 相似 ≥0.6 视为同主题，阻断并提示走 replace 覆盖
 * - 上限 = 熔断报警：总行数 ≤100 主闸 + 条数 ≤60 双保险，满了拒绝写入（不静默置换）
 * - 写入走 safeFileWrite 原子写；与 agent.md 同级常驻注入会话开局
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { safeFileWrite } from '../safe-json.js';
import { getConfigDir } from '../settings-service.js';
import { bigramDice } from './memory-similarity.js';

export const PREFERENCES_HEADER = '# 用户偏好';
export const PREF_MAX_TOTAL_LINES = 100;
export const PREF_MAX_ITEMS = 60;
export const PREF_MAX_ITEM_CHARS = 200;

const SIMILARITY_THRESHOLD = 0.6;

export function getPreferencesPath(): string {
  return path.join(getConfigDir(), 'preferences.md');
}

export async function readPreferencesText(): Promise<string | null> {
  try {
    return await fs.readFile(getPreferencesPath(), 'utf-8');
  } catch {
    return null;
  }
}

function isItemLine(line: string): boolean {
  return line.trim().startsWith('- ');
}

function itemOfLine(line: string): string {
  return line.trim().slice(2).trim();
}

export function parsePreferenceItems(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .filter(isItemLine)
    .map(itemOfLine)
    .filter((s) => s.length > 0);
}

export async function listPreferences(): Promise<string[]> {
  const raw = await readPreferencesText();
  return raw ? parsePreferenceItems(raw) : [];
}

export type SavePreferenceResult =
  | { status: 'added' | 'replaced' | 'duplicate'; items: string[] }
  | { status: 'blocked'; similarTo: string[] };

/** 以「保留所有非条目行（用户手写说明）+ 就地替换/追加条目行」的方式重建文件内容 */
function rebuildRaw(lines: string[], mode: 'append' | 'replace', newItem: string, oldItem?: string): string {
  const out: string[] = [];
  let replaced = false;
  for (const line of lines) {
    if (isItemLine(line) && oldItem !== undefined && itemOfLine(line) === oldItem && !replaced) {
      out.push(`- ${newItem}`);
      replaced = true;
    } else {
      out.push(line);
    }
  }
  if (mode === 'append') out.push(`- ${newItem}`);
  return out.join('\n');
}

async function writePreferenceLines(
  lines: string[],
  mode: 'append' | 'replace',
  newItem: string,
  oldItem?: string,
): Promise<string[]> {
  const nextRaw = rebuildRaw(lines, mode, newItem, oldItem);
  const totalLines = nextRaw.split('\n').length;
  if (totalLines > PREF_MAX_TOTAL_LINES) {
    throw new Error(`偏好文件将达 ${totalLines} 行，超过 ${PREF_MAX_TOTAL_LINES} 行熔断上限：请先用 dogear__ForgetPreference 清理过时条目`);
  }
  await safeFileWrite(getPreferencesPath(), nextRaw.endsWith('\n') ? nextRaw : `${nextRaw}\n`);
  return parsePreferenceItems(nextRaw);
}

function emptyFileLines(): string[] {
  return [PREFERENCES_HEADER, ''];
}

export async function savePreference(content: string, replace?: string): Promise<SavePreferenceResult> {
  const item = content.trim().replace(/^-\s+/, '').trim();
  if (!item) throw new Error('偏好内容不能为空');
  if (item.includes('\n')) throw new Error('偏好必须一条一行（一条一事，不写多行解释）');
  if (item.length > PREF_MAX_ITEM_CHARS) {
    throw new Error(`单条偏好 ${item.length} 字超过 ${PREF_MAX_ITEM_CHARS} 字上限，请精简为指令式一句话`);
  }

  const raw = await readPreferencesText();
  const lines = raw === null ? emptyFileLines() : raw.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (raw !== null && !lines.some((l) => l.trim() === PREFERENCES_HEADER)) lines.unshift(PREFERENCES_HEADER, '');
  const items = parsePreferenceItems(lines.join('\n'));

  if (replace !== undefined) {
    const target = replace.trim();
    if (!items.includes(target)) throw new Error(`replace 未命中已有偏好：「${target}」，先用 dogear__ListPreferences 核对原文`);
    const nextItems = await writePreferenceLines(lines, 'replace', item, target);
    return { status: 'replaced', items: nextItems };
  }

  if (items.includes(item)) return { status: 'duplicate', items };

  const similar = items.filter((it) => bigramDice(it, item) >= SIMILARITY_THRESHOLD);
  if (similar.length > 0) return { status: 'blocked', similarTo: similar };

  if (items.length + 1 > PREF_MAX_ITEMS) {
    throw new Error(`偏好条数已达 ${PREF_MAX_ITEMS} 条熔断上限：请先用 dogear__ForgetPreference 清理过时条目`);
  }
  const nextItems = await writePreferenceLines(lines, 'append', item);
  return { status: 'added', items: nextItems };
}

export async function forgetPreference(content: string): Promise<string[]> {
  const target = content.trim().replace(/^-\s+/, '').trim();
  const raw = await readPreferencesText();
  if (raw === null) throw new Error('偏好文件不存在');
  const items = parsePreferenceItems(raw);
  if (!items.includes(target)) throw new Error(`未命中偏好条目：「${target}」，先用 dogear__ListPreferences 核对原文`);
  const lines = raw.split(/\r?\n/).filter((line) => !(isItemLine(line) && itemOfLine(line) === target));
  await safeFileWrite(getPreferencesPath(), `${lines.join('\n').replace(/\n+$/, '')}\n`);
  return parsePreferenceItems(lines.join('\n'));
}
