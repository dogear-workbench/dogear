/**
 * 跨会话复盘 Skill 目录管理（里程碑 2 Phase B）
 *
 * 在 <configDir>/skills/review/ 下幂等初始化 SKILL.md（SDK local plugin 入口）。
 * 由 query-based-session 作为 local plugin 加载，配合 dogear-memory-review MCP 工具使用。
 */
import path from 'path';
import fs from 'fs/promises';
import electron from 'electron';

const { app } = electron;

function getConfigDir(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), '.dogear');
  }
  return path.join(process.cwd(), '.dogear');
}

/** 返回复盘 Skill 目录的绝对路径 */
export function getReviewSkillDir(): string {
  return path.join(getConfigDir(), 'skills', 'review');
}

const SKILL_MD = `---
name: cross-session-review
description: 当用户要求复盘、回顾跨会话进展、串一下做过什么、看哪些思路没落实/搁置时使用。综合本工作区所有会话摘要卡，产出或更新一张「复盘卡」。
---

# 跨会话复盘 Skill

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

/**
 * 确保复盘 Skill 目录与 SKILL.md 存在。
 * 幂等：文件已存在则不覆盖（用户可能已改）。启动时调用一次，错误不应阻塞启动。
 */
export async function ensureReviewSkillInitialized(): Promise<void> {
  const skillDir = getReviewSkillDir();
  await fs.mkdir(skillDir, { recursive: true });
  const skillPath = path.join(skillDir, 'SKILL.md');
  try {
    await fs.access(skillPath);
  } catch {
    await fs.writeFile(skillPath, SKILL_MD, 'utf-8');
  }
}
