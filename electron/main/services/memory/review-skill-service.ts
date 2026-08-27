/**
 * 跨会话复盘 Skill 运行时目录管理（历史遗留，已无运行时职责）
 *
 * 复盘功能由调度器内置任务 review（review-prompt.ts）承载，skill 版已删除。
 * 本模块的 ensureReviewSkillInitialized 保留为 no-op，仅为 index.ts 启动序列兼容。
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

/** 返回历史遗留目录路径（无调用方，仅向下兼容保留） */
export function getReviewSkillDir(): string {
  return path.join(getConfigDir(), 'skills', 'review');
}

/**
 * no-op：保留函数签名仅为 index.ts 启动序列兼容。
 */
export async function ensureReviewSkillInitialized(): Promise<void> {
}
