/**
 * 跨会话复盘 Skill 目录管理（里程碑 2 Phase B）
 *
 * 在 <configDir>/skills/review/ 下幂等初始化 SKILL.md。
 * 模板内容从 resources/skill-templates/cross-session-review/SKILL.md 读取，
 * 该目录由 PiSession（pi-session.ts）纳入 skill 扫描路径，经 pi-agent-core 的
 * loadSkills 发现后注入 <available_skills> 索引，agent 通过 Skill 工具按需加载全文，
 * 配合 dogear-memory-review MCP 工具使用。
 */
import path from 'path';
import fs from 'fs/promises';
import electron from 'electron';
import { getTemplateContent } from '../skill-template-service.js';

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

/**
 * 确保复盘 Skill 目录与 SKILL.md 存在。
 * 内容不一致则覆盖（提示词随版本演进，避免开发机残留旧 skill）。启动时调用一次，错误不应阻塞启动。
 */
export async function ensureReviewSkillInitialized(): Promise<void> {
  const skillDir = getReviewSkillDir();
  await fs.mkdir(skillDir, { recursive: true });
  const skillPath = path.join(skillDir, 'SKILL.md');
  const templateContent = await getTemplateContent('cross-session-review');
  let existing: string | null = null;
  try {
    existing = await fs.readFile(skillPath, 'utf-8');
  } catch { /* 不存在 */ }
  if (existing !== templateContent) {
    await fs.writeFile(skillPath, templateContent, 'utf-8');
  }
}
