/**
 * dogear__RecallMemory 工具的业务逻辑
 *
 * 匹配算法：小写归一化 + 子串匹配（不做中文分词）。
 * 排序：命中关键词数量降序 → 平手按 updated 降序。
 * limit 硬上限 5（防止 agent 滥用占 context）。
 */
import { readIndex } from './memory-indexer.js';
import { getTopic } from './memory-service.js';

const HARD_LIMIT = 5;

export interface RecallResult {
  topics: Array<{
    slug: string;
    title: string;
    content: string;
    updated: string;
  }>;
  /** 有更多未返回主题时的提示 */
  hint?: string;
}

export async function recall(
  workspaceId: string,
  keywords: string[],
  limit: number = 3
): Promise<RecallResult> {
  const effectiveLimit = Math.min(Math.max(1, limit), HARD_LIMIT);
  const normalizedKeywords = keywords
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0);

  if (normalizedKeywords.length === 0) {
    return { topics: [] };
  }

  const index = await readIndex(workspaceId);
  if (index.topics.length === 0) {
    return { topics: [] };
  }

  // 逐条打分
  const scored = index.topics.map((entry) => {
    const haystack = `${entry.title} ${entry.keywords.join(' ')}`.toLowerCase();
    let hits = 0;
    for (const kw of normalizedKeywords) {
      if (haystack.includes(kw)) hits++;
    }
    return { entry, hits };
  });

  const matched = scored
    .filter((s) => s.hits > 0)
    .sort((a, b) => {
      if (b.hits !== a.hits) return b.hits - a.hits;
      return a.entry.updated < b.entry.updated ? 1 : -1;
    });

  const topSlice = matched.slice(0, effectiveLimit);
  const topics: RecallResult['topics'] = [];

  for (const { entry } of topSlice) {
    const topic = await getTopic(workspaceId, entry.slug);
    if (!topic) {
      // index 有但文件不在：跳过并记日志（不自动修复，参考风险表）
      console.warn(`[memory-recall] 索引中的 topic ${entry.slug} 文件缺失，跳过`);
      continue;
    }
    topics.push({
      slug: topic.slug,
      title: topic.title,
      content: topic.content,
      updated: topic.updated,
    });
  }

  const result: RecallResult = { topics };
  const extra = matched.length - topics.length;
  if (extra > 0) {
    result.hint = `还有 ${extra} 个相关主题未返回，可缩小关键词范围或提高 limit（最大 ${HARD_LIMIT}）`;
  }
  return result;
}

