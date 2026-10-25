// electron/main/tipc/article.ts
import { BrowserWindow } from 'electron';
import { tipc, getRendererHandlers } from '@egoist/tipc/main';
import * as workspaceJsonService from '../services/workspace-json-service.js';
import * as articleService from '../services/article-service.js';
import { runParseArticlePipeline } from '../services/article/pipeline.js';
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
    workspaceId: string;
    parseStatus: 'script_ok' | 'fixed' | 'ai_parsing' | 'ai_enhanced' | 'quality_warning' | 'failed';
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
   * 解析网络文章并保存到工作区（V2 主流程）
   *
   * 优先级：
   *   1. 平台脚本（Python）— 零 AI，最快
   *   2. Readability — 本地 HTML 解析
   *   3. AI 兜底 — 静态解析失败时创建 stub 并提交 Agent 任务
   * 管线本体在 services/article/pipeline.ts（与 dogear__SaveArticle 工具共用），此处只做工作区解析与薄壳转发
   */
  parseArticle: t.procedure
    .input<{ url: string; workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };

        const result = await runParseArticlePipeline({
          workspaceId: workspace.id,
          workspacePath: workspace.path,
          url: input.url,
        });
        if (!result.ok || !result.article) return { error: result.error ?? '解析失败' };
        return { article: result.article, articlePath: result.articlePath };
      } catch (error) {
        console.error('解析文章失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 获取单篇文章的完整内容（按 frontmatter id 全库扫描定位，文件改名/移动不影响）
   */
  getArticleDetail: t.procedure
    .input<{ workspaceId: string; articleId: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };

        const entry = await articleService.getArticleWithRelPath(workspace.id, workspace.path, input.articleId);
        if (!entry) return { error: '文章不存在' };
        return { article: entry.article, articlePath: entry.relPath };
      } catch (error) {
        console.error('获取文章详情失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 按工作区相对路径读文章文件（dogear/articles 内 md 且 frontmatter 可解析才命中；未命中返回 null 降级普通 md）
   */
  getArticleByPath: t.procedure
    .input<{ workspaceId: string; relPath: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };
        const article = await articleService.getArticleFileByRelPath(workspace.path, input.relPath);
        return { article };
      } catch (error) {
        console.error('按路径读取文章失败:', error);
        return { error: String(error) };
      }
    }),
};
