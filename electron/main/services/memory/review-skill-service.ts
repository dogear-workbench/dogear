/**
 * 跨会话复盘 Skill 运行时目录管理
 *
 * SKILL.md 模板内容直接由 pi-session 从 resources/skill-templates/cross-session-review/ 读取，
 * 不再复制到 .dogear/skills/review/。本模块的 ensureReviewSkillInitialized 保留为 no-op，
 * 仅为 index.ts 启动序列兼容（不报错、不产生副作用）。
 */
import path from 'path';
import electron from 'electron';

const { app } = electron;

function getConfigDir(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), '.dogear');
  }
  return path.join(process.cwd(), '.dogear');
}

/** 返回复盘 Skill 运行时目录的绝对路径（仅用于向下兼容，pi-session 不再扫描此目录） */
export function getReviewSkillDir(): string {
  return path.join(getConfigDir(), 'skills', 'review');
}

/**
 * no-op：复盘 Skill 现由 pi-session 直接从模板源加载，不再需要复制。
 * 保留函数签名仅为 index.ts 启动序列兼容。
 */
export async function ensureReviewSkillInitialized(): Promise<void> {
}
