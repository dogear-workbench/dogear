/**
 * 定时计划自定义任务的运行提示词组装（headless 会话链路）。
 *
 * systemPrompt 由 PiSession 标准装配承担（agent.md + skill 索引 + executor 场景段），
 * 这里只产出 user prompt：无人值守纪律与产物落盘约束前置，任务名 + 用户指令本体居中，
 * 末尾要求结果自述——summary 从 assistant 最后一段文本截取，所以要求模型把自述放输出末尾。
 */

export interface CustomAgentPromptPayload {
  taskName: string;
  prompt: string;
}

export function buildCustomAgentPrompt(payload: CustomAgentPromptPayload): string {
  return [
    '你在无人值守的后台会话中执行定时任务：没有用户在线，任何提问、确认请求都不会得到回答。',
    '理解指令后直接执行到底，不询问、不等待确认、不寒暄。',
    '任务产物（报告、笔记、数据文件、记忆等）必须用工具实际写入（Write / Edit / dogear__WriteReport / dogear__SaveMemory 等），只在回复里描述产物而没有落盘视为未完成。',
    '',
    `## 任务：${payload.taskName}`,
    '',
    payload.prompt,
    '',
    '现在直接执行。结束时输出一段不超过 200 字的结果自述：做了什么、产物写到了哪里、是否遇到问题。',
  ].join('\n');
}
