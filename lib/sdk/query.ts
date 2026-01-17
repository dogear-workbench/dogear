/**
 * Dogear SDK - Agent Query 接口
 * 从 @anthropic-ai/claude-agent-sdk 重新导出 query 函数
 * 并添加 Dogear 特定的配置和类型
 */

// 从 Claude Agent SDK 导入核心功能
export { query } from '@anthropic-ai/claude-agent-sdk';

// 导出常用的类型
export type {
  Options,
  Query,
  SDKMessage,
  SDKUserMessage,
  SDKAssistantMessage,
  SDKResultMessage
} from '@anthropic-ai/claude-agent-sdk';

/**
 * Dogear 特定的扩展配置
 */
export interface DogearAgentOptions {
  // 可以在这里添加 Dogear 特定的配置项
  // 例如:书籍上下文、章节信息等
  context?: {
    bookId?: string;
    chapterId?: string;
    selectedText?: string;
  };
}

/**
 * 创建带 Dogear 上下文的 Agent 查询
 * 这是一个便捷函数,用于在 Dogear 应用中使用 Agent SDK
 */
export function createDogearAgent(
  prompt: string,
  dogearOptions?: DogearAgentOptions,
  agentOptions?: Parameters<typeof query>[0]['options']
): Promise<Query> {
  // TODO: 将 Dogear 上下文注入到 system prompt 中
  const systemPrompt = dogearOptions?.context
    ? `上下文信息:
书籍ID: ${dogearOptions.context.bookId || '未指定'}
章节ID: ${dogearOptions.context.chapterId || '未指定'}
选中文本: ${dogearOptions.context.selectedText || '无'}`
    : undefined;

  return query({
    prompt,
    options: {
      ...agentOptions,
      systemPrompt: systemPrompt ? {
        type: 'text',
        text: systemPrompt
      } : agentOptions?.systemPrompt
    }
  });
}