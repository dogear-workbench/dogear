// electron/main/tipc/skill.ts
// Skill 管理 IPC：列出（启用状态随 workspace config 的 enabledSkills 标注）

import { tipc } from '@egoist/tipc/main';
import { listSkills } from '../services/skill-service.js';

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
};
