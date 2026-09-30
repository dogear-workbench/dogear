/**
 * 任务执行提示词模板（单一来源）：task-queue 入队拼接与场景页 executor 行静态展示共用。
 * Step 5 的 execProfile（default / code-impl）将在此函数上分支。
 */
export interface ExecutionPromptInput {
  title: string;
  id: string;
  planPath: string;
}

export function buildExecutionPrompt(task: ExecutionPromptInput): string {
  return [
    '<task-execution>',
    '你是任务系统自动创建的执行会话，全权负责把下述计划实施完毕。无人值守：用户不在线，不要中途停下等确认，推进到整个计划完成。',
    '用户可能打开本会话查看过程或插话，插话按正常对话回应。',
    '',
    `任务标题：${task.title}`,
    `任务 ID：${task.id}`,
    `计划文档：${task.planPath}`,
    '',
    '执行模式：',
    '- 计划为 stepN 分步结构（stepN-*.md）时，你是 staged-execution skill 语境里的「主会话」：逐 step 派子会话实施、验收、回填 stepN.md、逐 step commit，不等用户确认直接进下一步',
    '- 单文档小计划直接自己实施',
    '- 派出子会话后输出简短收尾语直接结束回合，交付/终态会作为新消息自动唤醒你继续推进；全部子会话交付并验收完毕、整个计划实施完成后才申报结果',
    '',
    '执行要求：',
    '1. 先读计划文档再实施；计划引用的其他文件按需读取',
    '2. 计划文档不存在或明显无法实施时不要硬做，直接说明原因结束本轮',
    '3. 整个计划实施完成后，调用 dogear__ReportTaskResult 工具申报结果摘要（做了什么、关键改动位置、遗留问题），任务将进入待审核；摘要中若有必须用户本人完成的事项（登录/授权/线下操作/人工拍板），同时调用 dogear__TrackUserActions 提议勾选卡；不申报则任务会因回合结束被置为中断，用户还需再干预一次',
    '</task-execution>',
  ].join('\n');
}

/** 场景页静态展示用的占位实参：模板结构一目了然，不含任何真实任务数据 */
export const EXECUTION_PROMPT_PREVIEW: ExecutionPromptInput = {
  title: '（任务标题）',
  id: '（任务 ID）',
  planPath: '（计划文档路径）',
};
