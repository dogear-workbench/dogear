// electron/main/tipc/claude-config.ts
import { tipc } from '@egoist/tipc/main';
import {
  getAgentMdStatus,
  initAgentMd,
  readWorkspaceAgentMd,
  writeWorkspaceAgentMd,
  readUserAgentMd,
  writeUserAgentMd,
} from '../services/claude-config-service.js';
import {
  listSkillTemplates,
  subscribeSkillTemplate,
  getTemplateContent,
} from '../services/skill-template-service.js';

const t = tipc.create();

export const claudeConfigRouter = {
  /**
   * 获取 agent.md 状态（工作区级 + 用户级）
   */
  getAgentMdStatus: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const status = await getAgentMdStatus(input.workspaceId);
        return { status };
      } catch (error) {
        console.error('获取 agent.md 状态失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 初始化工作区 agent.md
   */
  initAgentMd: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        await initAgentMd(input.workspaceId);
        return { success: true };
      } catch (error) {
        console.error('初始化 agent.md 失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 读取工作区级 agent.md
   */
  readWorkspaceAgentMd: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const content = await readWorkspaceAgentMd(input.workspaceId);
        return { content };
      } catch (error) {
        console.error('读取工作区 agent.md 失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 写入工作区级 agent.md
   */
  writeWorkspaceAgentMd: t.procedure
    .input<{ workspaceId: string; content: string }>()
    .action(async ({ input }) => {
      try {
        await writeWorkspaceAgentMd(input.workspaceId, input.content);
        return { success: true };
      } catch (error) {
        console.error('写入工作区 agent.md 失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 读取用户级 agent.md（.dogear/agent.md）
   */
  readUserAgentMd: t.procedure
    .action(async () => {
      try {
        const content = await readUserAgentMd();
        return { content };
      } catch (error) {
        console.error('读取用户级 agent.md 失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 写入用户级 agent.md
   */
  writeUserAgentMd: t.procedure
    .input<{ content: string }>()
    .action(async ({ input }) => {
      try {
        await writeUserAgentMd(input.content);
        return { success: true };
      } catch (error) {
        console.error('写入用户级 agent.md 失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 列出可订阅的 Skill 模板（扫描 resources/skill-templates/）
   */
  listSkillTemplates: t.procedure
    .action(async () => {
      try {
        const templates = await listSkillTemplates();
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

  /**
   * 获取 Skill 模板源全文（浮窗详情用）
   */
  getSkillContent: t.procedure
    .input<{ name: string }>()
    .action(async ({ input }) => {
      try {
        const content = await getTemplateContent(input.name);
        return { content };
      } catch (error) {
        console.error('读取 Skill 模板源失败:', error);
        return { error: String(error) };
      }
    }),
};
