/**
 * 记忆索引维护
 *
 * index.json 的读写、单条 upsert/remove、全量 rebuild 和一致性检查。
 * 所有写入经 safeJsonWrite 保证原子性。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { safeJsonWrite, safeJsonRead } from '../safe-json.js';
import type { MemoryIndex, MemoryScope, TopicIndexEntry } from './memory-types.js';
import { getTopicsDir, readTopicFrontmatter, resolveIndexPath, resolveTopicsDir } from './memory-fs.js';

const EMPTY_INDEX: MemoryIndex = {
  version: 1,
  updated: new Date(0).toISOString(),
  topics: [],
};

/** 读取索引（不存在返回空索引） */
export async function readIndex(
  workspaceId: string,
  scope: MemoryScope = 'workspace'
): Promise<MemoryIndex> {
  const data = await safeJsonRead<MemoryIndex | null>(resolveIndexPath(scope, workspaceId), null);
  if (!data || data.version !== 1 || !Array.isArray(data.topics)) {
    // topics 必须新数组：EMPTY_INDEX 是模块级共享对象，浅拷贝会让 updateIndexEntry 的 push 污染后续所有空索引读取
    return { ...EMPTY_INDEX, topics: [] };
  }
  return data;
}

async function writeIndex(
  workspaceId: string,
  index: MemoryIndex,
  scope: MemoryScope = 'workspace'
): Promise<void> {
  await safeJsonWrite(resolveIndexPath(scope, workspaceId), index);
}

/** 单条 upsert（upsertTopic 时调用） */
export async function updateIndexEntry(
  workspaceId: string,
  entry: TopicIndexEntry,
  scope: MemoryScope = 'workspace'
): Promise<void> {
  const index = await readIndex(workspaceId, scope);
  const existing = index.topics.findIndex((t) => t.slug === entry.slug);
  if (existing >= 0) {
    index.topics[existing] = entry;
  } else {
    index.topics.push(entry);
  }
  index.updated = new Date().toISOString();
  await writeIndex(workspaceId, index, scope);
}

/** 单条删除（deleteTopic 时调用） */
export async function removeIndexEntry(
  workspaceId: string,
  slug: string,
  scope: MemoryScope = 'workspace'
): Promise<void> {
  const index = await readIndex(workspaceId, scope);
  const next = index.topics.filter((t) => t.slug !== slug);
  if (next.length === index.topics.length) {
    // 没变动，仍然写回以刷新 updated（但忽略）
    return;
  }
  index.topics = next;
  index.updated = new Date().toISOString();
  await writeIndex(workspaceId, index, scope);
}

/** 重建索引（扫描 topics/*.md，重写 index.json） */
export async function rebuildIndex(
  workspaceId: string,
  scope: MemoryScope = 'workspace'
): Promise<MemoryIndex> {
  const topicsDir = resolveTopicsDir(scope, workspaceId);
  const entries: TopicIndexEntry[] = [];

  let files: string[] = [];
  try {
    files = await fs.readdir(topicsDir);
  } catch {
    // 目录不存在 → 索引为空
  }

  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const slug = file.slice(0, -3);
    try {
      const fm = await readTopicFrontmatter(path.join(topicsDir, file));
      entries.push({
        slug,
        title: typeof fm.title === 'string' ? fm.title : slug,
        keywords: Array.isArray(fm.keywords)
          ? fm.keywords.filter((k): k is string => typeof k === 'string')
          : [],
        updated: typeof fm.updated === 'string' ? fm.updated : new Date(0).toISOString(),
      });
    } catch (err) {
      console.warn(`[memory-indexer] 解析 ${file} 失败，跳过:`, err);
    }
  }

  const index: MemoryIndex = {
    version: 1,
    updated: new Date().toISOString(),
    topics: entries,
  };
  await writeIndex(workspaceId, index, scope);
  return index;
}

/**
 * 一致性检查：索引声明的文件是否都存在；返回孤儿 slug 和 index 里缺失的 slug。
 * 只报告，不自动修复。
 */
export async function checkConsistency(workspaceId: string): Promise<{
  orphansInIndex: string[];
  orphansOnDisk: string[];
}> {
  const index = await readIndex(workspaceId);
  const topicsDir = getTopicsDir(workspaceId);

  let diskSlugs: string[] = [];
  try {
    const files = await fs.readdir(topicsDir);
    diskSlugs = files.filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
  } catch {
    // 目录不存在
  }

  const indexSlugs = new Set(index.topics.map((t) => t.slug));
  const diskSet = new Set(diskSlugs);

  const orphansInIndex = index.topics
    .filter((t) => !diskSet.has(t.slug))
    .map((t) => t.slug);
  const orphansOnDisk = diskSlugs.filter((s) => !indexSlugs.has(s));

  return { orphansInIndex, orphansOnDisk };
}
