/**
 * 会话启动时把所属组的概况拼到 systemPrompt 的 append 末尾。
 * 文件清单等详情靠 ListGroupFiles 工具按需读取（避免 prompt 膨胀）。
 */

import * as groupService from '../services/group-service.js';
import { mainLogger } from './logger.js';

const logger = mainLogger.child('group-context-builder');

/**
 * 构建组上下文片段。失败时返回空串而非抛错。
 */
export async function buildGroupContextPrompt(
  workspaceId: string,
  groupId: string,
): Promise<string> {
  try {
    const group = await groupService.getGroup(workspaceId, groupId);
    if (!group) {
      logger.warn(`组未找到，跳过注入: ws=${workspaceId} gid=${groupId}`);
      return '';
    }

    const title = group.title?.trim() || `未命名组（创建于 ${new Date(group.createdAt).toLocaleString('zh-CN')}）`;
    return (
      `## 当前会话组上下文\n` +
      `\n` +
      `**组**：${title}\n` +
      `\n` +
      `遇到不清楚的背景，可以先看看共享区有没有相关文件（ListGroupFiles）。`
    );
  } catch (e) {
    logger.warn('构建组上下文失败，跳过注入:', e);
    return '';
  }
}
