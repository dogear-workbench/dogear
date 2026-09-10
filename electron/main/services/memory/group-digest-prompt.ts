// 组 digest 提示词模板（全局单份 <configDir>/group-digest-prompt.md，Phase 3）
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * 磁盘上老提示词仍含 dogear__SaveGroupBackground 指令（该工具已随状态卡方案移除，留着会导致 agent 调不存在的工具），
 * 用它当"过期特征"判定去覆盖播种一次。语义再变时同步这个哨兵。
 */
const STALE_SAVE_BACKGROUND_SENTINEL = 'dogear__SaveGroupBackground';
const TITLE_SYNC_SENTINEL = '同步为话题组的显示名称';

// 旧版默认模板里「ListGroupFiles 返回全部内容」的说法在新工具行为下已不成立，命中即重播种
const LEGACY_LIST_FULL_CONTENT = '返回结果含每个文件的完整内容';

export const DEFAULT_GROUP_DIGEST_PROMPT = `你在为一个**会话组**写「组级摘要卡」。一个组通常由多个相关会话组成。

工具：dogear__ReadGroupDigest / dogear__CleanTranscript / dogear__SaveGroupDigest / dogear__ListGroupFiles（仅这些）

步骤：
1. 调 dogear__ReadGroupDigest(groupId) 看是否已有组卡，作为整合基础。
2. 对每个 dirty 会话调 dogear__CleanTranscript(sessionId) 拿干净逐字稿。**未在 dirty 列表中的会话不需要重读**——它们的信息已在已有组卡里。
3. 调 dogear__ListGroupFiles 列共享区文件清单，对需要的文件传 relPath 读取完整内容；**优先利用** \`_notes/\` 子目录下用户和 agent 主动留下的阶段总结。dogear__CleanTranscript 输出作为补充/校验。
4. 调 dogear__SaveGroupDigest({ groupId, title, summary, items, keyOutputs, tags })：
   - title：组的整体主题（一短句）。此 title 会同步为话题组的显示名称，要简短准确。复用现有 title 若仍准确
   - summary：一两句，"这组讨论的核心 + 几条主线"
   - items：决策 / 想法 / 注意 / 搁置 四类，每条带 sources 数组（来自哪些 sessionId + uuid，可多源）
   - keyOutputs：共享区里有价值的产出文件（path + 一句话说明 + 出处 sessionId 可选）
   - tags（**必填**）：1 主 + 0~3 辅 + 0~1 适配度，覆盖整组主题。缺 tags 的组卡不会进入智能分类流程，任何情况下都要提供
   - sourcesSeen 由工具自动维护，你无需提供

保存成功后直接结束。

## 写作要点
- 已有组卡 + dirty 会话是增量输入。已覆盖的旧内容不要丢，但要按新会话刷新认知。
- items.sources 的 uuid 必须**逐字复制** dogear__CleanTranscript 输出中 \`## [role · ts · uuid]\` 第三段的完整字符串，不得凭记忆重构或编造。dogear__SaveGroupDigest 落盘前会自动校验每个 uuid 是否真实存在于对应会话，校验不通过会拒绝保存并列出哪条有问题及修复方法。
- 不要复述共享文件正文；只写 path + 一句话定位。
- 标签内部用中划线分层（如 "产品-Dashboard"），不用斜杠/空格。

## 打 tag 的词汇选择
系统会在你的上下文里附上当前工作区的**分类词汇表**（若有）。打 tag 时优先从中选择贴合的词——这样组卡能被快速归类，不用每次都跑分类决策。
实在没合适的（比如首次讨论新主题）才自造 tag。

词汇表按 \`分类名: [tag1, tag2, ...]\` 一行一分类展示，你不需要精确匹配某个分类，也不需要照抄——它是启发式的选词参考。
`;

function getGroupDigestPromptPath(configDir: string): string {
  return path.join(configDir, 'group-digest-prompt.md');
}

/**
 * 读取提示词模板；缺失或命中过期哨兵（旧工具指令 / 旧说法）则重播种 DEFAULT。
 */
export async function loadGroupDigestPrompt(configDir: string): Promise<string> {
  const file = getGroupDigestPromptPath(configDir);
  try {
    const raw = await fs.readFile(file, 'utf-8');
    const stale = raw.includes(LEGACY_LIST_FULL_CONTENT) || raw.includes(STALE_SAVE_BACKGROUND_SENTINEL);
    if (raw.trim() && !stale && !raw.includes('ReadGroupFile') && raw.includes(TITLE_SYNC_SENTINEL)) return raw;
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
