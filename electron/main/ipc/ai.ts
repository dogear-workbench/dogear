/**
 * AI 相关 IPC 处理器
 * 处理 AI 对话和文本摘要相关的 IPC 请求
 */

import { ipcMain } from 'electron';
import * as aiService from '../services/ai-service.js';

/**
 * 注册所有 AI 相关的 IPC 处理器
 */
export function registerAIHandlers() {
  /**
   * AI 对话接口
   */
  ipcMain.handle('ai:chat', async (_, messages) => {
    return aiService.chat(messages);
  });

  /**
   * AI 文本摘要接口
   */
  ipcMain.handle('ai:summarize', async (_, text: string) => {
    return aiService.summarize(text);
  });
}
