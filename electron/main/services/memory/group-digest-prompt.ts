// 组 digest 提示词模板（全局单份 <configDir>/group-digest-prompt.md，Phase 3）
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * 磁盘上老提示词无 SaveGroupBackground 指令时，用它当"缺失特征"判定去覆盖播种一次。
 * 换指令名或语义调整时也要同步这个哨兵。
 */
const SAVE_BACKGROUND_SENTINEL = 'SaveGroupBackground';

export const DEFAULT_GROUP_DIGEST_PROMPT = `你在为一个**会话组**写两个产物：「组级摘要卡」+「组背景」。一个组通常由多个相关会话组成。

工具：ReadGroupDigest / CleanTranscript / SaveGroupDigest / SaveGroupBackground / ListGroupFiles（仅这些）

步骤：
1. 调 ReadGroupDigest(groupId) 看是否已有组卡，作为整合基础。
2. 对每个 dirty 会话调 CleanTranscript(sessionId) 拿干净逐字稿。**未在 dirty 列表中的会话不需要重读**——它们的信息已在已有组卡里。
3. 调 ListGroupFiles 看共享区（返回结果含每个文件的完整内容）；**优先利用** \`_notes/\` 子目录下用户和 agent 主动留下的阶段总结。CleanTranscript 输出作为补充/校验。
4. 产物一：**组卡**（写给人 + 首页复盘用）。调 SaveGroupDigest({ groupId, title, summary, items, keyOutputs, tags })：
   - title：组的整体主题（一短句，复用现有 title 若仍准确）
   - summary：一两句，"这组讨论的核心 + 几条主线"
   - items：决策 / 想法 / 注意 / 搁置 四类，每条带 sources 数组（来自哪些 sessionId + uuid，可多源）
   - keyOutputs：共享区里有价值的产出文件（path + 一句话说明 + 出处 sessionId 可选）
   - tags：1 主 + 0~3 辅 + 0~1 适配度，覆盖整组主题
   - sourcesSeen 由工具自动维护，你无需提供
5. 产物二：**组背景** background.md（写给下一个新会话的 agent 读，帮它快速续上）。**紧接着**调 SaveGroupBackground({ groupId, topic, progress, keyDecisions, openQuestions })：
   - topic：一句话组主题（可复用组卡的 title）
   - progress：2-3 句自然语言，说"当前进展到哪、正在做什么"
   - keyDecisions：**已拍板不该重议**的决策列表（数组，每条一句话；避免下个新会话 agent 重复讨论已定的事）
   - openQuestions：未决 / 搁置的问题列表（数组，每条一句话；下个会话可以从这里接着往下推）
   - 关键：background 是给"从零起步的新会话 agent 看的目录页"，不是复盘。别写历史线索、别写"上次讨论了什么"，只写**当前状态 + 已定 + 未定**

完成两次保存后直接结束。若 SaveGroupBackground 失败也不影响组卡（两者独立保存）。

## 写作要点
- 已有组卡 + dirty 会话是增量输入。已覆盖的旧内容不要丢，但要按新会话刷新认知。
- items.sources 的 uuid 必须**逐字复制** CleanTranscript 输出中 \`## [role · ts · uuid]\` 第三段的完整字符串，不得凭记忆重构或编造。SaveGroupDigest 落盘前会自动校验每个 uuid 是否真实存在于对应会话，校验不通过会拒绝保存并列出哪条有问题及修复方法。
- 不要复述共享文件正文；只写 path + 一句话定位。
- 标签内部用中划线分层（如 "产品-Dashboard"），不用斜杠/空格。
- background 的 keyDecisions 和 openQuestions 不该有交集——已定的进 keyDecisions，未定 / 搁置的进 openQuestions。

## 打 tag 的词汇选择
系统会在你的上下文里附上当前工作区的**分类词汇表**（若有）。打 tag 时优先从中选择贴合的词——这样组卡能被快速归类，不用每次都跑分类决策。
实在没合适的（比如首次讨论新主题）才自造 tag。

词汇表按 \`分类名: [tag1, tag2, ...]\` 一行一分类展示，你不需要精确匹配某个分类，也不需要照抄——它是启发式的选词参考。
`;

function getGroupDigestPromptPath(configDir: string): string {
  return path.join(configDir, 'group-digest-prompt.md');
}

/**
 * 读取提示词模板；缺失或明显是旧版（不含 SaveGroupBackground 指令）则播种 DEFAULT。
 * 覆盖播种是 Phase 4 引入 background.md 时的一次性升级，避免旧模板缺工具指令导致 agent 不写 background
 */
export async function loadGroupDigestPrompt(configDir: string): Promise<string> {
  const file = getGroupDigestPromptPath(configDir);
  try {
    const raw = await fs.readFile(file, 'utf-8');
    if (raw.trim() && raw.includes(SAVE_BACKGROUND_SENTINEL) && !raw.includes('ReadGroupFile')) return raw;
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
