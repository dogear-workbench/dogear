// 组 digest 提示词模板（全局单份 <configDir>/group-digest-prompt.md，Phase 3）
import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_GROUP_DIGEST_PROMPT = `你在为一个**会话组**写「组级摘要卡」。一个组通常由多个相关会话组成，你的任务是把它们整合为一份连贯的摘要。

工具：ReadGroupDigest / CleanTranscript / SaveGroupDigest / ListGroupFiles / ReadGroupFile（仅这些）

步骤：
1. 调 ReadGroupDigest(groupId) 看是否已有组卡，作为整合基础。
2. 对每个 dirty 会话调 CleanTranscript(sdkSessionId) 拿干净逐字稿。**未在 dirty 列表中的会话不需要重读**——它们的信息已在已有组卡里。
3. 调 ListGroupFiles 看共享区；**优先利用** \`_notes/\` 子目录下用户和 agent 主动留下的阶段总结（ReadGroupFile 读关键 note）。CleanTranscript 输出作为补充/校验。
4. 整合产出：
   - title：组的整体主题（一短句，复用现有 title 若仍准确）
   - summary：一两句，"这组讨论的核心 + 几条主线"
   - items：决策 / 想法 / 注意 / 搁置 四类，每条带 sources 数组（来自哪些 sessionId + uuid，可多源）
   - keyOutputs：共享区里有价值的产出文件（path + 一句话说明 + 出处 sessionId 可选）
   - tags：1 主 + 0~3 辅 + 0~1 适配度，覆盖整组主题
5. 调 SaveGroupDigest({ groupId, title, summary, items, keyOutputs, tags }) 落卡。sourcesSeen 由工具自动维护，你无需提供。

完成后直接结束。

## 写作要点
- 已有组卡 + dirty 会话是增量输入。已覆盖的旧内容不要丢，但要按新会话刷新认知。
- items.sources 必须真实——uuid 取自逐字稿"· "后的完整 uuid，不要编造。
- 不要复述共享文件正文；只写 path + 一句话定位。
- 标签内部用中划线分层（如 "产品-Dashboard"），不用斜杠/空格。
`;

function getGroupDigestPromptPath(configDir: string): string {
  return path.join(configDir, 'group-digest-prompt.md');
}

/** 读取提示词模板；缺失则播种 DEFAULT 后返回 */
export async function loadGroupDigestPrompt(configDir: string): Promise<string> {
  const file = getGroupDigestPromptPath(configDir);
  try {
    const raw = await fs.readFile(file, 'utf-8');
    if (raw.trim()) return raw;
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(file, DEFAULT_GROUP_DIGEST_PROMPT, 'utf-8');
  return DEFAULT_GROUP_DIGEST_PROMPT;
}

/** 覆盖写入提示词模板 */
export async function saveGroupDigestPrompt(configDir: string, content: string): Promise<void> {
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(getGroupDigestPromptPath(configDir), content, 'utf-8');
}
