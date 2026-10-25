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

// docs/ 旧链接读侧兼容：工作区 docs/ 已改名 dogear/，旧前缀路径不存在时回退新位置（只做读侧，不改用户数据）
function legacyDocsTwinPath(p: string): string | null {
  const norm = p.split('\\').join('/');
  const rest = norm === 'docs' ? '' : norm.startsWith('docs/') ? norm.slice('docs/'.length) : null;
  if (rest !== null) return rest === '' ? 'dogear' : `dogear/${rest}`;
  const idx = norm.indexOf('/docs/');
  return idx > 0 ? `dogear/${norm.slice(idx + '/docs/'.length)}` : null;
}

export const explorerRouter = {
  createFolder: t.procedure
    .input<{ workspaceId: string; parentPath: string; name: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };

        await workspaceFsService.createFolder(workspace.path, input.parentPath, input.name, input.workspaceId);
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

        // 文章 md 文件需伴随 raw.html 同步改名，其余走通用文件操作
        const handledAsArticle = await articleService.renameArticleFileWithCompanion(
          input.workspaceId,
          workspace.path,
          input.itemPath,
          input.newName,
        );
        if (!handledAsArticle) {
          await workspaceFsService.renameItem(workspace.path, input.itemPath, input.newName, input.workspaceId);
        }
        return { success: true };
      } catch (error) {
        console.error('重命名失败:', error);
        return { error: String(error) };
      }
    }),

  moveItem: t.procedure
    .input<{ workspaceId: string; sourcePath: string; targetPath: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };

        // 文章 md 文件需伴随 raw.html 跟随移动，其余走通用文件操作
        const handledAsArticle = await articleService.moveArticleFileWithCompanion(
          input.workspaceId,
          workspace.path,
          input.sourcePath,
          input.targetPath,
        );
        if (!handledAsArticle) {
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

        // 文章 md 文件需伴随 raw.html 一并删除，其余（目录等）走通用文件操作
        const handledAsArticle = await articleService.deleteArticleFileByRelPath(
          input.workspaceId,
          workspace.path,
          input.itemPath,
        );
        if (!handledAsArticle) {
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
      const twin = legacyDocsTwinPath(input.path);
      if (twin) {
        try {
          const content = await workspaceFsService.readWorkspaceTextFile(roots, twin);
          return { content };
        } catch {
          // dogear/ 下也无此文件 → 落回原路径的报错语义
        }
      }
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
      for (const p of input.paths) {
        if (exists[p]) continue;
        const twin = legacyDocsTwinPath(p);
        if (twin && (await workspaceFsService.checkPathsExist(roots, [twin]))[twin]) exists[p] = true;
      }
      return { exists };
    }),
};
