import fs from 'node:fs/promises';
import path from 'node:path';
import * as workspaceService from './workspace-json-service.js';
import { getWorkspaceDataDir } from './conversation-service.js';
import { getConfigDir } from './settings-service.js';
import { mainLogger } from '../agents/logger.js';
import { safeJsonWrite, safeJsonRead } from './safe-json.js';

const MIGRATION_MARKER = 'migration-session-id-done.json';
const EMPTY_SHELL_THRESHOLD = 225;

interface RepairTarget {
  titlePattern: string;
  correctSessionIdPrefix: string;
  reason: string;
}

const REPAIR_MAP: RepairTarget[] = [
  { titlePattern: '开始实施 b694', correctSessionIdPrefix: '019fd0ee-82e3', reason: 'sdkSessionId 兜底' },
  { titlePattern: 'step1 话题', correctSessionIdPrefix: '019fd0e5-27a9', reason: 'jsonl 时间戳匹配 createdAt' },
  { titlePattern: 'step3 UI', correctSessionIdPrefix: '019fd0f8-df63', reason: 'jsonl 时间戳匹配 createdAt' },
  { titlePattern: 'step4 验收', correctSessionIdPrefix: '019fd105-fc51', reason: 'jsonl 时间戳匹配 createdAt' },
];

function getSessionsDir(wsId: string): string {
  return path.join(getWorkspaceDataDir(wsId), 'sessions');
}

async function findSessionFile(wsId: string, sessionId: string): Promise<string | null> {
  const sessionsDir = getSessionsDir(wsId);
  let entries: string[];
  try {
    entries = await fs.readdir(sessionsDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const subDir = path.join(sessionsDir, entry);
    let stat;
    try {
      stat = await fs.stat(subDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    let files: string[];
    try {
      files = await fs.readdir(subDir);
    } catch {
      continue;
    }
    const match = files.find((f) => f.endsWith(`_${sessionId}.jsonl`));
    if (match) return path.join(subDir, match);
  }
  return null;
}

async function isSessionEmptyShell(wsId: string, sessionId: string): Promise<boolean> {
  if (!sessionId) return true;
  const filePath = await findSessionFile(wsId, sessionId);
  if (!filePath) return true;
  try {
    const stat = await fs.stat(filePath);
    return stat.size <= EMPTY_SHELL_THRESHOLD;
  } catch {
    return true;
  }
}

async function findCorrectSessionFile(wsId: string, sessionIdPrefix: string): Promise<string | null> {
  const sessionsDir = getSessionsDir(wsId);
  let entries: string[];
  try {
    entries = await fs.readdir(sessionsDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const subDir = path.join(sessionsDir, entry);
    let stat;
    try {
      stat = await fs.stat(subDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    let files: string[];
    try {
      files = await fs.readdir(subDir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const idMatch = f.match(/_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
      if (idMatch && idMatch[1].startsWith(sessionIdPrefix)) {
        const fullPath = path.join(subDir, f);
        try {
          const fstat = await fs.stat(fullPath);
          if (fstat.size > EMPTY_SHELL_THRESHOLD) return idMatch[1];
        } catch { /* skip */ }
      }
    }
  }
  return null;
}

export async function runSessionIdMigration(): Promise<void> {
  const configDir = getConfigDir();
  const markerPath = path.join(configDir, MIGRATION_MARKER);
  const marker = await safeJsonRead<{ version?: number } | null>(markerPath, null);
  if (marker?.version === 1) {
    mainLogger.info('[migration-session-id] 已迁移过，跳过');
    return;
  }

  mainLogger.info('[migration-session-id] 开始迁移');
  const workspaces = await workspaceService.getAll();

  for (const ws of workspaces) {
    try {
      await migrateWorkspace(ws.id);
    } catch (err) {
      mainLogger.warn(`[migration-session-id] 工作区 ${ws.id} 迁移失败:`, err);
    }
  }

  for (const ws of workspaces) {
    try {
      await cleanupEmptyShells(ws.id);
    } catch (err) {
      mainLogger.warn(`[migration-session-id] 工作区 ${ws.id} 空壳清理失败:`, err);
    }
  }

  await safeJsonWrite(markerPath, { version: 1, timestamp: new Date().toISOString() });
  mainLogger.info('[migration-session-id] 迁移完成');
}

async function migrateWorkspace(wsId: string): Promise<void> {
  const convPath = path.join(getWorkspaceDataDir(wsId), 'conversations.json');
  let raw: any;
  try {
    raw = await safeJsonRead<any>(convPath, { version: 2, conversations: {} });
  } catch {
    return;
  }
  if (!raw.conversations) return;

  let changed = false;
  const conversations = raw.conversations as Record<string, any>;

  for (const [cid, conv] of Object.entries(conversations)) {
    if (!conv || typeof conv !== 'object') continue;

    if ('sdkSessionId' in conv) {
      const sdk = conv.sdkSessionId;
      if (!conv.sessionId && sdk) {
        conv.sessionId = sdk;
        mainLogger.info(`[migration-session-id] ws=${wsId.slice(0, 8)} cid=${cid.slice(0, 8)} sessionId 从 sdkSessionId 兜底: ${sdk.slice(0, 12)}`);
      }
      delete conv.sdkSessionId;
      changed = true;
    }

    const sid = conv.sessionId;
    if (!sid) continue;

    if (await isSessionEmptyShell(wsId, sid)) {
      const title: string = conv.title || '';
      const repair = REPAIR_MAP.find((r) => title.includes(r.titlePattern));
      if (repair) {
        const correctId = await findCorrectSessionFile(wsId, repair.correctSessionIdPrefix);
        if (correctId) {
          conv.sessionId = correctId;
          changed = true;
          mainLogger.info(`[migration-session-id] ws=${wsId.slice(0, 8)} cid=${cid.slice(0, 8)} 空壳修复: ${sid.slice(0, 12)} → ${correctId.slice(0, 12)} (${repair.reason})`);
        } else {
          mainLogger.warn(`[migration-session-id] ws=${wsId.slice(0, 8)} cid=${cid.slice(0, 8)} 空壳但未找到正确 session 文件 (prefix=${repair.correctSessionIdPrefix})`);
        }
      } else {
        mainLogger.warn(`[migration-session-id] ws=${wsId.slice(0, 8)} cid=${cid.slice(0, 8)} 空壳 session 无修复映射，保持原样: ${sid.slice(0, 12)}`);
      }
    }
  }

  if (changed) {
    await safeJsonWrite(convPath, raw);
    mainLogger.info(`[migration-session-id] ws=${wsId.slice(0, 8)} conversations.json 已更新`);
  }
}

async function cleanupEmptyShells(wsId: string): Promise<void> {
  const sessionsDir = getSessionsDir(wsId);
  let entries: string[];
  try {
    entries = await fs.readdir(sessionsDir);
  } catch {
    return;
  }

  let deleted = 0;
  for (const entry of entries) {
    const subDir = path.join(sessionsDir, entry);
    let stat;
    try {
      stat = await fs.stat(subDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    let files: string[];
    try {
      files = await fs.readdir(subDir);
    } catch {
      continue;
    }

    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const fullPath = path.join(subDir, f);
      try {
        const fstat = await fs.stat(fullPath);
        if (fstat.size <= EMPTY_SHELL_THRESHOLD) {
          await fs.unlink(fullPath);
          deleted++;
        }
      } catch { /* skip */ }
    }
  }

  if (deleted > 0) {
    mainLogger.info(`[migration-session-id] ws=${wsId.slice(0, 8)} 清理 ${deleted} 个空壳 jsonl`);
  }
}
