/**
 * sessionId 丢失自愈：启动时扫描 conversations.json 中 sessionId 为 null 的会话，
 * 按 harness session 文件的创建时间与 conversation.createdAt 对齐（±2 秒）回填真实 sessionId。
 *
 * 背景（2026-08-19）：主会话 sessionId 被写成 null 后级联瘫痪——ResumeSession 校验失败、
 * 子会话契约通道「父不可达」→ 全部误判 no_delivery、UI 引用会话 attach 失败「消失」。
 * 确切覆盖者未定位（函数级并发已复现排除），本模块保证复发时数据可自动恢复。
 *
 * 2026-09-05 复发且后果放大：sessionId 被置空后 UI attach 误判新会话 → 新建空壳 harness
 * 并回写 → 真实实体成孤儿。启动自愈只救 null 态、救不了被空壳 id 覆盖后的会话，因此
 * 新增 attach 防线 recoverAlignedHarnessForConversation：有历史轮次但 sessionId 丢失时
 * 先对齐回填再走 open 恢复，堵死空壳覆盖的二次伤害。
 *
 * 不经 PiSessionRepository.list：其面向元数据列表，时间对齐需要直接轻量读各会话 sidecar，
 * 直接扫 sessions/<sessionId>/session.json（目录名即 sessionId，pi-durable 布局；
 * 迁移前的旧文件名契约已由 storage-migrator.ts 一次性转换，此处只见新布局）。
 */

import fs from 'fs/promises';
import path from 'path';
import * as conversationService from './conversation-service.js';
import { mainLogger, getConfigDir } from '../agents/logger.js';

const ALIGN_WINDOW_MS = 2000;

const logger = mainLogger.child('SessionIdRepair');

interface HarnessCandidate {
  sessionId: string;
  createdAtMs: number;
}

async function listHarnessCandidates(workspaceId: string): Promise<HarnessCandidate[]> {
  const sessionsRoot = path.join(getConfigDir(), 'workspaces', workspaceId, 'sessions');
  const candidates: HarnessCandidate[] = [];
  let sessionDirs: import('fs').Dirent[];
  try {
    sessionDirs = (await fs.readdir(sessionsRoot, { withFileTypes: true }))
      .filter((e) => e.isDirectory());
  } catch {
    return candidates;
  }
  for (const dir of sessionDirs) {
    let raw: string;
    try {
      raw = await fs.readFile(path.join(sessionsRoot, dir.name, 'session.json'), 'utf-8');
    } catch {
      continue;
    }
    try {
      const meta = JSON.parse(raw) as { id?: unknown; createdAt?: unknown };
      if (typeof meta.id !== 'string' || meta.id !== dir.name) continue;
      if (typeof meta.createdAt !== 'number' || !Number.isFinite(meta.createdAt)) continue;
      candidates.push({ sessionId: dir.name, createdAtMs: meta.createdAt });
    } catch {
      continue;
    }
  }
  return candidates;
}

/**
 * 单会话时间对齐：±ALIGN_WINDOW_MS 窗口内找未被占用（takenSessionIds）、
 * 创建时间最接近 createdAtMs 的 harness 候选。启动批量自愈与 attach 防线共用。
 */
export async function findAlignedHarness(
  workspaceId: string,
  createdAtMs: number,
  takenSessionIds: Set<string>,
): Promise<HarnessCandidate | null> {
  const harnesses = (await listHarnessCandidates(workspaceId))
    .filter((h) => !takenSessionIds.has(h.sessionId));
  let best: HarnessCandidate | null = null;
  let bestDelta = Infinity;
  for (const h of harnesses) {
    const delta = Math.abs(h.createdAtMs - createdAtMs);
    if (delta > ALIGN_WINDOW_MS || delta >= bestDelta) continue;
    best = h;
    bestDelta = delta;
  }
  return best;
}

/**
 * attach 防线：有历史轮次但 sessionId 丢失的会话，按创建时间对齐找回真实 harness 并回填。
 * 返回回填的 harness sessionId（调用方以 isRestore 语义走 open 恢复）；
 * 不满足触发条件或无对齐候选时返回 null，调用方降级走新建（现状行为）。
 */
export async function recoverAlignedHarnessForConversation(
  workspaceId: string,
  conversation: {
    id: string;
    sessionId: string | null;
    createdAt: string;
    title: string;
    usageSummary?: { turnCount?: number };
  },
): Promise<string | null> {
  if (conversation.sessionId) return null;
  if ((conversation.usageSummary?.turnCount ?? 0) === 0) return null;

  const conversations = await conversationService.getByWorkspaceId(workspaceId, { includeArchived: true });
  const takenSessionIds = new Set(
    conversations.filter((c) => c.sessionId).map((c) => c.sessionId as string),
  );
  const aligned = await findAlignedHarness(
    workspaceId,
    new Date(conversation.createdAt).getTime(),
    takenSessionIds,
  );
  if (!aligned) {
    logger.warn(
      `[attach 防线] 会话 ${conversation.id}（title: ${conversation.title}）sessionId 丢失且有 ` +
      `${conversation.usageSummary?.turnCount} 轮历史，但未找到时间对齐的 harness 文件，降级新建`,
    );
    return null;
  }
  await conversationService.repairSessionIds(workspaceId, { [conversation.id]: aligned.sessionId });
  logger.warn(
    `[attach 防线] 会话 ${conversation.id}（title: ${conversation.title}）sessionId 丢失，` +
    `已按时间对齐回填 harness ${aligned.sessionId}，走恢复路径`,
  );
  return aligned.sessionId;
}

export async function repairNullSessionIdsAcrossWorkspaces(): Promise<void> {
  const workspacesDir = path.join(getConfigDir(), 'workspaces');
  let entries: string[];
  try {
    entries = (await fs.readdir(workspacesDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return;
  }

  for (const workspaceId of entries) {
    try {
      const conversations = await conversationService.getByWorkspaceId(workspaceId, { includeArchived: true });
      const broken = conversations.filter((c) => !c.sessionId);
      if (broken.length === 0) continue;

      const takenSessionIds = new Set(
        conversations.filter((c) => c.sessionId).map((c) => c.sessionId as string),
      );

      const assignments: Record<string, string> = {};
      for (const conv of broken) {
        const best = await findAlignedHarness(workspaceId, new Date(conv.createdAt).getTime(), takenSessionIds);
        if (best) {
          assignments[conv.id] = best.sessionId;
          takenSessionIds.add(best.sessionId);
        } else {
          logger.warn(`会话 ${conv.id} sessionId 为 null 且未找到时间对齐的 harness 文件，跳过（title: ${conv.title}）`);
        }
      }

      const repairedCount = Object.keys(assignments).length > 0
        ? await conversationService.repairSessionIds(workspaceId, assignments)
        : 0;
      if (repairedCount > 0) {
        logger.warn(`工作区 ${workspaceId} 自愈回填 ${repairedCount} 个会话的 sessionId`);
      }
    } catch (error) {
      logger.error(`工作区 ${workspaceId} 扫描失败:`, error);
    }
  }
}
