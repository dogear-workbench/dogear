// 组卡引用保真度校验（纯函数 + IO 分离，与 transcript-cleaner.ts 同风格）
// 确保 SaveGroupDigest 里的每个 sessionId#uuid 都真实存在于对应会话的去噪逐字稿
import fs from 'node:fs/promises';
import { getSessionJsonlPath } from './session-paths.js';
import { cleanMessagesFromLines } from './transcript-cleaner.js';

/**
 * 对每个 sessionId 读一次 JSONL，复用 cleanMessagesFromLines 保证校验口径与 agent 所见一致。
 * 返回值中 null 表示该会话的 JSONL 文件不存在。
 */
export async function buildSessionUuidIndex(
  workspacePath: string,
  sessionIds: string[],
): Promise<Map<string, Set<string> | null>> {
  const index = new Map<string, Set<string> | null>();
  await Promise.all(sessionIds.map(async (sid) => {
    try {
      const file = getSessionJsonlPath(workspacePath, sid);
      const raw = await fs.readFile(file, 'utf-8');
      const lines = raw.split('\n').filter(Boolean);
      const messages = cleanMessagesFromLines(lines);
      index.set(sid, new Set(messages.map((m) => m.uuid).filter(Boolean)));
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        index.set(sid, null);
      } else {
        throw err;
      }
    }
  }));
  return index;
}

export interface SourceProblem {
  itemIndex: number;
  /** 截断到 40 字，够 agent 定位是哪条 */
  itemText: string;
  sessionId: string;
  uuid: string;
  kind: 'session_missing' | 'uuid_not_found' | 'wrong_session';
  /** kind='wrong_session' 时给出正确的 sessionId */
  correctSessionId?: string;
}

/** 纯函数：拿索引校验 items，返回所有问题 */
export function validateItemSources(
  index: Map<string, Set<string> | null>,
  items: Array<{ text: string; sources: Array<{ sessionId: string; uuid: string }> }>,
): SourceProblem[] {
  const problems: SourceProblem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const itemText = item.text.length > 40 ? item.text.slice(0, 40) + '…' : item.text;
    for (const src of item.sources) {
      const { sessionId, uuid } = src;
      const uuidSet = index.get(sessionId);
      if (uuidSet === null || uuidSet === undefined) {
        problems.push({ itemIndex: i, itemText, sessionId, uuid, kind: 'session_missing' });
        continue;
      }
      if (uuidSet.has(uuid)) continue;
      // uuid 不在声称的会话——在本次引用到的其它会话里找一遍
      let correctSessionId: string | undefined;
      for (const [otherSid, otherSet] of index) {
        if (otherSid !== sessionId && otherSet !== null && otherSet.has(uuid)) {
          correctSessionId = otherSid;
          break;
        }
      }
      problems.push({
        itemIndex: i, itemText, sessionId, uuid,
        kind: correctSessionId ? 'wrong_session' : 'uuid_not_found',
        correctSessionId,
      });
    }
  }
  return problems;
}
