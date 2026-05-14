// electron/main/tipc/skill.ts
// Skill 管理 IPC：列出 + 启用/禁用

import { tipc } from '@egoist/tipc/main';
import { listSkills, setSkillEnabled } from '../services/skill-service.js';
import * as workspaceJsonService from '../services/workspace-json-service.js';

const t = tipc.create();

async function resolveWorkspacePath(workspaceId: string | null | undefined): Promise<string | null> {
  if (!workspaceId) return null;
  const ws = await workspaceJsonService.getById(workspaceId);
  return ws?.path ?? null;
}

export const skillRouter = {
  /**
   * 列出可见 Skill：内置 plugin + 工作区级 + 用户级
   */
  listSkills: t.procedure
    .input<{ workspaceId?: string | null }>()
    .action(async ({ input }) => {
      try {
        const workspacePath = await resolveWorkspacePath(input.workspaceId);
        const skills = await listSkills(workspacePath);
        return { skills };
      } catch (error) {
        console.error('列出 Skill 失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 启用/禁用 Skill（重命名 SKILL.md ↔ SKILL.md.disabled）
   */
  setSkillEnabled: t.procedure
    .input<{ dir: string; enabled: boolean; workspaceId?: string | null }>()
    .action(async ({ input }) => {
      try {
        const workspacePath = await resolveWorkspacePath(input.workspaceId);
        await setSkillEnabled(input.dir, input.enabled, workspacePath);
        return { success: true };
      } catch (error) {
        console.error('切换 Skill 启用状态失败:', error);
        return { error: String(error) };
      }
    }),
};
