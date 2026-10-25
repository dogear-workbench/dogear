/**
 * 工作区应用数据根解析（configDir/workspaces/{wsid}/，零 Electron 依赖）
 *
 * tasks.json、articles/ 等工作区级应用数据统一存 configDir 下（与 notes/groups/sessions 平级），
 * 物理路径只允许从这里解析，禁止各服务自行拼 configDir。
 * 注入优先于 env：主进程入口在 app ready 时注入精确值；Worker 线程与测试走 env/显式注入。
 */
import path from 'node:path';

let configDirOverride: string | null = null;

export function setWorkspaceDataConfigDir(dir: string): void {
  configDirOverride = dir;
}

/** 测试隔离用：清除注入，回落 env/cwd 解析 */
export function resetWorkspaceDataConfigDir(): void {
  configDirOverride = null;
}

export function getWorkspaceDataConfigDir(): string {
  if (configDirOverride) return configDirOverride;
  if (process.env.DOGEAR_CONFIG_DIR) return process.env.DOGEAR_CONFIG_DIR;
  return path.join(process.cwd(), '.dogear');
}

export function getWorkspaceDataDir(workspaceId: string): string {
  return path.join(getWorkspaceDataConfigDir(), 'workspaces', workspaceId);
}
