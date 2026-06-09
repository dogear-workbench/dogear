// 首页报告存储（历史代号 review）：每工作区一份自由 markdown 报告，
// 落 <configDir>/workspaces/<wsId>/dashboard.md（取代旧的结构化复盘卡 review.md）。
// 报告是记忆对人的投影：纯净语句、无链条；frontmatter 只存 updatedAt 供增量判定。
import fs from 'node:fs/promises';
import path from 'node:path';
import { getWorkspaceDataDir } from '../conversation-service.js';
import { parseFrontmatter, stringifyFrontmatter, type Frontmatter } from './memory-fs.js';

export interface ReportDoc {
  updatedAt: string; // ISO，增量判定与"上次更新"展示用
  markdown: string;  // 报告正文（不含 frontmatter）
}

// ─── 路径 ───

export function getReportPath(wsId: string): string {
  return path.join(getWorkspaceDataDir(wsId), 'dashboard.md');
}

// ─── 序列化 / 解析（纯函数，可单测）───

export function serializeReport(updatedAt: string, markdown: string): string {
  const fm: Frontmatter = { updatedAt };
  return stringifyFrontmatter(fm, markdown);
}

export function parseReport(raw: string): ReportDoc {
  const { fm, body } = parseFrontmatter(raw);
  const updatedAt = typeof fm.updatedAt === 'string' ? fm.updatedAt : '';
  return { updatedAt, markdown: body.replace(/^\r?\n/, '') };
}

// ─── 读写 ───

export async function saveReport(wsId: string, markdown: string): Promise<string> {
  const dir = getWorkspaceDataDir(wsId);
  await fs.mkdir(dir, { recursive: true });
  const updatedAt = new Date().toISOString();
  await fs.writeFile(getReportPath(wsId), serializeReport(updatedAt, markdown), 'utf-8');
  return updatedAt;
}

export async function readReport(wsId: string): Promise<ReportDoc | null> {
  try {
    const raw = await fs.readFile(getReportPath(wsId), 'utf-8');
    return parseReport(raw);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}
