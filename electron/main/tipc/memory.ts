// electron/main/tipc/memory.ts
import { tipc } from '@egoist/tipc/main';
import {
  getCoreProfile,
  updateCoreProfile,
  listTopics,
  getTopic,
  upsertTopic,
  deleteTopic,
  rebuildIndex,
  checkConsistency,
} from '../services/memory/index.js';
import type { Topic } from '../services/memory/memory-types.js';

const t = tipc.create();

// upsert 入参：时间戳由服务层补全
type TopicInput = Omit<Topic, 'created' | 'updated'> & {
  created?: string;
  updated?: string;
};

export const memoryRouter = {
  /**
   * 读取当前工作区的核心档案（core-profile.md）
   */
  getCoreProfile: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const profile = await getCoreProfile(input.workspaceId);
        return { profile };
      } catch (error) {
        console.error('[memory] getCoreProfile 失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 更新核心档案
   */
  updateCoreProfile: t.procedure
    .input<{ workspaceId: string; content: string }>()
    .action(async ({ input }) => {
      try {
        await updateCoreProfile(input.workspaceId, input.content);
        return { success: true };
      } catch (error) {
        console.error('[memory] updateCoreProfile 失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 列出主题（index.json，按 updated 降序）
   */
  listMemoryTopics: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const topics = await listTopics(input.workspaceId);
        return { topics };
      } catch (error) {
        console.error('[memory] listMemoryTopics 失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 读取单个主题详情（含正文）
   */
  getMemoryTopic: t.procedure
    .input<{ workspaceId: string; slug: string }>()
    .action(async ({ input }) => {
      try {
        const topic = await getTopic(input.workspaceId, input.slug);
        return { topic };
      } catch (error) {
        console.error('[memory] getMemoryTopic 失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 创建或更新主题（upsert 语义）
   */
  upsertMemoryTopic: t.procedure
    .input<{ workspaceId: string; topic: TopicInput }>()
    .action(async ({ input }) => {
      try {
        const topic = await upsertTopic(input.workspaceId, input.topic);
        return { topic };
      } catch (error) {
        console.error('[memory] upsertMemoryTopic 失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 删除主题（文件 + 索引条目）
   */
  deleteMemoryTopic: t.procedure
    .input<{ workspaceId: string; slug: string }>()
    .action(async ({ input }) => {
      try {
        await deleteTopic(input.workspaceId, input.slug);
        return { success: true };
      } catch (error) {
        console.error('[memory] deleteMemoryTopic 失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 重建索引（扫描 topics/*.md 全量重写 index.json），并返回一致性报告
   */
  rebuildMemoryIndex: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const index = await rebuildIndex(input.workspaceId);
        const consistency = await checkConsistency(input.workspaceId);
        return { index, consistency };
      } catch (error) {
        console.error('[memory] rebuildMemoryIndex 失败:', error);
        return { error: String(error) };
      }
    }),
};
