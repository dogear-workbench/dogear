/**
 * Harness session entry 读取的唯一入口（全局决策：Harness 的 session entry / transcript
 * 读取只能经 pi-session/ 内的共享 reader，其他模块不得直接解析 JSONL 或 Harness 内部对象）。
 *
 * 只读当前 branch（根到当前 leaf，遇到 compaction 提前截断），不涉及运行时 AgentHarness 实例，
 * 也就不会踩到 pi-harness-adapter.ts 记录的事件订阅坑。
 */
import type { SessionTreeEntry } from '@earendil-works/pi-agent-core';
import { getPiSessionRepository } from './pi-session-repository.js';

export async function readSessionBranchEntries(
  workspaceId: string,
  sessionId: string,
): Promise<SessionTreeEntry[]> {
  const repository = getPiSessionRepository();
  const session = await repository.open(workspaceId, sessionId);
  return session.getBranch();
}
