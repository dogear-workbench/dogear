// 会话摘要卡 + 留底干净稿存储（里程碑 2 Phase A，决策 J）
// 挂靠软件管理的工作区数据 <configDir>/workspaces/<wsId>/digests/
import fs from 'node:fs/promises';
import path from 'node:path';
import { getWorkspaceDataDir } from '../conversation-service.js';

// ─── 路径 ───

export function getDigestsDir(wsId: string): string {
  return path.join(getWorkspaceDataDir(wsId), 'digests');
}

export function getDigestPath(wsId: string, sessionId: string): string {
  return path.join(getDigestsDir(wsId), `${sessionId}.md`);
}

function getCleanedDir(wsId: string): string {
  return path.join(getDigestsDir(wsId), '_cleaned');
}

export function getCleanedBackupPath(wsId: string, sessionId: string): string {
  return path.join(getCleanedDir(wsId), `${sessionId}.md`);
}

// ─── 留底干净稿 ───

export async function saveCleanedBackup(
  wsId: string, sessionId: string, transcript: string,
): Promise<void> {
  const dir = getCleanedDir(wsId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(getCleanedBackupPath(wsId, sessionId), transcript, 'utf-8');
}
