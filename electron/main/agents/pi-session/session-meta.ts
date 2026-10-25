import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * 会话目录的应用层元数据 sidecar：sessions/<sessionId>/session.json。
 * durable 的 ConversationRecord 只有 id/parent/owner（无 cwd/createdAt），应用需要的
 * 创建时间与工作区路径、以及 durable 主 conversation 的数字 id 都落在这里。
 * main.jsonl 及 doc-*.jsonl sidecar 归 JsonlStorage 所有，本文件不与其混用。
 */
export interface SessionMeta {
  id: string;
  /** 创建时间 ms */
  createdAt: number;
  cwd: string;
  /** durable storage 内的主 conversation 数字 id（scanConversations ascending 首个） */
  conversationId: number;
}

export const SESSION_META_FILE = 'session.json';
export const SESSION_MAIN_FILE = 'main.jsonl';

export function getSessionDir(sessionsRoot: string, sessionId: string): string {
  return path.join(sessionsRoot, sessionId);
}

export async function readSessionMeta(dir: string): Promise<SessionMeta | null> {
  try {
    const raw = await fs.readFile(path.join(dir, SESSION_META_FILE), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<SessionMeta>;
    if (
      typeof parsed.id !== 'string' || !parsed.id ||
      typeof parsed.createdAt !== 'number' || !Number.isFinite(parsed.createdAt) ||
      typeof parsed.cwd !== 'string' ||
      typeof parsed.conversationId !== 'number' || !Number.isSafeInteger(parsed.conversationId)
    ) return null;
    return { id: parsed.id, createdAt: parsed.createdAt, cwd: parsed.cwd, conversationId: parsed.conversationId };
  } catch {
    return null;
  }
}

export async function writeSessionMeta(dir: string, meta: SessionMeta): Promise<void> {
  await fs.writeFile(path.join(dir, SESSION_META_FILE), `${JSON.stringify(meta, null, 2)}\n`, 'utf-8');
}
