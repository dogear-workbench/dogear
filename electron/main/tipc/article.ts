// electron/main/tipc/article.ts
import { tipc } from '@egoist/tipc/main';
import { dbWorkspaces } from '../database/index.js';
import * as articleService from '../services/article-service.js';

const t = tipc.create();

export const articleRouter = {
  /**
   * 解析网络文章并保存到工作区
   */
  parseArticle: t.procedure
    .input<{ url: string; workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = dbWorkspaces.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };

        const result = await articleService.fetchAndParseArticle(input.url);
        await articleService.saveArticle(workspace.path, result);
        return { article: result.meta };
      } catch (error) {
        console.error('解析文章失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 获取工作区下所有文章列表
   */
  getArticles: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = dbWorkspaces.getById(input.workspaceId);
        if (!workspace) return { articles: [], error: '工作区不存在' };

        const articles = await articleService.listArticles(workspace.path);
        return { articles };
      } catch (error) {
        console.error('获取文章列表失败:', error);
        return { articles: [], error: String(error) };
      }
    }),

  /**
   * 获取单篇文章的完整内容
   */
  getArticleDetail: t.procedure
    .input<{ workspaceId: string; articleId: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = dbWorkspaces.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };

        const article = await articleService.getArticle(workspace.path, input.articleId);
        return { article };
      } catch (error) {
        console.error('获取文章详情失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 删除文章
   */
  deleteArticle: t.procedure
    .input<{ workspaceId: string; articleId: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = dbWorkspaces.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };

        await articleService.deleteArticle(workspace.path, input.articleId);
        return { success: true };
      } catch (error) {
        console.error('删除文章失败:', error);
        return { error: String(error) };
      }
    }),
};
