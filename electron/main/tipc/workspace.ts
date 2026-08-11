// electron/main/tipc/workspace.ts
import { tipc } from '@egoist/tipc/main';
import electron from 'electron';
const { dialog } = electron;
import * as workspaceJsonService from '../services/workspace-json-service.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import * as articleService from '../services/article-service.js';
import * as workspaceFsService from '../services/workspace-fs-service.js';
import * as conversationTreeService from '../services/conversation-tree-service.js';
import * as conversationService from '../services/conversation-service.js';
import { deleteUsage } from '../services/usage/usage-service.js';
import { scanOrphanWorkspaces, importOrphanToWorkspace } from '../services/workspace-recovery-service.js';
import { getPiSessionManager } from '../agents/pi-session/pi-session-manager.js';
import type { WorkspaceFileNode } from '../types.js';
import type { Workspace } from '../services/workspace-json-service.js';
import path from 'path';

const t = tipc.create();

async function hotUpdateAdditionalPaths(workspaceId: string, workspace: Workspace): Promise<void> {
  const enabledPaths = (workspace.additional_paths ?? [])
    .filter((p) => p.enabled)
    .map((p) => p.path);
  getPiSessionManager().updateWorkspacePaths(workspaceId, enabledPaths);
}

export const workspaceRouter = {
  getAll: t.procedure
    .action(async () => {
      try {
        const workspaces = await workspaceJsonService.getAll();
        return { workspaces };
      } catch (error) {
        console.error('获取工作区列表失败:', error);
        return { workspaces: [], error: String(error) };
      }
    }),

  getDefault: t.procedure
    .action(async () => {
      try {
        return (await workspaceJsonService.getDefault()) ?? null;
      } catch (error) {
        console.error('获取默认工作区失败:', error);
        return null;
      }
    }),

  selectFolder: t.procedure
    .action(async () => {
      try {
        const result = await dialog.showOpenDialog({
          properties: ['openDirectory'],
          title: '选择工作区文件夹',
        });
        if (result.canceled || result.filePaths.length === 0) return { canceled: true };

        const selectedPath = result.filePaths[0];
        const existingWorkspaces = await workspaceJsonService.getAll();
        const existing = existingWorkspaces.find(w => w.path === selectedPath);

        if (existing) {
          await workspaceJsonService.setDefault(existing.id);
          return { workspace: { ...existing, is_default: 1 }, existed: true };
        }

        // 创建新工作区
        const workspace = {
          id: uuidv4(),
          name: selectedPath.split(/[/\\]/).filter(Boolean).pop() || '工作区',
          path: selectedPath,
          additional_paths: [],
          is_default: 1,
          created_at: Date.now(),
        };
        await workspaceJsonService.add(workspace);

        // 记录来源工作区信息到 conversation-tree.json（用于丢失后恢复识别）
        await conversationTreeService.setSourceWorkspace(workspace.id, {
          name: workspace.name,
          path: selectedPath,
        });

        // 确保工作区目录存在
        await fs.mkdir(selectedPath, { recursive: true });
        return { workspace, existed: false };
      } catch (error) {
        console.error('选择工作区文件夹失败:', error);
        return { error: String(error) };
      }
    }),

  setDefault: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        await workspaceJsonService.setDefault(input.workspaceId);
        return { success: true };
      } catch (error) {
        console.error('设置默认工作区失败:', error);
        return { success: false, error: String(error) };
      }
    }),

  deleteWorkspace: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        // 删除前遍历工作区下所有对话，联动清理其 usage JSONL（失败静默）
        const convs = await conversationService.getByWorkspaceId(input.workspaceId, { includeArchived: true });
        await Promise.all(convs.map(c => deleteUsage(c.id).catch(() => {})));
        await workspaceJsonService.remove(input.workspaceId);
        return { success: true };
      } catch (error) {
        console.error('删除工作区失败:', error);
        return { success: false, error: String(error) };
      }
    }),

  getFiles: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { files: [], error: '工作区不存在' };

        // 1. 扫描文章树（.dogear/articles/）
        const articleTree = await articleService.listArticleTree(workspace.path);

        // 2. 扫描工作区普通文件（排除 .dogear）
        const workspaceFiles = await workspaceFsService.scanWorkspaceFiles(workspace.path);

        // 3. 合并：文章树在前，普通文件在后
        return { files: [...articleTree, ...workspaceFiles] };
      } catch (error) {
        console.error('获取工作区文件树失败:', error);
        return { files: [], error: String(error) };
      }
    }),

  // ─── 会话恢复 ───

  scanOrphanWorkspaces: t.procedure
    .action(async () => {
      try {
        return await scanOrphanWorkspaces();
      } catch (error) {
        console.error('扫描孤儿工作区失败:', error);
        return [];
      }
    }),

  importOrphanWorkspace: t.procedure
    .input<{ orphanId: string; targetWorkspaceId: string; deleteAfterImport?: boolean }>()
    .action(async ({ input }) => {
      try {
        return await importOrphanToWorkspace(
          input.orphanId,
          input.targetWorkspaceId,
          input.deleteAfterImport ?? true,
        );
      } catch (error) {
        console.error('导入孤儿工作区失败:', error);
        return { importedCount: 0, error: String(error) };
      }
    }),

  addAdditionalPath: t.procedure
    .input<{ workspaceId: string; path: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { success: false, error: '工作区不存在' };
        if (workspace.additional_paths.some((p) => p.path === input.path)) {
          return { success: false, error: '附加路径已存在' };
        }
        workspace.additional_paths.push({ path: input.path, enabled: true });
        await workspaceJsonService.update(input.workspaceId, workspace);
        await hotUpdateAdditionalPaths(input.workspaceId, workspace);
        return { success: true, workspace };
      } catch (error) {
        console.error('添加附加路径失败:', error);
        return { success: false, error: String(error) };
      }
    }),

  removeAdditionalPath: t.procedure
    .input<{ workspaceId: string; path: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { success: false, error: '工作区不存在' };
        workspace.additional_paths = workspace.additional_paths.filter((p) => p.path !== input.path);
        await workspaceJsonService.update(input.workspaceId, workspace);
        await hotUpdateAdditionalPaths(input.workspaceId, workspace);
        return { success: true, workspace };
      } catch (error) {
        console.error('移除附加路径失败:', error);
        return { success: false, error: String(error) };
      }
    }),

  toggleAdditionalPath: t.procedure
    .input<{ workspaceId: string; path: string; enabled: boolean }>()
    .action(async ({ input }) => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { success: false, error: '工作区不存在' };
        const target = workspace.additional_paths.find((p) => p.path === input.path);
        if (!target) return { success: false, error: '附加路径不存在' };
        target.enabled = input.enabled;
        await workspaceJsonService.update(input.workspaceId, workspace);
        await hotUpdateAdditionalPaths(input.workspaceId, workspace);
        return { success: true, workspace };
      } catch (error) {
        console.error('切换附加路径失败:', error);
        return { success: false, error: String(error) };
      }
    }),

  pickDirectory: t.procedure
    .action(async () => {
      try {
        const result = await dialog.showOpenDialog({
          properties: ['openDirectory'],
          title: '选择附加文件夹',
        });
        if (result.canceled || result.filePaths.length === 0) return { canceled: true };
        return { canceled: false, path: result.filePaths[0] };
      } catch (error) {
        console.error('选择文件夹失败:', error);
        return { canceled: true, error: String(error) };
      }
    }),

  scanAdditionalPath: t.procedure
    .input<{ dirPath: string }>()
    .action(async ({ input }) => {
      try {
        const stat = await fs.stat(input.dirPath);
        if (!stat.isDirectory()) return { files: [] as WorkspaceFileNode[] };
        const files = await scanAbsDirectory(input.dirPath);
        return { files };
      } catch {
        return { files: [] as WorkspaceFileNode[] };
      }
    }),
};

const HIDDEN_NAMES = ['.DS_Store', 'Thumbs.db', '.git', 'node_modules'];

async function scanAbsDirectory(dirPath: string): Promise<WorkspaceFileNode[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const nodes: WorkspaceFileNode[] = [];
  for (const entry of entries) {
    if (HIDDEN_NAMES.includes(entry.name) || entry.name.startsWith('.')) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const children = await scanAbsDirectory(fullPath);
      nodes.push({ name: entry.name, path: fullPath, type: 'directory', children });
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      nodes.push({ name: entry.name, path: fullPath, type: 'file', ext });
    }
  }
  nodes.sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
  return nodes;
}

