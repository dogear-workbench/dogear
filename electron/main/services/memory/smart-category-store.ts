import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getWorkspaceDataDir } from '../conversation-service.js';
import { safeJsonWrite } from '../safe-json.js';
import { mainLogger } from '../../agents/logger.js';
import type { SmartCategoriesIndex, SmartCategory, CategorizeDecisionLog } from '../../types.js';

const FILE_NAME = 'smart-categories.json';
const MAX_DECISIONS = 20;

export function getIndexPath(wsId: string): string {
  return path.join(getWorkspaceDataDir(wsId), FILE_NAME);
}

export async function readIndex(wsId: string): Promise<SmartCategoriesIndex> {
  try {
    const raw = await fs.readFile(getIndexPath(wsId), 'utf-8');
    const parsed = JSON.parse(raw) as any;
    if (!Array.isArray(parsed.categories)) parsed.categories = [];
    if (!Array.isArray(parsed.recentDecisions)) parsed.recentDecisions = [];
    return parsed as SmartCategoriesIndex;
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      mainLogger.warn('[smart-category] readIndex 失败，返回空索引:', err);
    }
    return { categories: [], recentDecisions: [] };
  }
}

export async function writeIndex(wsId: string, idx: SmartCategoriesIndex): Promise<void> {
  // 统一补写幂等标记：缺 schemaVersion 的文件会被 migration-p3 当旧格式重写 groupIds
  await safeJsonWrite(getIndexPath(wsId), { ...idx, schemaVersion: 2 });
}

// 纯函数：把 groupId 加进指定分类（去重）
export function pushGroup(cat: SmartCategory, groupId: string): SmartCategory {
  if (cat.groupIds.includes(groupId)) return cat;
  return {
    ...cat,
    groupIds: [...cat.groupIds, groupId],
    updatedAt: new Date().toISOString(),
  };
}

// 纯函数：从所有分类中移除 groupId
export function removeGroupEverywhere(idx: SmartCategoriesIndex, groupId: string): SmartCategoriesIndex {
  return {
    ...idx,
    categories: idx.categories.map((c) =>
      c.groupIds.includes(groupId)
        ? { ...c, groupIds: c.groupIds.filter((x) => x !== groupId), updatedAt: new Date().toISOString() }
        : c
    ),
  };
}

// 纯函数：追加一条决策日志（环形）
export function appendDecision(idx: SmartCategoriesIndex, log: CategorizeDecisionLog): SmartCategoriesIndex {
  const next = [log, ...idx.recentDecisions];
  return { ...idx, recentDecisions: next.slice(0, MAX_DECISIONS) };
}

export function newCategory(name: string, anchorTags: string[]): SmartCategory {
  const now = new Date().toISOString();
  // 8-char hex 前缀（~32-bit 熵），单工作区分类上限 10 个，碰撞概率可忽略
  return { id: `cat_${randomUUID().slice(0, 8)}`, name, anchorTags, groupIds: [], createdAt: now, updatedAt: now };
}

// 纯函数：合并两个分类为一个新分类（不 mutate，fromIds 任一不存在或相同则 throw）
export function mergeCategories(
  idx: SmartCategoriesIndex,
  fromIds: [string, string],
  name: string,
  anchorTags: string[],
): SmartCategoriesIndex {
  const [id1, id2] = fromIds;
  if (id1 === id2) throw new Error(`fromIds 不能相同: ${id1}`);
  const cat1 = idx.categories.find((c) => c.id === id1);
  const cat2 = idx.categories.find((c) => c.id === id2);
  if (!cat1) throw new Error(`分类 ${id1} 不存在`);
  if (!cat2) throw new Error(`分类 ${id2} 不存在`);
  const merged = newCategory(name, anchorTags);
  merged.groupIds = [...new Set([...cat1.groupIds, ...cat2.groupIds])];
  return {
    ...idx,
    categories: [...idx.categories.filter((c) => c.id !== id1 && c.id !== id2), merged],
  };
}
