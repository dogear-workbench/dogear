/**
 * Dogear SDK - 主入口
 * 重新导出 @anthropic-ai/claude-agent-sdk 的 query 函数
 */

// 直接从 Claude Agent SDK 导入
export { query } from '@anthropic-ai/claude-agent-sdk';

// 导出常用类型
export type {
  Options,
  Query,
  SDKMessage,
  SDKUserMessage,
  SDKAssistantMessage,
  SDKResultMessage
} from '@anthropic-ai/claude-agent-sdk';

// 版本信息
export const SDK_VERSION = '0.1.0';

/**
 * SDK 初始化(可选)
 */
export function init(_options?: {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}) {
  console.log('Dogear SDK 初始化完成');
}

/**
 * 获取 SDK 信息
 */
export function getInfo() {
  return {
    version: SDK_VERSION,
    name: 'Dogear SDK',
    description: 'Dogear AI SDK'
  };
}
