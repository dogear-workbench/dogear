// 话题状态卡增量抽取提示词模板（全局单份 <configDir>/state-extract-prompt.md）
import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_STATE_EXTRACT_PROMPT = `你在做会话组的「话题状态增量抽取」：读完本次给你的新增逐字稿后，调用 emit_state_increment 工具一次性输出结构化增量，不要输出散文。

## 抽取原则

- 只抽**已确立的事实**：已经做完的事、已拍板的决策、当前遇到的阻碍、已确认的下一步、悬而未决的问题。
- 「建议过 / 打算做 / 计划考虑 X」不等于 completed。completed 只给明确完成的事；进行中的事放 inProgress，文本里写清进度到哪。
- 拿不准就不抽——漏抽无害（下轮还会再抽），错抽会污染状态卡。
- 条目 text 要自含、一句话说清，不写「如上」「同刚才」这类指代。

## 话题变更（topicChange）

- 只有当本次逐字稿显示话题组讨论焦点发生了迁移才输出 topicChange。
- 你自己根据内容推断的变更：text 照写，**省略 quote**（会进入待确认队列，由用户裁决）。
- 有用户原话直接确立新话题：quote 必须逐字摘录该用户消息里的一句话，uuid 填那条消息的 entry id（这样变更直接生效）。
- 话题没变就不输出 topicChange 字段。

## 保真约束

- 每条条目的 uuid 必须从下方逐字稿的 \`## [role · ts · uuid]\` 头部第三段逐字复制，禁止编造或凭记忆重构。工具会校验 uuid 与 resolved id，不合法会被拒绝，按报错修正后重新调用。
- resolved 只能引用下方「本组现有条目」列表中列出的 id，用于声明某个进行中条目已经完成；列表里没有的 id 不要编。

## 输出格式

调用一次 emit_state_increment，字段：
- topicChange（可选）：{ text, quote?, uuid? }
- completed / inProgress / decisions / blockers / nextSteps / openQuestions：各为 [{ text, uuid }] 数组
- resolved：string[]（被完成的现有条目 id）
无内容的类别给空数组或省略该字段。
`;

function getStateExtractPromptPath(configDir: string): string {
  return path.join(configDir, 'state-extract-prompt.md');
}

/** 读取提示词模板；缺失或为空白则播种 DEFAULT 后返回 */
export async function loadStateExtractPrompt(configDir: string): Promise<string> {
  const file = getStateExtractPromptPath(configDir);
  try {
    const raw = await fs.readFile(file, 'utf-8');
    if (raw.trim()) return raw;
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(file, DEFAULT_STATE_EXTRACT_PROMPT, 'utf-8');
  return DEFAULT_STATE_EXTRACT_PROMPT;
}
