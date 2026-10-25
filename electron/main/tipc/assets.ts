// electron/main/tipc/assets.ts
import { tipc } from '@egoist/tipc/main';
import { listPlatformScripts, readPlatformScript } from '../services/article-parser-skills-service.js';
import { listSiteKnowledge, readSiteKnowledge } from '../services/browser/site-knowledge-service.js';

const t = tipc.create();

export const assetsRouter = {
  /** 平台脚本列表（数据中心习得资产分区） */
  listPlatformScripts: t.procedure.action(async () => {
    try {
      return { scripts: await listPlatformScripts() };
    } catch (error) {
      console.error('[assets] listPlatformScripts 失败:', error);
      return { error: String(error) };
    }
  }),

  /** 读取单个平台脚本内容（name 为去 .py 的平台名） */
  getPlatformScript: t.procedure
    .input<{ name: string }>()
    .action(async ({ input }) => {
      try {
        return { content: await readPlatformScript(input.name) };
      } catch (error) {
        console.error('[assets] getPlatformScript 失败:', error);
        return { error: String(error) };
      }
    }),

  /** 站点档案列表（含两区条目计数） */
  listSiteKnowledge: t.procedure.action(async () => {
    try {
      return { entries: listSiteKnowledge() };
    } catch (error) {
      console.error('[assets] listSiteKnowledge 失败:', error);
      return { error: String(error) };
    }
  }),

  /** 读取单个站点档案内容（超 8KB 截断） */
  getSiteKnowledge: t.procedure
    .input<{ domain: string }>()
    .action(async ({ input }) => {
      try {
        return readSiteKnowledge(input.domain);
      } catch (error) {
        console.error('[assets] getSiteKnowledge 失败:', error);
        return { exists: false, content: '', error: String(error) };
      }
    }),
};
