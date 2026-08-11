// electron/main/tipc/skill.ts
// Skill 管理 IPC：列出 + 启用/禁用

import { tipc } from '@egoist/tipc/main';
import { listSkills, setSkillEnabled } from '../services/skill-service.js';

const t = tipc.create();

export const skillRouter = {
  /**
   * 列出所有 Skill（builtin + custom + user），用工作区 config 标注 enabled
   */
  listSkills: t.procedure
    .input<{ workspaceId?: string | null }>()
    .action(async ({ input }) => {
      try {
        const skills = await listSkills(input.workspaceId);
        return { skills };
      } catch (error) {
        console.error('列出 Skill 失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 启用/禁用 Skill（读写 workspace-config-service 的 enabledSkills）
   */
  setSkillEnabled: t.procedure
    .input<{ name: string; enabled: boolean; workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        await setSkillEnabled(input.name, input.enabled, input.workspaceId);
        return { success: true };
      } catch (error) {
        console.error('切换 Skill 启用状态失败:', error);
        return { error: String(error) };
      }
    }),
};
