/**
 * 主题相似度算法（SaveMemory 写入查重与体检重复对检测共用）
 *
 * slug 按 '-' 分词做 token Dice，关键词与标题做字符 bigram Dice，三者取最大值；
 * 阈值 0.5：bun-test vs bun-test-config = 0.8 命中，无关主题通常 < 0.3。
 */

export interface TopicLike {
  slug: string;
  title: string;
  keywords: string[];
}

export const TOPIC_SIMILARITY_THRESHOLD = 0.5;

export function diceCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const t of a) if (b.has(t)) overlap++;
  return (2 * overlap) / (a.size + b.size);
}

export function normalizeForSimilarity(s: string): string {
  return s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

/** 字符 bigram Dice：对中文短句（无分词）也能算出稳定相似度 */
export function bigramDice(a: string, b: string): number {
  const na = normalizeForSimilarity(a);
  const nb = normalizeForSimilarity(b);
  if (na.length < 2 || nb.length < 2) return na === nb && na.length > 0 ? 1 : 0;
  const gramsOf = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = gramsOf(na);
  const gb = gramsOf(nb);
  let overlap = 0;
  let total = 0;
  for (const c of ga.values()) total += c;
  for (const [g, c] of gb) {
    total += c;
    const ca = ga.get(g);
    if (ca) overlap += Math.min(ca, c);
  }
  return (2 * overlap) / total;
}

export function topicSimilarity(a: TopicLike, b: TopicLike): number {
  const slugDice = diceCoefficient(
    new Set(a.slug.split('-').filter(Boolean)),
    new Set(b.slug.split('-').filter(Boolean)),
  );
  const kwDice = diceCoefficient(
    new Set(a.keywords.map((k) => k.toLowerCase())),
    new Set(b.keywords.map((k) => k.toLowerCase())),
  );
  return Math.max(slugDice, kwDice, bigramDice(a.title, b.title));
}

export function isSimilarTopic(a: TopicLike, b: TopicLike): boolean {
  if (a.slug === b.slug) return false;
  return topicSimilarity(a, b) >= TOPIC_SIMILARITY_THRESHOLD;
}
