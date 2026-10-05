// electron/main/tipc/explorer.ts
import { tipc } from '@egoist/tipc/main';
import electron from 'electron';
const { shell } = electron;
import * as workspaceJsonService from '../services/workspace-json-service.js';
import { getEnabledRoots } from '../services/workspace-json-service.js';
import * as workspaceFsService from '../services/workspace-fs-service.js';
import * as articleService from '../services/article-service.js';
import * as groupSharedService from '../services/group-shared-service.js';

const t = tipc.create();

export const explorerRouter = {
  createFolder: t.procedure
    .input<{ workspaceId: string; parentPath: string; name: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };

        const isArticleFolder = input.parentPath.startsWith('.dogear/articles');
        if (isArticleFolder) {
          await articleService.createArticleFolder(workspace.path, input.parentPath, input.name);
        } else {
          await workspaceFsService.createFolder(workspace.path, input.parentPath, input.name, input.workspaceId);
        }
        return { success: true };
      } catch (error) {
        console.error('创建文件夹失败:', error);
        return { error: String(error) };
      }
    }),

  renameItem: t.procedure
    .input<{ workspaceId: string; itemPath: string; newName: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };

        const isArticlePath = input.itemPath.startsWith('.dogear/articles');
        if (isArticlePath) {
          await articleService.renameArticleFolder(workspace.path, input.itemPath, input.newName);
        } else {
          await workspaceFsService.renameItem(workspace.path, input.itemPath, input.newName, input.workspaceId);
        }
        return { success: true };
      } catch (error) {
        console.error('重命名失败:', error);
        return { error: String(error) };
      }
    }),

  moveItem: t.procedure
    .input<{ workspaceId: string; sourcePath: string; targetPath: string; targetIndex?: number }>()
    .action(async ({ input }) => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };

        const isArticlePath = input.sourcePath.startsWith('.dogear/articles');
        if (isArticlePath) {
          await articleService.moveArticleItem(workspace.path, input.sourcePath, input.targetPath, input.targetIndex);
        } else {
          await workspaceFsService.moveItem(workspace.path, input.sourcePath, input.targetPath, input.workspaceId);
        }
        return { success: true };
      } catch (error) {
        console.error('移动失败:', error);
        return { error: String(error) };
      }
    }),

  copyItem: t.procedure
    .input<{ workspaceId: string; sourcePath: string; targetPath: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };

        await workspaceFsService.copyItem(workspace.path, input.sourcePath, input.targetPath, input.workspaceId);
        return { success: true };
      } catch (error) {
        console.error('复制失败:', error);
        return { error: String(error) };
      }
    }),

  deleteItem: t.procedure
    .input<{ workspaceId: string; itemPath: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };

        const isArticlePath = input.itemPath.startsWith('.dogear/articles');
        if (isArticlePath) {
          await articleService.deleteArticleFolder(workspace.path, input.itemPath);
        } else {
          await workspaceFsService.deleteItem(workspace.path, input.itemPath, input.workspaceId);
        }
        return { success: true };
      } catch (error) {
        console.error('删除失败:', error);
        return { error: String(error) };
      }
    }),

  openInExplorer: t.procedure
    .input<{ workspaceId: string; itemPath: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };

        const absPath = workspaceFsService.resolveAndValidate(workspace.path, input.itemPath);
        shell.showItemInFolder(absPath);
        return { success: true };
      } catch (error) {
        console.error('打开文件管理器失败:', error);
        return { error: String(error) };
      }
    }),

  readFile: t.procedure
    .input<{ workspaceId: string; path: string; groupId?: string }>()
    .action(async ({ input }) => {
      const workspace = await workspaceJsonService.getById(input.workspaceId);
      if (!workspace) throw new Error('工作区不存在');
      const roots = getEnabledRoots(workspace);
      if (input.groupId) roots.push(await groupSharedService.getSharedDir(input.workspaceId, input.groupId));
      const content = await workspaceFsService.readWorkspaceTextFile(roots, input.path);
      return { content };
    }),

  checkPathsExist: t.procedure
    .input<{ workspaceId: string; paths: string[]; groupId?: string }>()
    .action(async ({ input }) => {
      const workspace = await workspaceJsonService.getById(input.workspaceId);
      if (!workspace) throw new Error('工作区不存在');
      const roots = getEnabledRoots(workspace);
      if (input.groupId) roots.push(await groupSharedService.getSharedDir(input.workspaceId, input.groupId));
      const exists = await workspaceFsService.checkPathsExist(roots, input.paths);
      return { exists };
    }),
};
