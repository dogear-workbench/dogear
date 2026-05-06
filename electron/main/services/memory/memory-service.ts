/**
 * 记忆 Service：CRUD 聚合入口（唯一写入入口）
 *
 * - 所有写入走 safe-json 的原子写入 + 文件锁
 * - 每次 upsert / delete / updateCoreProfile 同步触发索引维护
 * - 所有方法第一参数是 workspacePath，不从全局读
 * - 目录不存在时：查询类方法返回 null / []，写入类方法自动创建
 */
import fs from 'node:fs/promises';
import { safeFileWrite } from '../safe-json.js';
import type { CoreProfile, Topic, TopicIndexEntry } from './memory-types.js';
import {
  getCoreProfilePath,
  getTopicPath,
  getTopicsDir,
  parseFrontmatter,
  stringifyFrontmatter,
  type Frontmatter,
} from './memory-fs.js';
import { readIndex, removeIndexEntry, updateIndexEntry } from './memory-indexer.js';

// ─── 核心档案 ───

export async function getCoreProfile(workspacePath: string): Promise<CoreProfile | null> {
  try {
    const raw = await fs.readFile(getCoreProfilePath(workspacePath), 'utf-8');
    const { fm, body } = parseFrontmatter(raw);
    const updated = typeof fm.updated === 'string' ? fm.updated : new Date(0).toISOString();
    return { content: body, updated };
  } catch {
    return null;
  }
}

export async function updateCoreProfile(workspacePath: string, content: string): Promise<void> {
  const now = new Date().toISOString();
  const fm: Frontmatter = { updated: now };
  const body = content.startsWith('\n') ? content : `\n${content}`;
  const raw = stringifyFrontmatter(fm, body);
  await safeFileWrite(getCoreProfilePath(workspacePath), raw);
}

// ─── 主题记忆 ───

export async function listTopics(workspacePath: string): Promise<TopicIndexEntry[]> {
  const index = await readIndex(workspacePath);
  return [...index.topics].sort((a, b) => (a.updated < b.updated ? 1 : -1));
}

export async function getTopic(workspacePath: string, slug: string): Promise<Topic | null> {
  try {
    const raw = await fs.readFile(getTopicPath(workspacePath, slug), 'utf-8');
    return parseTopicFile(slug, raw);
  } catch {
    return null;
  }
}

export async function upsertTopic(
  workspacePath: string,
  data: Omit<Topic, 'created' | 'updated'> & { created?: string; updated?: string }
): Promise<Topic> {
  const now = new Date().toISOString();

  // 读取现有的 created（保留原始创建时间）
  const existing = await getTopic(workspacePath, data.slug);
  const created = data.created ?? existing?.created ?? now;
  const updated = data.updated ?? now;

  const topic: Topic = {
    slug: data.slug,
    title: data.title,
    keywords: data.keywords,
    content: data.content,
    created,
    updated,
    relatedTopics: data.relatedTopics,
    sourceConversations: data.sourceConversations,
  };

  const fm: Frontmatter = {
    title: topic.title,
    slug: topic.slug,
    keywords: topic.keywords,
    created: topic.created,
    updated: topic.updated,
  };
  if (topic.relatedTopics && topic.relatedTopics.length > 0) {
    fm.relatedTopics = topic.relatedTopics;
  }
  if (topic.sourceConversations && topic.sourceConversations.length > 0) {
    fm.sourceConversations = topic.sourceConversations;
  }

  const body = topic.content.startsWith('\n') ? topic.content : `\n${topic.content}`;
  const raw = stringifyFrontmatter(fm, body);
  await safeFileWrite(getTopicPath(workspacePath, topic.slug), raw);

  await updateIndexEntry(workspacePath, {
    slug: topic.slug,
    title: topic.title,
    keywords: topic.keywords,
    updated: topic.updated,
  });

  return topic;
}

export async function deleteTopic(workspacePath: string, slug: string): Promise<void> {
  const filePath = getTopicPath(workspacePath, slug);
  try {
    await fs.unlink(filePath);
  } catch {
    // 文件不存在也继续清理索引
  }
  // 顺带清理 .bak / .tmp（safe-write 留下的）
  for (const suffix of ['.bak', '.tmp']) {
    try { await fs.unlink(filePath + suffix); } catch { /* 忽略 */ }
  }

  await removeIndexEntry(workspacePath, slug);

  // 目录空时不主动清理（留给用户），避免和正在进行的 upsert 竞态
  void getTopicsDir(workspacePath);
}

// ─── 内部工具 ───

function parseTopicFile(slug: string, raw: string): Topic {
  const { fm, body } = parseFrontmatter(raw);
  const keywords = Array.isArray(fm.keywords)
    ? fm.keywords.filter((k): k is string => typeof k === 'string')
    : [];
  const relatedTopics = Array.isArray(fm.relatedTopics)
    ? fm.relatedTopics.filter((k): k is string => typeof k === 'string')
    : undefined;
  const sourceConversations = Array.isArray(fm.sourceConversations)
    ? fm.sourceConversations.filter((k): k is string => typeof k === 'string')
    : undefined;

  return {
    slug: typeof fm.slug === 'string' ? fm.slug : slug,
    title: typeof fm.title === 'string' ? fm.title : slug,
    keywords,
    content: body.replace(/^\n/, ''),
    created: typeof fm.created === 'string' ? fm.created : new Date(0).toISOString(),
    updated: typeof fm.updated === 'string' ? fm.updated : new Date(0).toISOString(),
    relatedTopics,
    sourceConversations,
  };
}
