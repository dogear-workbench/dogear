// 会话路径解析共享 util（cleaner / agent.ts / digest 等共用）
import path from 'node:path';
import electron from 'electron';
const { app } = electron;

/**
 * 获取 CLAUDE_CONFIG_DIR 路径
 * 与 agent-query-config.ts 中设置的 env.CLAUDE_CONFIG_DIR 保持一致
 */
export function getClaudeConfigDir(): string {
  // Worker 线程无 electron app，优先读注入的 DOGEAR_CONFIG_DIR（已是 .dogear 目录）
  if (process.env.DOGEAR_CONFIG_DIR) {
    return path.join(process.env.DOGEAR_CONFIG_DIR, 'conversations');
  }
  const appDir = app?.isPackaged ? app.getPath('userData') : process.cwd();
  return path.join(appDir, '.dogear', 'conversations');
}

/**
 * 获取 SDK 会话的存储目录
 * 路径规则与 CLI 内部一致：{CLAUDE_CONFIG_DIR}/projects/{normalized_path}
 */
export function getSdkSessionsDir(projectPath: string): string {
  const normalized = process.platform === 'win32'
    ? projectPath.replace(/\\/g, '-').replace(/:/g, '-')
    : projectPath.replace(/\//g, '-');
  return path.join(getClaudeConfigDir(), 'projects', normalized);
}

/** 单会话 JSONL 文件路径 */
export function getSessionJsonlPath(workspacePath: string, sdkSessionId: string): string {
  return path.join(getSdkSessionsDir(workspacePath), `${sdkSessionId}.jsonl`);
}
