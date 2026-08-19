/**
 * sessionId 丢失自愈：启动时扫描 conversations.json 中 sessionId 为 null 的会话，
 * 按 harness session 文件的创建时间与 conversation.createdAt 对齐（±2 秒）回填真实 sessionId。
 *
 * 背景（2026-08-19）：主会话 sessionId 被写成 null 后级联瘫痪——ResumeSession 校验失败、
 * 子会话契约通道「父不可达」→ 全部误判 no_delivery、UI 引用会话 attach 失败「消失」。
 * 确切覆盖者未定位（函数级并发已复现排除），本模块保证复发时数据可自动恢复。
 *
 * 不经 PiSessionRepository.list：其 cwd 过滤/路径解析在不同环境下行为不一致，
 * 直接扫 sessions/<flat-cwd>/<ts>_<sessionId>.jsonl 文件名（jsonl-repo 的稳定命名契约）。
 */

import fs from 'fs/promises';
import path from 'path';
import * as conversationService from './conversation-service.js';
import { getConfigDir } from '../agents/logger.js';

const ALIGN_WINDOW_MS = 2000;

interface HarnessCandidate {
  sessionId: string;
  createdAtMs: number;
}

/** 文件名形如 2026-08-19T03-06-36-014Z_01a017fc-266e-....jsonl */
function parseSessionFileName(name: string): HarnessCandidate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_([0-9a-f-]+)\.jsonl$/i.exec(name);
  if (!match) return null;
  const createdAtMs = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.${match[7]}Z`);
  if (!Number.isFinite(createdAtMs)) return null;
  return { sessionId: match[8], createdAtMs };
}

async function listHarnessCandidates(workspaceId: string): Promise<HarnessCandidate[]> {
  const sessionsRoot = path.join(getConfigDir(), 'workspaces', workspaceId, 'sessions');
  const candidates: HarnessCandidate[] = [];
  let cwdDirs: string[];
  try {
    cwdDirs = (await fs.readdir(sessionsRoot, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => path.join(sessionsRoot, e.name));
  } catch {
    return candidates;
  }
  for (const dir of cwdDirs) {
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      const parsed = parseSessionFileName(file);
      if (parsed) candidates.push(parsed);
    }
  }
  return candidates;
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
      const harnesses = (await listHarnessCandidates(workspaceId))
        .filter((h) => !takenSessionIds.has(h.sessionId));

      const assignments: Record<string, string> = {};
      for (const conv of broken) {
        const convCreatedMs = new Date(conv.createdAt).getTime();
        let best: HarnessCandidate | null = null;
        let bestDelta = Infinity;
        for (const h of harnesses) {
          const delta = Math.abs(h.createdAtMs - convCreatedMs);
          if (delta > ALIGN_WINDOW_MS || delta >= bestDelta) continue;
          best = h;
          bestDelta = delta;
        }
        if (best) {
          assignments[conv.id] = best.sessionId;
          takenSessionIds.add(best.sessionId);
          harnesses.splice(harnesses.indexOf(best), 1);
        } else {
          console.warn(`[session-id-repair] 会话 ${conv.id} sessionId 为 null 且未找到时间对齐的 harness 文件，跳过（title: ${conv.title}）`);
        }
      }

      const repairedCount = Object.keys(assignments).length > 0
        ? await conversationService.repairSessionIds(workspaceId, assignments)
        : 0;
      if (repairedCount > 0) {
        console.warn(`[session-id-repair] 工作区 ${workspaceId} 自愈回填 ${repairedCount} 个会话的 sessionId`);
      }
    } catch (error) {
      console.error(`[session-id-repair] 工作区 ${workspaceId} 扫描失败:`, error);
    }
  }
}
