// electron/main/tipc/article.ts
import { BrowserWindow } from 'electron';
import { tipc, getRendererHandlers } from '@egoist/tipc/main';
import * as workspaceJsonService from '../services/workspace-json-service.js';
import * as articleService from '../services/article-service.js';
import { getAgentManager } from '../agents/agent-manager.js';
import type { RendererHandlers } from './renderer-handlers.js';

const t = tipc.create();

/**
 * 注册一次性全局监听：将 AgentManager 的 articleParseStatusChanged 事件
 * 广播到所有渲染窗口（主窗口 + 独立会话窗口都可能展示文章）。
 * 由 tipc/index.ts 在应用启动时调用。
 */
let listenerRegistered = false;
export function registerArticleParseStatusListener() {
  if (listenerRegistered) return;
  listenerRegistered = true;

  getAgentManager().on('articleParseStatusChanged', (data: {
    articleId: string;
    workspacePath: string;
    parseStatus: 'fixed' | 'ai_parsing' | 'ai_enhanced' | 'quality_warning' | 'failed';
  }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        const handlers = getRendererHandlers<RendererHandlers>(win.webContents);
        handlers.articleParseStatusChanged.send(data);
      } catch (err) {
        // 单个窗口失败不影响其他窗口
        console.warn('[article] 广播到窗口失败:', err);
      }
    }
  });
}

export const articleRouter = {
  /**
   * 解析网络文章并保存到工作区
   */
  parseArticle: t.procedure
    .input<{ url: string; workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };

        const result = await articleService.fetchAndParseArticle(input.url);
        await articleService.saveArticle(workspace.path, result);

        // V2: 固定解析成功后不再自动跑 AI 质量检查
        // AI 只在 Phase 3 引入的"脚本 + Readability 双双失败"路径才介入
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
        const workspace = await workspaceJsonService.getById(input.workspaceId);
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
        const workspace = await workspaceJsonService.getById(input.workspaceId);
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
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };

        await articleService.deleteArticle(workspace.path, input.articleId);
        return { success: true };
      } catch (error) {
        console.error('删除文章失败:', error);
        return { error: String(error) };
      }
    }),
};
