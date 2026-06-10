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
    const parsed = JSON.parse(raw) as SmartCategoriesIndex;
    if (!Array.isArray(parsed.categories)) parsed.categories = [];
    if (!Array.isArray(parsed.recentDecisions)) parsed.recentDecisions = [];
    return parsed;
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      mainLogger.warn('[smart-category] readIndex 失败，返回空索引:', err);
    }
    return { categories: [], recentDecisions: [] };
  }
}

export async function writeIndex(wsId: string, idx: SmartCategoriesIndex): Promise<void> {
  await safeJsonWrite(getIndexPath(wsId), idx);
}

// 纯函数：把 conversationId 加进指定分类（去重）
export function pushConversation(cat: SmartCategory, conversationId: string): SmartCategory {
  if (cat.conversationIds.includes(conversationId)) return cat;
  return {
    ...cat,
    conversationIds: [...cat.conversationIds, conversationId],
    updatedAt: new Date().toISOString(),
  };
}

// 纯函数：从所有分类中移除 conversationId
export function removeConversationEverywhere(idx: SmartCategoriesIndex, conversationId: string): SmartCategoriesIndex {
  return {
    ...idx,
    categories: idx.categories.map((c) =>
      c.conversationIds.includes(conversationId)
        ? { ...c, conversationIds: c.conversationIds.filter((x) => x !== conversationId), updatedAt: new Date().toISOString() }
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
  return { id: `cat_${randomUUID().slice(0, 8)}`, name, anchorTags, conversationIds: [], createdAt: now, updatedAt: now };
}
