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
5. 调 SaveDigest({ sessionId, title, summary, items, tags }) 落卡（tags 见下方「标签产出」要求）。

完成后直接结束，不要再多说。

## 标签产出（必填）

调用 SaveDigest 时必须同时提供 tags 字段：
- primary: 1 个主标签，自由文本，描述会话主导主题（如 "产品-Dashboard"、"股票-估值"、"代码-重构"）
- secondary: 0–3 个辅标签，覆盖次要主题或方法面
- scores: 给每个标签（含主+辅）打 0–1 的适配度，表示会话与该标签的契合程度
  - 0.8+：会话主要内容就是这个主题
  - 0.5–0.8：明确涉及但非主导
  - 0.5 以下：边角，不必加进 secondary

**归一化**：标签内部用中划线分层（如 "股票-估值-DCF"），不用斜杠 / 空格做分隔。`;

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
