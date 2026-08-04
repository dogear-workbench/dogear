// 组卡引用保真度校验（纯函数 + IO 分离，与 transcript-cleaner.ts 同风格）
// 确保 SaveGroupDigest 里的每个 sessionId#uuid 都真实存在于对应会话的去噪逐字稿
// buildSessionUuidIndex 的实现现在在 pi-session/transcript-adapter.ts（Harness 类型不得泄漏出该目录），
// 这里薄转发，validateItemSources 是纯函数，与数据来源无关，留在此文件。
export { buildSessionUuidIndex } from '../../agents/pi-session/transcript-adapter.js';

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
