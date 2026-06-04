// 会话提炼提示词模板（全局单份 <configDir>/digest-prompt.md，决策 H）
import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_DIGEST_PROMPT = `你在为一段开发会话写「会话摘要卡」。只用 CleanTranscript / ReadExistingDigest / SaveDigest 这三个工具，不要用别的工具。

步骤：
1. 调 ReadExistingDigest(sessionId) 看是否已有旧摘要；
2. 调 CleanTranscript(sdkSessionId=该 sessionId) 拿干净逐字稿；
3. 若有旧摘要且逐字稿有新增内容，对比后重写/增补；否则全新提炼；
4. 提炼要求：
   - 概述：用一两句说清「这次会话做了几件事 + 每件事简述」；
   - 条目：抓「决策 / 想法 / 注意 / 搁置」四类要点，每条配一个出处 uuid（取自逐字稿里每段「· 」后面的完整 uuid，别编造）；
   - 只抓真正有信息量的点，宁缺毋滥；
5. 调 SaveDigest({ sessionId, title, summary, items }) 落卡。

完成后直接结束，不要再多说。`;

function getDigestPromptPath(configDir: string): string {
  return path.join(configDir, 'digest-prompt.md');
}

/** 读取提示词模板；缺失则播种 DEFAULT 后返回 */
export async function loadDigestPrompt(configDir: string): Promise<string> {
  const file = getDigestPromptPath(configDir);
  try {
    const raw = await fs.readFile(file, 'utf-8');
    if (raw.trim()) return raw;
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(file, DEFAULT_DIGEST_PROMPT, 'utf-8');
  return DEFAULT_DIGEST_PROMPT;
}

/** 覆盖写入提示词模板 */
export async function saveDigestPrompt(configDir: string, content: string): Promise<void> {
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(getDigestPromptPath(configDir), content, 'utf-8');
}
