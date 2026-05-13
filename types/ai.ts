/**
 * AI 相关类型定义
 * 包含 AI 交互记录、消息格式等
 */

/**
 * AI 交互记录接口
 * 定义 AI 交互记录的数据结构,与数据库表结构对应
 */
export interface AIInteraction {
  id?: string;                // 交互记录唯一标识(UUID)
  type: 'chat' | 'summarize' | 'qna';  // 交互类型:对话/摘要/问答
  user_message?: string;      // 用户的消息
  ai_response: string;        // AI 的回复
  context_text?: string;      // 上下文文本(从书中提取的相关内容)
  model_info?: string;        // 模型信息(使用的 AI 模型名称及参数)
  created_at?: string;        // 交互时间
}

/**
 * AI 消息接口
 */
export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}
