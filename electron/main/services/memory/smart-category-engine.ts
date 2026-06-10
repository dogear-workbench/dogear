import type { DigestTags, SmartCategory } from '../../types.js';

// Step A: 纯阈值匹配
// 返回所有 score >= threshold 的分类 id 列表（按 score 倒序）
export function matchByThreshold(
  tags: DigestTags,
  categories: SmartCategory[],
  threshold: number
): Array<{ categoryId: string; score: number }> {
  const allTags = [...new Set([tags.primary, ...tags.secondary])];
  const results = categories.map((c) => {
    let score = 0;
    for (const t of allTags) {
      if (c.anchorTags.includes(t)) {
        score += tags.scores[t] ?? 0;
      }
    }
    return { categoryId: c.id, score };
  });
  return results.filter((r) => r.score >= threshold).sort((a, b) => b.score - a.score);
}

// Step C: 召回受影响候选名单
// 找出与 newAnchorTags 有重叠的老分类（最多 2 个，按重叠数倒序）
// 每个老分类返回其全部 conversationIds；trigger 处再按"标签重叠 + 适配度低"截断到 10 条
export function pickRedistributeCandidates(
  categories: SmartCategory[],
  newAnchorTags: string[],
): Array<{ categoryId: string; conversationIds: string[] }> {
  const neighbors = categories
    .map((c) => ({ cat: c, overlap: c.anchorTags.filter((t) => newAnchorTags.includes(t)).length }))
    .filter((x) => x.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || a.cat.id.localeCompare(b.cat.id))
    .slice(0, 2);

  return neighbors.map(({ cat }) => ({
    categoryId: cat.id,
    conversationIds: cat.conversationIds,
  }));
}

// 标签归一化（trim、空格/斜杠 → 中划线、合并多余中划线、剥前后缀 dash）
export function normalizeTag(tag: string): string {
  return tag
    .trim()
    .replace(/[/\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// 把 DigestTags 整个归一化（写入摘要卡前调一次，保证一致性）
// scores 冲突时保留较大分数；过滤空标签
export function normalizeTags(tags: DigestTags): DigestTags {
  const remap = (t: string) => normalizeTag(t);
  const scores: Record<string, number> = {};
  for (const [k, v] of Object.entries(tags.scores)) {
    const nk = remap(k);
    if (!nk) continue; // 过滤空标签
    scores[nk] = Math.max(scores[nk] ?? 0, v); // 冲突保留较大分数
  }
  return {
    primary: remap(tags.primary),
    secondary: tags.secondary.map(remap).filter((t) => t.length > 0),
    scores,
  };
}
