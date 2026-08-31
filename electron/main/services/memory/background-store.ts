// 组背景 background.md 存储
// 路径：<configDir>/workspaces/<wsId>/groups/<groupId>/background.md
// 结构化字段（YAML frontmatter），给「组内新会话」派子会话时读，用来快速获知已发生什么、什么已定、什么未决
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter, stringifyFrontmatter, type Frontmatter } from './memory-fs.js';
import { broadcastGroupDataChanged } from '../renderer-broadcast.js';
import { getGroupDir } from './group-digest-store.js';

export interface GroupBackground {
  groupId: string;
  updatedAt: string;
  topic: string;
  progress: string;
  keyDecisions: string[];
  openQuestions: string[];
}

export function getBackgroundPath(wsId: string, groupId: string): string {
  return path.join(getGroupDir(wsId, groupId), 'background.md');
}

function strOf(v: Frontmatter[string] | undefined): string {
  return typeof v === 'string' ? v : Array.isArray(v) ? v.join(', ') : '';
}

function jsonArr(v: Frontmatter[string] | undefined): string[] {
  const raw = strOf(v);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw.replace(/\\"/g, '"'));
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function serializeGroupBackground(bg: GroupBackground): string {
  const fm: Frontmatter = {
    groupId: bg.groupId,
    updatedAt: bg.updatedAt,
    topic: bg.topic,
    progress: bg.progress,
    keyDecisionsJson: JSON.stringify(bg.keyDecisions),
    openQuestionsJson: JSON.stringify(bg.openQuestions),
  };
  const decisionLines = bg.keyDecisions.length
    ? bg.keyDecisions.map((d) => `- ${d}`).join('\n')
    : '(无)';
  const questionLines = bg.openQuestions.length
    ? bg.openQuestions.map((q) => `- ${q}`).join('\n')
    : '(无)';
  const body =
    `## 主题\n${bg.topic}\n\n` +
    `## 当前进展\n${bg.progress}\n\n` +
    `## 关键决策（已拍板，不该重议）\n${decisionLines}\n\n` +
    `## 待议问题（未决 / 搁置）\n${questionLines}\n`;
  return stringifyFrontmatter(fm, body);
}

export function parseGroupBackground(raw: string): GroupBackground | null {
  const { fm } = parseFrontmatter(raw);
  const groupId = strOf(fm.groupId);
  if (!groupId) return null;
  return {
    groupId,
    updatedAt: strOf(fm.updatedAt),
    topic: strOf(fm.topic),
    progress: strOf(fm.progress),
    keyDecisions: jsonArr(fm.keyDecisionsJson),
    openQuestions: jsonArr(fm.openQuestionsJson),
  };
}

export async function readGroupBackground(wsId: string, groupId: string): Promise<GroupBackground | null> {
  try {
    const raw = await fs.readFile(getBackgroundPath(wsId, groupId), 'utf-8');
    return parseGroupBackground(raw);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

export async function saveGroupBackground(wsId: string, bg: GroupBackground): Promise<void> {
  await fs.mkdir(getGroupDir(wsId, bg.groupId), { recursive: true });
  await fs.writeFile(getBackgroundPath(wsId, bg.groupId), serializeGroupBackground(bg), 'utf-8');
  broadcastGroupDataChanged(wsId, bg.groupId);
}
