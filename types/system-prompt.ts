/**
 * 系统提示词展示段（供设置页展示"用户看不见的那些"隐形段）。
 *
 * 只做模板展示：不抓运行时活跃会话的实际拼接结果，避免新增 IPC 依赖会话状态。
 * 每段列出模板全文 + 触发条件文字说明；含动态占位符（如 `${groupName}`）时 isDynamic=true。
 */

export interface SystemPromptSegment {
  /** 唯一 ID，稳定不变（前端 key 用） */
  key: string;
  /** 展示名（中文） */
  label: string;
  /** 分类，前端可用于分组展示 */
  category: 'reference' | 'group' | 'notes' | 'sub-agent' | 'tool-guide' | 'memory';
  /** 完整模板正文（含占位符如 ${groupName}） */
  template: string;
  /** 什么条件下会被注入（中文，1-3 句话） */
  triggerDescription: string;
  /** template 里是否含运行时占位（前端展示时提示"实际值会替换"） */
  isDynamic: boolean;
}
