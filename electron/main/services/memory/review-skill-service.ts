/**
 * 跨会话复盘 Skill 目录管理（里程碑 2 Phase B）
 *
 * 在 <configDir>/skills/review/ 下幂等初始化 SKILL.md（SDK local plugin 入口）。
 * 由 query-based-session 作为 local plugin 加载，配合 dogear-memory-review MCP 工具使用。
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
description: 当用户要求复盘、回顾跨会话进展、串一下做过什么、看哪些思路没落实/搁置时使用。综合本工作区所有会话摘要卡，产出或更新一张「复盘卡」。
---

${DEFAULT_REVIEW_PROMPT}`;

/**
 * 确保复盘 Skill 目录与 SKILL.md 存在。
 * 幂等：文件已存在则不覆盖（用户可能已改）。启动时调用一次，错误不应阻塞启动。
 */
export async function ensureReviewSkillInitialized(): Promise<void> {
  const skillDir = getReviewSkillDir();
  await fs.mkdir(skillDir, { recursive: true });
  const skillPath = path.join(skillDir, 'SKILL.md');
  try {
    await fs.access(skillPath);
  } catch {
    await fs.writeFile(skillPath, SKILL_MD, 'utf-8');
  }
}
