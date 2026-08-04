/**
 * 跨会话复盘 Skill 目录管理（里程碑 2 Phase B）
 *
 * 在 <configDir>/skills/review/ 下幂等初始化 SKILL.md。
 * 该目录由 PiSession（pi-session.ts）纳入 skill 扫描路径，经 pi-agent-core 的
 * loadSkills 发现后注入 <available_skills> 索引，agent 通过 Skill 工具按需加载全文，
 * 配合 dogear-memory-review MCP 工具使用。
 */
import path from 'path';
import fs from 'fs/promises';
import electron from 'electron';
import { DEFAULT_REVIEW_PROMPT } from './review-prompt.js';

const { app } = electron;

function getConfigDir(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), '.dogear');
  }
  return path.join(process.cwd(), '.dogear');
}

/** 返回复盘 Skill 目录的绝对路径 */
export function getReviewSkillDir(): string {
  return path.join(getConfigDir(), 'skills', 'review');
}

const SKILL_MD = `---
name: cross-session-review
description: 当用户要求复盘、回顾进展、聊聊首页/报告、串一下做过什么、看哪些待办没落实/搁置、或要更新首页报告与记忆时使用。读会话摘要卡 + 现有报告，增量更新记忆与首页报告。
---

${DEFAULT_REVIEW_PROMPT}`;

/**
 * 确保复盘 Skill 目录与 SKILL.md 存在。
 * 内容不一致则覆盖（提示词随版本演进，避免开发机残留旧 skill）。启动时调用一次，错误不应阻塞启动。
 */
export async function ensureReviewSkillInitialized(): Promise<void> {
  const skillDir = getReviewSkillDir();
  await fs.mkdir(skillDir, { recursive: true });
  const skillPath = path.join(skillDir, 'SKILL.md');
  // 生成内容，与磁盘不一致则覆盖（提示词随版本演进，避免开发机残留旧 skill）。
  let existing: string | null = null;
  try {
    existing = await fs.readFile(skillPath, 'utf-8');
  } catch { /* 不存在 */ }
  if (existing !== SKILL_MD) {
    await fs.writeFile(skillPath, SKILL_MD, 'utf-8');
  }
}
