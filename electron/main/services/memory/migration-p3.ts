// Phase 3 Step 1 幂等迁移：
//   1. 旧 <sessionId>.md → <groupId>.md（组卡升级）
//   2. smart-categories.json conversationIds → groupIds
//   3. conversation-tree.json children 装 groupId
import fs from 'node:fs/promises';
import path from 'node:path';
import * as workspaceService from '../workspace-json-service.js';
import * as conversationService from '../conversation-service.js';
import { getWorkspaceDataDir } from '../conversation-service.js';
import { mainLogger } from '../../agents/logger.js';
import { safeJsonWrite } from '../safe-json.js';
import { parseFrontmatter, type Frontmatter } from './memory-fs.js';
import {
  readGroupDigest, saveGroupDigest,
  type GroupDigestCard,
} from './group-digest-store.js';
import { getSessionJsonlPath } from './session-paths.js';
import type { ConversationIndex } from '../conversation-service.js';
import type { DigestTags } from '../../types.js';

const ARCHIVE_DIR_NAME = '_archive';
const ORPHAN_DIR_NAME = '_orphan';
const SCHEMA_VERSION_2 = 2;

// ─── 旧 digest 卡读取（仅迁移用，迁完即弃）─────────────────────────────

interface LegacyDigestCard {
  sessionId: string;
  conversationId?: string;
  title: string;
  createdAt: string;
  sourceMtime: number;
  summary: string;
  items: { kind: string; text: string; uuid: string }[];
  tags?: DigestTags;
}

const LEGACY_ITEM_RE = /^- \[(.+?)\] ([\s\S]*?) ⟶ (\S+)$/;

function legacyStrOf(v: Frontmatter[string] | undefined): string {
  return typeof v === 'string' ? v : Array.isArray(v) ? v.join(', ') : '';
}

function parseLegacyDigestCard(raw: string): LegacyDigestCard | null {
  const { fm, body } = parseFrontmatter(raw);
  const sessionId = legacyStrOf(fm.sessionId);
  if (!sessionId) return null;
  const summaryMatch = body.match(/## 概述\s*\n([\s\S]*?)(?:\n## |\s*$)/);
  const summary = summaryMatch ? summaryMatch[1].trim() : '';
  const items: LegacyDigestCard['items'] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(LEGACY_ITEM_RE);
    if (m) items.push({ kind: m[1], text: m[2].trim(), uuid: m[3] });
  }
  let tags: DigestTags | undefined;
  const tagsJson = legacyStrOf(fm.tagsJson);
  if (tagsJson) {
    try {
      const parsed = JSON.parse(tagsJson.replace(/\\"/g, '"'));
      if (parsed && typeof parsed.primary === 'string') tags = parsed as DigestTags;
    } catch { /* ignore */ }
  }
  return {
    sessionId,
    conversationId: legacyStrOf(fm.conversationId) || undefined,
    title: legacyStrOf(fm.title),
    createdAt: legacyStrOf(fm.createdAt),
    sourceMtime: Number(legacyStrOf(fm.sourceMtime)) || 0,
    summary,
    items,
    tags,
  };
}

function getDigestsDir(wsId: string): string {
  return path.join(getWorkspaceDataDir(wsId), 'digests');
}

async function readLegacyDigest(wsId: string, sessionId: string): Promise<LegacyDigestCard | null> {
  try {
    const raw = await fs.readFile(path.join(getDigestsDir(wsId), `${sessionId}.md`), 'utf-8');
    return parseLegacyDigestCard(raw);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

/** 主入口，幂等执行 */
export async function runMigrationP3(configDir: string): Promise<void> {
  mainLogger.info('[migration-p3] 开始迁移');
  const workspaces = await workspaceService.getAll();
  for (const ws of workspaces) {
    try {
      await migrateWorkspace(configDir, ws.id, ws.path);
    } catch (err) {
      mainLogger.warn(`[migration-p3] 工作区 ${ws.id} 迁移失败:`, err);
    }
  }
  mainLogger.info('[migration-p3] 迁移完成');
}

async function migrateWorkspace(configDir: string, wsId: string, wsPath: string): Promise<void> {
  const convs = await conversationService.getByWorkspaceId(wsId, { includeArchived: true });

  // 步骤 1: 旧 <sessionId>.md → <groupId>.md
  await migrateDigestCards(wsId, wsPath, convs);

  // 步骤 2: smart-categories.json conversationIds → groupIds
  await migrateSmartCategories(configDir, wsId, convs);

  // 步骤 3: conversation-tree.json children 装 groupId
  await migrateConversationTree(configDir, wsId, convs);
}

// ─── 步骤 1: 旧会话卡 → 组卡 ───

async function migrateDigestCards(
  wsId: string,
  wsPath: string,
  convs: ConversationIndex[],
): Promise<void> {
  const digestsDir = getDigestsDir(wsId);
  let names: string[];
  try {
    names = await fs.readdir(digestsDir);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return;
    throw err;
  }

  // 建立 sessionId → conversation 映射
  const sessionToConv = new Map<string, ConversationIndex>();
  for (const c of convs) {
    if (c.sessionId) sessionToConv.set(c.sessionId, c);
  }

  // 建立 groupId → main 会话数量映射
  const groupMainCount = new Map<string, number>();
  for (const c of convs) {
    if (c.groupId && c.role !== 'sub' && c.sessionId) {
      groupMainCount.set(c.groupId, (groupMainCount.get(c.groupId) ?? 0) + 1);
    }
  }

  const SKIP_DIRS = new Set(['_cleaned', '_archive', '_orphan']);

  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue;
    if (!name.endsWith('.md')) continue;

    const oldPath = path.join(digestsDir, name);

    // 按 frontmatter 判定格式：有 groupId 已是新组卡（跳过）；只有 sessionId 才是旧会话卡
    // 光看文件名会把 group_xxx.md 当成 sessionId="group_xxx" 误搬到 _orphan
    let sessionId: string;
    try {
      const raw = await fs.readFile(oldPath, 'utf-8');
      const { fm } = parseFrontmatter(raw);
      const gid = typeof fm.groupId === 'string' ? fm.groupId.trim() : '';
      if (gid) continue; // 已是新格式组卡，不动
      const sid = typeof fm.sessionId === 'string' ? fm.sessionId.trim() : '';
      if (!sid) {
        mainLogger.warn(`[migration-p3] 无法识别的 digest md（frontmatter 缺 sessionId 与 groupId），跳过: ${oldPath}`);
        continue;
      }
      sessionId = sid;
    } catch (err) {
      mainLogger.warn(`[migration-p3] 读取 digest md 失败，跳过: ${oldPath}`, err);
      continue;
    }

    const conv = sessionToConv.get(sessionId);
    if (!conv || conv.role === 'sub') {
      // 找不到 conversation 或是 sub：移到 _archive/_orphan/
      await moveToOrphan(digestsDir, oldPath, sessionId);
      continue;
    }

    if (!conv.groupId) {
      // conversation 没有 groupId（不应发生，但防御）
      await moveToOrphan(digestsDir, oldPath, sessionId);
      continue;
    }

    const groupId = conv.groupId;
    const mainCount = groupMainCount.get(groupId) ?? 0;
    const existingCard = await readGroupDigest(wsId, groupId);

    if (mainCount === 1 && !existingCard) {
      // 单会话组且组卡不存在：升级
      try {
        await upgradeSessionCardToGroup(wsId, wsPath, oldPath, sessionId, conv);
      } catch (err) {
        mainLogger.warn(`[migration-p3] 升级会话卡失败 ${sessionId}:`, err);
        // 升级失败时移到 archive
        await moveToArchive(digestsDir, oldPath, sessionId);
      }
    } else {
      // 多会话组 或 组卡已存在：移到 archive 让 agent 下次重建
      await moveToArchive(digestsDir, oldPath, sessionId);
    }
  }
}

async function upgradeSessionCardToGroup(
  wsId: string,
  wsPath: string,
  oldPath: string,
  sessionId: string,
  conv: ConversationIndex,
): Promise<void> {
  const oldCard = await readLegacyDigest(wsId, sessionId);
  if (!oldCard) return;

  let mtime = oldCard.sourceMtime;
  try {
    mtime = (await fs.stat(getSessionJsonlPath(wsPath, sessionId))).mtimeMs;
  } catch { /* JSONL 已不在则沿用 sourceMtime */ }

  const groupId = conv.groupId!;
  const now = oldCard.createdAt || new Date().toISOString();
  const card: GroupDigestCard = {
    groupId,
    title: oldCard.title,
    createdAt: now,
    updatedAt: now,
    sourcesSeen: [{ sessionId, conversationId: conv.id, mtime }],
    summary: oldCard.summary,
    items: oldCard.items.map((i) => ({
      kind: i.kind as GroupDigestCard['items'][number]['kind'],
      text: i.text,
      sources: [{ sessionId, uuid: i.uuid }],
    })),
    keyOutputs: [],
    tags: oldCard.tags,
  };

  await saveGroupDigest(wsId, card);

  // 旧卡移到 _archive
  const archiveDir = path.join(getDigestsDir(wsId), ARCHIVE_DIR_NAME);
  await fs.mkdir(archiveDir, { recursive: true });
  const archiveDest = path.join(archiveDir, `${sessionId}.md`);
  // 幂等：若 archive 目标已存在，直接覆盖再删旧卡
  try {
    await fs.rename(oldPath, archiveDest);
  } catch (err: any) {
    if (err?.code === 'EEXIST' || err?.code === 'EPERM') {
      // Windows: rename 到已存在文件报 EPERM/EEXIST，先删目标
      try { await fs.unlink(archiveDest); } catch { /* 忽略 */ }
      await fs.rename(oldPath, archiveDest);
    } else {
      throw err;
    }
  }
}

async function moveToArchive(digestsDir: string, oldPath: string, sessionId: string): Promise<void> {
  const archiveDir = path.join(digestsDir, ARCHIVE_DIR_NAME);
  await fs.mkdir(archiveDir, { recursive: true });
  const dest = path.join(archiveDir, `${sessionId}.md`);
  try {
    await fs.rename(oldPath, dest);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return; // 旧卡已不在，无操作
    if (err?.code === 'EEXIST' || err?.code === 'EPERM') {
      try { await fs.unlink(dest); } catch { /* 忽略 */ }
      try { await fs.rename(oldPath, dest); } catch { /* 旧卡已不在或重命名失败，忽略 */ }
    }
  }
}

async function moveToOrphan(digestsDir: string, oldPath: string, sessionId: string): Promise<void> {
  const orphanDir = path.join(digestsDir, ARCHIVE_DIR_NAME, ORPHAN_DIR_NAME);
  await fs.mkdir(orphanDir, { recursive: true });
  const dest = path.join(orphanDir, `${sessionId}.md`);
  try {
    await fs.rename(oldPath, dest);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return;
    if (err?.code === 'EEXIST' || err?.code === 'EPERM') {
      try { await fs.unlink(dest); } catch { /* 忽略 */ }
      try { await fs.rename(oldPath, dest); } catch { /* 忽略 */ }
    }
  }
}

// ─── 步骤 2: smart-categories.json conversationIds → groupIds ───

export async function migrateSmartCategories(
  configDir: string,
  wsId: string,
  convs: ConversationIndex[],
): Promise<void> {
  const filePath = path.join(configDir, 'workspaces', wsId, 'smart-categories.json');
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (err: any) {
    if (err?.code === 'ENOENT') return;
    throw err;
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    mainLogger.warn(`[migration-p3] smart-categories.json 解析失败，跳过 wsId=${wsId}`);
    return;
  }

  // 幂等检测
  if (data.schemaVersion === SCHEMA_VERSION_2) return;

  // 建立 convId → groupId 映射
  const convToGroup = new Map<string, string>();
  for (const c of convs) {
    if (c.groupId) convToGroup.set(c.id, c.groupId);
  }

  const categories = Array.isArray(data.categories) ? data.categories : [];
  // 防御：新格式数据（只有 groupIds、无 conversationIds）误入迁移时，
  // 不能用空映射结果覆盖现有挂载——只做合并，永不丢已有 groupIds
  const upgraded = categories.map((cat: any) => {
    const { conversationIds: oldIds, groupIds: existingIds, ...rest } = cat;
    const mapped = (Array.isArray(oldIds) ? oldIds : [])
      .map((cid: string) => convToGroup.get(cid))
      .filter((gid): gid is string => !!gid);
    const kept = Array.isArray(existingIds) ? existingIds : [];
    return { ...rest, groupIds: [...new Set([...kept, ...mapped])] };
  });

  const upgraded_data = {
    ...data,
    categories: upgraded,
    schemaVersion: SCHEMA_VERSION_2,
  };
  // 从 upgraded_data 中删除旧字段（如果顶层有的话，保险起见）
  delete upgraded_data.conversationIds;

  await safeJsonWrite(filePath, upgraded_data);
  mainLogger.info(`[migration-p3] smart-categories.json 升级完成 wsId=${wsId}`);
}

// ─── 步骤 3: conversation-tree.json children 装 groupId ───

async function migrateConversationTree(
  configDir: string,
  wsId: string,
  convs: ConversationIndex[],
): Promise<void> {
  const filePath = path.join(configDir, 'workspaces', wsId, 'conversation-tree.json');
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (err: any) {
    if (err?.code === 'ENOENT') return;
    throw err;
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    mainLogger.warn(`[migration-p3] conversation-tree.json 解析失败，跳过 wsId=${wsId}`);
    return;
  }

  // 幂等检测
  if (data.schemaVersion === SCHEMA_VERSION_2) return;

  // 建立 convId → groupId 映射
  const convToGroup = new Map<string, string>();
  for (const c of convs) {
    if (c.groupId) convToGroup.set(c.id, c.groupId);
  }

  const children: Record<string, string[]> = data.children ?? {};
  const folders: Record<string, any> = data.folders ?? {};
  const folderIds = new Set(Object.keys(folders));
  const ROOT_ID = '__root__';

  const upgradedChildren: Record<string, string[]> = {};
  for (const [parentId, childrenList] of Object.entries(children)) {
    if (!Array.isArray(childrenList)) {
      upgradedChildren[parentId] = [];
      continue;
    }
    if (parentId === ROOT_ID) {
      // __root__ 只保留 folderId（migrateRootScatter 思路）
      upgradedChildren[parentId] = childrenList.filter((id: string) => folderIds.has(id));
    } else {
      // 文件夹 children：conversationId → groupId，去重，找不到的剔除
      const seen = new Set<string>();
      const mapped: string[] = [];
      for (const id of childrenList as string[]) {
        const groupId = convToGroup.get(id);
        if (groupId && !seen.has(groupId)) {
          seen.add(groupId);
          mapped.push(groupId);
        }
      }
      upgradedChildren[parentId] = mapped;
    }
  }

  const upgraded_data = {
    ...data,
    children: upgradedChildren,
    schemaVersion: SCHEMA_VERSION_2,
  };

  await safeJsonWrite(filePath, upgraded_data);
  mainLogger.info(`[migration-p3] conversation-tree.json 升级完成 wsId=${wsId}`);
}
