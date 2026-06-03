// 会话脏检查：用 JSONL mtime 比对摘要卡 sourceMtime（决策 I）
import fs from 'node:fs/promises';
import * as conversationService from '../conversation-service.js';
import * as workspaceService from '../workspace-json-service.js';
import { getSessionJsonlPath } from './session-paths.js';
import { readDigest, type DigestCard } from './digest-store.js';

export interface DirtySession {
  workspaceId: string;
  workspacePath: string;
  sdkSessionId: string;
}

/** 脏条件：无卡 || 卡的 sourceMtime 与 JSONL mtime 不一致（纯函数，可单测） */
export function isDirty(card: DigestCard | null, jsonlMtimeMs: number): boolean {
  return !card || card.sourceMtime !== jsonlMtimeMs;
}

/** 扫描单个工作区，返回需要（重新）提炼的会话 */
export async function findDirtySessions(
  wsId: string, wsPath: string,
): Promise<DirtySession[]> {
  const convs = await conversationService.getByWorkspaceId(wsId); // 默认排除已归档
  const result: DirtySession[] = [];
  for (const c of convs) {
    if (!c.sdkSessionId) continue;
    const jsonl = getSessionJsonlPath(wsPath, c.sdkSessionId);
    let mtimeMs: number;
    try {
      mtimeMs = (await fs.stat(jsonl)).mtimeMs;
    } catch {
      continue; // JSONL 不存在 → 跳过
    }
    const card = await readDigest(wsId, c.sdkSessionId);
    if (isDirty(card, mtimeMs)) {
      result.push({ workspaceId: wsId, workspacePath: wsPath, sdkSessionId: c.sdkSessionId });
    }
  }
  return result;
}

/** 遍历所有工作区做脏检查 */
export async function scanAllWorkspaces(): Promise<DirtySession[]> {
  const all = await workspaceService.getAll();
  const out: DirtySession[] = [];
  for (const ws of all) {
    out.push(...await findDirtySessions(ws.id, ws.path));
  }
  return out;
}
