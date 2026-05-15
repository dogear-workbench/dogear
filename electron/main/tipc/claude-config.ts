// electron/main/tipc/claude-config.ts
import { tipc } from '@egoist/tipc/main';
import {
  getClaudeDirStatus,
  initClaudeDir,
  readClaudeMd,
  writeClaudeMd,
  listAgentFiles,
  readAgentFile,
  writeAgentFile,
  deleteAgentFile,
} from '../services/claude-config-service.js';
import {
  listAgentTemplates,
  subscribeAgentTemplate,
} from '../services/agent-templates-service.js';
import {
  listSkillTemplates,
  subscribeSkillTemplate,
} from '../services/stock-analysis-skills-service.js';

const t = tipc.create();

export const claudeConfigRouter = {
  /**
   * 获取工作区 .claude 目录状态
   */
  getClaudeDirStatus: t.procedure
    .input<{ workspacePath: string }>()
    .action(async ({ input }) => {
      try {
        const status = await getClaudeDirStatus(input.workspacePath);
        return { status };
      } catch (error) {
        console.error('获取 .claude 目录状态失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 初始化工作区 .claude 目录
   */
  initClaudeDir: t.procedure
    .input<{ workspacePath: string }>()
    .action(async ({ input }) => {
      try {
        await initClaudeDir(input.workspacePath);
        return { success: true };
      } catch (error) {
        console.error('初始化 .claude 目录失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 读取工作区 CLAUDE.md
   */
  readClaudeMd: t.procedure
    .input<{ workspacePath: string }>()
    .action(async ({ input }) => {
      try {
        const content = await readClaudeMd(input.workspacePath);
        return { content };
      } catch (error) {
        console.error('读取 CLAUDE.md 失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 写入工作区 CLAUDE.md
   */
  writeClaudeMd: t.procedure
    .input<{ workspacePath: string; content: string }>()
    .action(async ({ input }) => {
      try {
        await writeClaudeMd(input.workspacePath, input.content);
        return { success: true };
      } catch (error) {
        console.error('写入 CLAUDE.md 失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 列出工作区代理文件
   */
  listAgentFiles: t.procedure
    .input<{ workspacePath: string }>()
    .action(async ({ input }) => {
      try {
        const files = await listAgentFiles(input.workspacePath);
        return { files };
      } catch (error) {
        console.error('列出代理文件失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 读取代理文件
   */
  readAgentFile: t.procedure
    .input<{ workspacePath: string; fileName: string }>()
    .action(async ({ input }) => {
      try {
        const content = await readAgentFile(input.workspacePath, input.fileName);
        return { content };
      } catch (error) {
        console.error('读取代理文件失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 写入代理文件
   */
  writeAgentFile: t.procedure
    .input<{ workspacePath: string; fileName: string; content: string }>()
    .action(async ({ input }) => {
      try {
        await writeAgentFile(input.workspacePath, input.fileName, input.content);
        return { success: true };
      } catch (error) {
        console.error('写入代理文件失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 删除代理文件
   */
  deleteAgentFile: t.procedure
    .input<{ workspacePath: string; fileName: string }>()
    .action(async ({ input }) => {
      try {
        await deleteAgentFile(input.workspacePath, input.fileName);
        return { success: true };
      } catch (error) {
        console.error('删除代理文件失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 列出可订阅的代理模板
   */
  listAgentTemplates: t.procedure
    .action(async () => {
      try {
        const templates = listAgentTemplates();
        return { templates };
      } catch (error) {
        console.error('列出代理模板失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 订阅代理模板到工作区
   * - overwrite=false 且文件已存在时返回 { error: 'AGENT_EXISTS' }，由前端弹 confirm 后重试
   */
  subscribeAgentTemplate: t.procedure
    .input<{ workspacePath: string; fileName: string; overwrite: boolean }>()
    .action(async ({ input }) => {
      try {
        await subscribeAgentTemplate(input.workspacePath, input.fileName, input.overwrite);
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === 'AGENT_EXISTS') {
          return { error: 'AGENT_EXISTS' };
        }
        console.error('订阅代理模板失败:', error);
        return { error: message };
      }
    }),

  /**
   * 列出可订阅的 Skill 模板（当前仅 stock-analysis）
   */
  listSkillTemplates: t.procedure
    .action(async () => {
      try {
        const templates = listSkillTemplates();
        return { templates };
      } catch (error) {
        console.error('列出 Skill 模板失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 订阅 Skill 模板到工作区
   */
  subscribeSkillTemplate: t.procedure
    .input<{ workspacePath: string; name: string; overwrite: boolean }>()
    .action(async ({ input }) => {
      try {
        await subscribeSkillTemplate(input.workspacePath, input.name, input.overwrite);
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === 'SKILL_EXISTS') {
          return { error: 'SKILL_EXISTS' };
        }
        console.error('订阅 Skill 模板失败:', error);
        return { error: message };
      }
    }),
};
