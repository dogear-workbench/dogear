/**
 * 会话启动时把所属组的概况 + 共享区文件清单
 * 拼到 systemPrompt 的 append 末尾，让 Agent 天然知道组里有什么。
 * 详情靠 ListGroupFiles / ReadGroupFile 工具按需读取（避免 prompt 膨胀）。
 */

import * as groupService from '../services/group-service.js';
import * as groupSharedService from '../services/group-shared-service.js';
import { mainLogger } from './logger.js';

const logger = mainLogger.child('group-context-builder');

const MAX_FILES_LISTED = 20;
const MAX_PATH_LENGTH = 80;
const TARGET_TOKEN_BUDGET = 500;  // 粗估 chars/4

function truncatePath(p: string): string {
  if (p.length <= MAX_PATH_LENGTH) return p;
  return '…' + p.slice(-(MAX_PATH_LENGTH - 1));
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatRelativeTime(mtime: number): string {
  const diffMs = Date.now() - mtime;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min}分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}小时前`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}天前`;
  return new Date(mtime).toLocaleDateString('zh-CN');
}

/**
 * 构建组上下文片段。失败时返回空串而非抛错。
 * 输出大致格式：
 *
 *   ## 当前会话组上下文
 *
 *   **组**：<title 或 未命名组（创建于 ...）>
 *
 *   **共享区原生文件**（前 N 个，按 mtime 倒序）：
 *   - `notes.md` (2.3KB, 5分钟前)
 *
 *   需要查看这些文件的详情请使用 ListGroupFiles / ReadGroupFile 工具。
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

    const parts: string[] = [];
    parts.push('## 当前会话组上下文');
    parts.push('');
    const title = group.title?.trim() || `未命名组（创建于 ${new Date(group.createdAt).toLocaleString('zh-CN')}）`;
    parts.push(`**组**：${title}`);
    parts.push('');

    // 原生文件
    let natives: { relPath: string; size: number; mtime: number }[] = [];
    try {
      const result = await groupSharedService.listNativeFiles(workspaceId, groupId);
      natives = result.files;
    } catch (e) {
      logger.warn('列原生文件失败:', e);
    }
    natives.sort((a, b) => b.mtime - a.mtime);
    const nativesShown = natives.slice(0, MAX_FILES_LISTED);
    parts.push(`**共享区原生文件**（共 ${natives.length} 个${natives.length > MAX_FILES_LISTED ? '，展示前 ' + MAX_FILES_LISTED : ''}）：`);
    if (natives.length === 0) {
      parts.push('- （暂无）');
    } else {
      for (const f of nativesShown) {
        parts.push(`- \`${truncatePath(f.relPath)}\` (${formatSize(f.size)}, ${formatRelativeTime(f.mtime)})`);
      }
      if (natives.length > MAX_FILES_LISTED) {
        parts.push(`- …还有 ${natives.length - MAX_FILES_LISTED} 个`);
      }
    }
    parts.push('');
    parts.push('需要查看这些文件的详情请使用 ListGroupFiles / ReadGroupFile 工具。');

    let result = parts.join('\n');

    // 粗估 token，超 budget 时截断（保留头部 + 截断标记）
    const estimatedTokens = Math.ceil(result.length / 4);
    if (estimatedTokens > TARGET_TOKEN_BUDGET) {
      const maxChars = TARGET_TOKEN_BUDGET * 4;
      result = result.slice(0, maxChars) + '\n…（清单过长已截断，详情请用 ListGroupFiles）';
      logger.info(`组上下文超 budget，已截断: estimated=${estimatedTokens} → 约 ${TARGET_TOKEN_BUDGET}`);
    }

    return result;
  } catch (e) {
    logger.warn('构建组上下文失败，跳过注入:', e);
    return '';
  }
}
