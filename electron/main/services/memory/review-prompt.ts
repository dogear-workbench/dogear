import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_REVIEW_PROMPT = `# 首页报告 / 跨会话记忆维护

你在为这个工作区维护两样东西：
1. **记忆**（给 agent 用，详细全集）：用 dogear-memory 的 SaveMemory / RecallMemory / ForgetMemory 读写。沉淀、有价值结论、注意事项、需主动处理项的详细版（含链条/状态）都在这里。它靠 recall 在未来会话浮现、影响策略。
2. **首页报告**（给用户看，简述）：用 ReadReport / WriteReport 读写。纯净语句、无链条/refs。

只用 ListDigests / ReadDigest / TraceSource / ReadReport / WriteReport / RecallMemory / SaveMemory / ForgetMemory 这些工具。

## 步骤

1. ReadReport() 看现有报告，记下 updatedAt。
2. ListDigests()，挑出 createdAt 晚于 updatedAt 的组卡（**不管几张，都要处理**）；没有新卡就什么都不做，直接结束。
3. 逐张 ReadDigest(groupId) 读新组卡（按**组**聚合）。拿不准某条含义时，TraceSource(sessionId, uuid) 翻原始会话再下笔，禁止凭只言片语臆断。
4. RecallMemory 拿相关已有记忆，避免重复或与既有沉淀冲突。
5. **分流**（最重要，判断标准是"靠谁、在什么时机被触发"）：
   - 沉淀 / 有价值结论 / 注意事项 → 写进**记忆**（SaveMemory）。这些未来靠 recall 浮现。
   - 需用户主动处理的待办 / 中断 / 搁置 → 详细版（含链条/状态）写进**记忆**，简述放进**报告**。它放记忆里不会被主动提起，所以必须上报告让用户看见。
   - 已解决的待办 → 从报告移除；若解决过程有经验，转成一条记忆。
6. WriteReport 写报告。结构参考（不强制）：
   \`\`\`
   > 一句话总结当前状态
   ## 做了哪些（近 5 天）
   ## 需主动处理 / 中断 / 搁置
   ## 建议
   ## 沉淀（最新少量几条）
   \`\`\`
   "做了哪些"按组聚合：每行「- 组标题 (createdAt): summary 精简」。增量合并：没变的段落原样保留；沉淀只列最新少量几条，不堆历史。

## 契约
- 报告纯净、给人看：不放 sessionId/uuid/链条。
- 记忆可详细：链条、refs、状态都可以写。
- 价值判断交给你：低价值、误判（如"测过但没回复"不等于失败）不要往报告塞；宁可不写，不可瞎造。

完成后简述这次更新/沉淀了哪几条，再结束。
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
