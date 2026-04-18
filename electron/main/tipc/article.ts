// electron/main/tipc/article.ts
import path from 'path';
import { BrowserWindow } from 'electron';
import { tipc, getRendererHandlers } from '@egoist/tipc/main';
import * as workspaceJsonService from '../services/workspace-json-service.js';
import * as articleService from '../services/article-service.js';
import { getAgentManager } from '../agents/agent-manager.js';
import { TaskType, TaskStatus, type AgentTask, type ParseArticlePayload } from '../agents/task-types.js';
import { getArticleParserSkillsDir } from '../services/article-parser-skills-service.js';
import type { RendererHandlers } from './renderer-handlers.js';
import { v4 as uuidv4 } from 'uuid';

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

/**
 * 成功路径后异步提交 AI 质量检查任务（不阻塞 parseArticle 返回）。
 * 失败也静默吞掉，不影响用户看到固定解析的结果。
 */
function submitQualityCheckTask(params: {
  articleId: string;
  workspacePath: string;
  url: string;
}) {
  try {
    const articleDir = path.join(params.workspacePath, '.dogear/articles', params.articleId);
    const skillsDir = getArticleParserSkillsDir();

    const payload: ParseArticlePayload = {
      articleId: params.articleId,
      articleDir,
      workspacePath: params.workspacePath,
      url: params.url,
      fixedParseSuccess: true,
      skillsDir,
    };

    const task: AgentTask = {
      id: uuidv4(),
      type: TaskType.PARSE_ARTICLE,
      status: TaskStatus.PENDING,
      payload,
      createdAt: Date.now(),
    };

    // 不等待任务执行结果，AI 异步工作
    void getAgentManager().submitTask(task).catch((err) => {
      console.warn('[article] 提交 PARSE_ARTICLE 任务失败:', err);
    });
  } catch (err) {
    // 提交失败不影响主流程
    console.warn('[article] 准备 PARSE_ARTICLE 任务失败:', err);
  }
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

        // 异步触发 AI 质量检查（后台静默执行，用户立即收到固定解析结果）
        submitQualityCheckTask({
          articleId: result.meta.id,
          workspacePath: workspace.path,
          url: input.url,
        });

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
