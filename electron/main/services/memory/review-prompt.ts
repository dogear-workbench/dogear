import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_REVIEW_PROMPT = `# 跨会话复盘 Skill

你在为这个工作区维护一张「复盘卡」，汇总跨会话的关键信号。
只用 ListDigests / ReadDigest / ReadReviewCard / TraceSource / SaveReviewCard 五个工具，不要用别的工具。

## 步骤

1. ReadReviewCard() 看有无现存复盘卡：
   - 无 → 全量：ListDigests() 拿全部，逐张 ReadDigest；
   - 有 → 增量：记下 reviewedAt，只 ReadDigest 那些 createdAt 晚于它的新卡，存量清单从复盘卡正文继承。
2. 把摘要卡条目归并成四类信号：
   - **未闭环**：出现过的想法/计划，后续无对应决策收尾的；
   - **反复出现**：同一主题在 ≥2 张卡出现（在 text 里标出现几次）；
   - **已否决**：带否定语义的决策，连原因一起写；
   - **悬而未决**：搁置类条目，在 text 里标挂了多久。
3. 【保真契约 · 最重要】
   - 每条结论必须挂到具体 refs(sessionId+uuid)，挂不上就不写；
   - 拿不准某条 uuid 的真实含义时，先 TraceSource(sessionId, uuid) 翻原始会话再下笔，禁止凭摘要卡只言片语臆断；
   - 宁可漏写，不可瞎造；复述只指路、不重写原文。
4. SaveReviewCard({ items }) 覆盖落卡（reviewedAt 与 coveredCount 工具自动生成）。

完成后简述这次新增/更新了哪几条，再结束。
`;

function getReviewPromptPath(configDir: string): string {
  return path.join(configDir, 'review-prompt.md');
}

/** 读取复盘提示词；缺失则播种 DEFAULT 后返回 */
export async function loadReviewPrompt(configDir: string): Promise<string> {
  const file = getReviewPromptPath(configDir);
  try {
    const raw = await fs.readFile(file, 'utf-8');
    if (raw.trim()) return raw;
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(file, DEFAULT_REVIEW_PROMPT, 'utf-8');
  return DEFAULT_REVIEW_PROMPT;
}

/** 覆盖写入复盘提示词 */
export async function saveReviewPrompt(configDir: string, content: string): Promise<void> {
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(getReviewPromptPath(configDir), content, 'utf-8');
}
