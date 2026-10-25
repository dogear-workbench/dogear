// electron/main/tipc/memory.ts
import { tipc } from '@egoist/tipc/main';
import {
  listTopics,
  getTopic,
  upsertTopic,
  deleteTopic,
  rebuildIndex,
  checkConsistency,
} from '../services/memory/index.js';
import type { MemoryScope, Topic } from '../services/memory/memory-types.js';

const t = tipc.create();

// upsert 入参：时间戳由服务层补全
type TopicInput = Omit<Topic, 'created' | 'updated'> & {
  created?: string;
  updated?: string;
};

// scope=global 时数据目录固定为 configDir/memory，workspaceId 仅作占位不参与寻址
interface MemoryInputBase {
  workspaceId: string;
  scope?: MemoryScope;
}

export const memoryRouter = {
  /**
   * 列出主题（index.json，按 updated 降序）；scope 省略时合并工作区 + 全局
   */
  listMemoryTopics: t.procedure
    .input<MemoryInputBase>()
    .action(async ({ input }) => {
      try {
        const topics = await listTopics(input.workspaceId, input.scope);
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
    .input<MemoryInputBase & { slug: string }>()
    .action(async ({ input }) => {
      try {
        const topic = await getTopic(input.workspaceId, input.slug, input.scope ?? 'workspace');
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
    .input<MemoryInputBase & { topic: TopicInput }>()
    .action(async ({ input }) => {
      try {
        const topic = await upsertTopic(input.workspaceId, input.topic, input.scope ?? 'workspace');
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
    .input<MemoryInputBase & { slug: string }>()
    .action(async ({ input }) => {
      try {
        await deleteTopic(input.workspaceId, input.slug, input.scope ?? 'workspace');
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
    .input<MemoryInputBase>()
    .action(async ({ input }) => {
      try {
        const scope = input.scope ?? 'workspace';
        const index = await rebuildIndex(input.workspaceId, scope);
        const consistency = await checkConsistency(input.workspaceId, scope);
        return { index, consistency };
      } catch (error) {
        console.error('[memory] rebuildMemoryIndex 失败:', error);
        return { error: String(error) };
      }
    }),
};
