/**
 * Dogear SDK - Agent Query 接口
 * 从 @anthropic-ai/claude-agent-sdk 重新导出 query 函数
 * 并添加 Dogear 特定的配置和类型
 */

import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type {
  Options,
  Query,
  SDKMessage,
  SDKUserMessage,
  SDKAssistantMessage,
  SDKResultMessage
} from '@anthropic-ai/claude-agent-sdk';

// 重新导出 query 函数
export const query = sdkQuery;

// 导出常用的类型
export type {
  Options,
  Query,
  SDKMessage,
  SDKUserMessage,
  SDKAssistantMessage,
  SDKResultMessage
};

/**
 * Dogear 特定的扩展配置
 */
export interface DogearAgentOptions {
  context?: {
    selectedText?: string;
  };
}

export async function createDogearAgent(
  prompt: string,
  dogearOptions?: DogearAgentOptions,
  agentOptions?: any
): Promise<Query> {
  const systemPrompt = dogearOptions?.context?.selectedText
    ? `上下文信息:\n选中文本: ${dogearOptions.context.selectedText}`
    : undefined;

  return query({
    prompt,
    options: {
      ...agentOptions,
      systemPrompt: systemPrompt ? { type: 'text', text: systemPrompt } : agentOptions?.systemPrompt,
    },
  });
}