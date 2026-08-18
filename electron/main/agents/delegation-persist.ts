/**
 * delegation 子会话状态快照落盘（持久层）
 *
 * childStates 的全量快照写 .dogear/delegation-state.json（全局单文件不分 workspace——
 * childStates 本就跨 workspace）。纯读写与形状转换集中在本模块，
 * 状态变更点（touchPersist）与恢复编排（loadChildStates）在 delegation-bridge.ts。
 */

import path from 'node:path';
import { safeJsonRead, safeJsonWrite, withFileLock } from '../services/safe-json.js';
import * as conversationService from '../services/conversation-service.js';
import { getConfigDir } from './logger.js';
import type { ConversationIndex } from '../services/conversation-service.js';
import type { SubAgentProfile } from '../services/settings-types.js';
import type { ChildStateSnapshot } from '../types.js';

export const DELEGATION_STATE_FILE = 'delegation-state.json';

export interface PersistedChildState extends ChildStateSnapshot {
  workspaceId: string;
}

interface DelegationStateFile {
  version: 1;
  children: PersistedChildState[];
}

export function getDelegationStatePath(): string {
  return path.join(getConfigDir(), DELEGATION_STATE_FILE);
}

/**
 * 全量覆盖写。写是内存快照全量覆盖、无读改写竞争面，但仍过 '#txn' 锁
 * 保持与 conversations.json 事务相同的纪律（与 safeJsonWrite 内部同路径写锁是不同键，无重入死锁）。
 */
export async function persistDelegationState(build: () => PersistedChildState[]): Promise<void> {
  await withFileLock(getDelegationStatePath() + '#txn', async () => {
    await safeJsonWrite(getDelegationStatePath(), { version: 1, children: build() });
  });
}

export async function readPersistedChildren(): Promise<PersistedChildState[]> {
  const file = await safeJsonRead<Partial<DelegationStateFile>>(getDelegationStatePath(), {});
  return Array.isArray(file.children) ? (file.children as PersistedChildState[]) : [];
}

/**
 * 重启恢复用的过滤与转换：conversation 已不存在的条目丢弃；
 * running 的改 interrupted（重启不自动续跑——主会话自身也断了，无人接收交付）。
 */
export async function loadRestorableChildren(): Promise<{ restored: PersistedChildState[]; hadEntries: boolean }> {
  const persisted = await readPersistedChildren();
  if (persisted.length === 0) return { restored: [], hadEntries: false };
  const restored: PersistedChildState[] = [];
  for (const p of persisted) {
    const conv = await conversationService.getById(p.workspaceId, p.childId);
    if (!conv) continue;
    if (p.status === 'running') {
      restored.push({ ...p, status: 'interrupted', errorMessage: '应用重启中断' });
    } else {
      restored.push(p);
    }
  }
  return { restored, hadEntries: true };
}

/**
 * 持久层补集条目（内存不跟踪的历史子会话）转 snapshot 形状。
 * status 恒为 interrupted：不在内存即代表本进程未在跑它。
 */
export function conversationToSnapshot(
  conv: ConversationIndex,
  profiles: SubAgentProfile[],
): ChildStateSnapshot {
  const profileId = conv.contractMetadata?.subAgentProfileId;
  const profile = profileId ? profiles.find((p) => p.id === profileId) : undefined;
  return {
    childId: conv.id,
    parentConversationId: conv.parentConversationId ?? '',
    groupId: conv.groupId ?? '',
    outputPath: conv.contractMetadata?.expectedOutputPath ?? '',
    task: conv.contractMetadata?.task ?? '',
    title: conv.title,
    status: 'interrupted',
    startedAt: Date.parse(conv.createdAt) || 0,
    profileName: profile?.name ?? '默认',
    sessionId: conv.sessionId ?? undefined,
  };
}
