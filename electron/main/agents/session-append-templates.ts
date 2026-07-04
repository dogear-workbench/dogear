/**
 * 会话系统提示词的「系统级 append 段」模板。
 *
 * 这些不是用户可编辑的提示词，也不是人设——是根据会话所处的组上下文，
 * 在会话启动时动态拼接、告诉主 agent 如何优雅地引用历史会话 / 组背景。
 *
 * 关联：Step 4 装到子会话的 dogear-reference 工具（ReadReferenceSession /
 * ReadGroupBackground / ListSiblingSessions），主 agent 通过 DelegateTo
 * 派子会话来间接使用它们，避免污染主上下文。
 */

/** 通用引用会话提示（组内会话默认加，主 agent 侧）。 */
export const REFERENCE_APPEND =
  '\n## 引用历史会话\n' +
  '如需引用某个具体历史会话的内容作为参考，用 DelegateTo 派子会话去消化并交回摘要。\n' +
  '子会话有 ReadReferenceSession 工具能读任意 SDK 会话的去噪原文，会分析后只回给你精炼版本。\n' +
  '**不要自己直接读会话原文** —— 那会污染你的上下文。';

/**
 * 组背景提示（组内非首个主会话追加，主 agent 侧）。
 * groupName 已做基础转义（不允许 backtick 破坏 markdown 结构）。
 */
export function groupAppendFor(groupName: string): string {
  const safeName = groupName.replace(/`/g, "'");
  return (
    '\n## 当前会话组\n' +
    `你处在会话组「${safeName}」内，该组已有其他兄弟会话。\n` +
    '需要了解组之前的进展 / 结论 / 待办、或某个兄弟会话最近动向时，用 DelegateTo 派子会话去梳理。\n' +
    '子会话有这些专用工具：\n' +
    '- ReadGroupBackground：读本组结构化背景（topic / progress / keyDecisions / openQuestions）\n' +
    '- ListSiblingSessions：列本组其他兄弟会话（含活跃状态 / 是否已被组卡收录）\n' +
    '- ReadGroupDigest：读本组的组级摘要卡（items / keyOutputs / tags）\n' +
    '- ReadReferenceSession：读任意兄弟会话的去噪原文\n' +
    '**都是子会话独占**——你自己没有这些工具，只能派子会话，等它 SubmitDelivery 交摘要回来。'
  );
}
