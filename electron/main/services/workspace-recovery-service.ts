/**
 * 工作区恢复服务
 * 扫描 .dogear/workspaces/ 下未注册的"孤儿"文件夹，支持合并导入到当前工作区。
 */
import fs from 'fs/promises';
import path from 'path';
import electron from 'electron';
import { safeJsonRead } from './safe-json.js';
import type { ConversationIndex } from './conversation-service.js';
import * as conversationService from './conversation-service.js';

const { app } = electron;

function getConfigDir(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), '.dogear');
  }
  return path.join(process.cwd(), '.dogear');
}

/** 孤儿工作区信息（扫描结果） */
export interface OrphanWorkspace {
  /** .dogear/workspaces/ 下的文件夹名（即 workspaceId） */
  id: string;
  /** 来源工作区名称（从 conversation-tree.json 读取） */
  sourceName?: string;
  /** 来源工作区路径 */
  sourcePath?: string;
  /** 对话数量 */
  conversationCount: number;
  /** 对话标题列表（前 5 条，帮助用户识别） */
  sampleTitles: string[];
  /** 最后更新时间（ISO 8601） */
  lastUpdated: string | null;
}

/**
 * 扫描 .dogear/workspaces/ 目录，找出未被 workspaces.json 注册的孤儿文件夹。
 * 读取每个孤儿的 conversation-tree.json（sourceWorkspace）和 conversations.json（对话数+标题）。
 */
export async function scanOrphanWorkspaces(): Promise<OrphanWorkspace[]> {
  const configDir = getConfigDir();
  const workspacesDir = path.join(configDir, 'workspaces');

  // 读取 workspaces.json 中已注册的 ID（新路径 .dogear/workspaces/workspaces.json）
  const workspacesFile = await safeJsonRead<{ version: number; workspaces: Array<{ id: string }> }>(
    path.join(workspacesDir, 'workspaces.json'),
    { version: 1, workspaces: [] },
  );
  const registeredIds = new Set(workspacesFile.workspaces.map((w) => w.id));

  // 列出 .dogear/workspaces/ 下所有子目录
  let entries: string[] = [];
  try {
    const dirEntries = await fs.readdir(workspacesDir, { withFileTypes: true });
    entries = dirEntries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return []; // workspaces 目录不存在
  }

  const orphanIds = entries.filter((id) => !registeredIds.has(id));

  const orphans: OrphanWorkspace[] = [];
  for (const id of orphanIds) {
    const wsDir = path.join(workspacesDir, id);

    // 读取 conversation-tree.json 中的 sourceWorkspace
    const tree = await safeJsonRead<{ sourceWorkspace?: { name: string; path: string } }>(
      path.join(wsDir, 'conversation-tree.json'),
      {},
    );

    // 读取 conversations.json 统计对话数和标题
    const convFile = await safeJsonRead<{ conversations: Record<string, ConversationIndex> }>(
      path.join(wsDir, 'conversations.json'),
      { conversations: {} },
    );

    const convEntries = Object.values(convFile.conversations || {});
    if (convEntries.length === 0) continue; // 跳过空文件夹

    // 按 updatedAt 倒序排列，取前 5 条标题
    const sorted = convEntries.sort((a, b) =>
      (b.updatedAt || '').localeCompare(a.updatedAt || ''),
    );
    const sampleTitles = sorted.slice(0, 5).map((c) => c.title);
    const lastUpdated = sorted[0]?.updatedAt || null;

    orphans.push({
      id,
      sourceName: tree.sourceWorkspace?.name,
      sourcePath: tree.sourceWorkspace?.path,
      conversationCount: convEntries.length,
      sampleTitles,
      lastUpdated,
    });
  }

  // 按最后更新时间降序
  orphans.sort((a, b) => (b.lastUpdated || '').localeCompare(a.lastUpdated || ''));
  return orphans;
}

/**
 * 将孤儿工作区的会话合并导入到目标工作区（合并模式）。
 *
 * 步骤：
 * 1. 读取孤儿 conversations.json，逐条 merge 到目标（保留 ID，更新 workspaceId）
 * 2. 可选：导入完成后删除孤儿文件夹
 *
 * ⚠️ deleteAfterImport：完整搬迁工具上线前禁止传 true——本函数只 merge conversations.json 索引，
 * 不搬 sessions 正文、groups、notes、memory 等未迁移内容，删源目录会永久丢失这些数据
 * （2026-09-27 同步事故的根因之一）。参数保留仅作防御纵深，现无调用方传 true。
 *
 * 返回实际导入的对话数量。
 */
export async function importOrphanToWorkspace(
  orphanId: string,
  targetWorkspaceId: string,
  deleteAfterImport: boolean = false,
): Promise<{ importedCount: number }> {
  const configDir = getConfigDir();
  const orphanDir = path.join(configDir, 'workspaces', orphanId);

  // 读取孤儿 conversations
  const orphanConvFile = await safeJsonRead<{
    version: number;
    conversations: Record<string, ConversationIndex>;
  }>(path.join(orphanDir, 'conversations.json'), { version: 1, conversations: {} });

  const orphanConversations = Object.values(orphanConvFile.conversations || {});
  if (orphanConversations.length === 0) {
    return { importedCount: 0 };
  }

  // 逐条合并对话索引
  let importedCount = 0;
  for (const conv of orphanConversations) {
    await conversationService.importConversation(targetWorkspaceId, conv);
    importedCount++;
  }

  // 可选清理孤儿文件夹
  if (deleteAfterImport) {
    try {
      await fs.rm(orphanDir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响导入结果
    }
  }

  return { importedCount };
}

/**
 * 舍弃孤儿工作区：删除 .dogear/workspaces/<orphanId> 源目录（会话正文等全部数据）。
 * 仅删除扫描口径内的孤儿：目录名纯净化 + 未注册校验，防止误删已注册工作区。
 */
export async function discardOrphanWorkspace(orphanId: string): Promise<void> {
  if (!orphanId || orphanId.includes('/') || orphanId.includes('\\') || orphanId.includes('..')) {
    throw new Error('无效的目录标识');
  }

  const configDir = getConfigDir();
  const workspacesDir = path.join(configDir, 'workspaces');

  const workspacesFile = await safeJsonRead<{ version: number; workspaces: Array<{ id: string }> }>(
    path.join(workspacesDir, 'workspaces.json'),
    { version: 1, workspaces: [] },
  );
  if (workspacesFile.workspaces.some((w) => w.id === orphanId)) {
    throw new Error('该目录已是注册工作区，拒绝删除');
  }

  await fs.rm(path.join(workspacesDir, orphanId), { recursive: true, force: true });
}
