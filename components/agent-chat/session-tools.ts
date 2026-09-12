/**
 * 会话性质工具（agent↔用户的消息而非工具操作）：在 ContentBlockItem tool_use 分发层
 * 拦截渲染为消息卡，并排除出 groupBlocks 的工具组合并。
 */
export const SESSION_MESSAGE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'dogear__ReportTaskResult',
  'dogear__TrackUserActions',
]);
