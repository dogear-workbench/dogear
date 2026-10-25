// electron/main/tipc/skill.ts
// Skill 管理 IPC：列出（启用状态随 workspace config 的 enabledSkills 标注）+ 自定义技能读取/编辑/导入

import { tipc } from '@egoist/tipc/main';
import {
  customSkillsDir,
  importCustomSkill,
  listSkills,
  readCustomSkill,
  writeCustomSkill,
} from '../services/skill-service.js';
import { getConfigDir } from '../services/settings-service.js';
import { getTemplatesDir } from '../services/skill-template-service.js';

const t = tipc.create();

function customSkillDirs() {
  return { skillsDir: customSkillsDir(getConfigDir()), builtinDir: getTemplatesDir() };
}

export const skillRouter = {
  /**
   * 列出所有 Skill（builtin + custom），用工作区 config 标注 enabled
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

  getCustomSkillsDir: t.procedure.action(async () => ({ path: customSkillsDir(getConfigDir()) })),

  readCustomSkill: t.procedure
    .input<{ name: string }>()
    .action(async ({ input }) => {
      try {
        return await readCustomSkill(input.name, customSkillsDir(getConfigDir()));
      } catch (error) {
        console.error('读取自定义技能失败:', error);
        return { error: String(error) };
      }
    }),

  writeCustomSkill: t.procedure
    .input<{ name: string; content: string }>()
    .action(async ({ input }) => {
      try {
        return await writeCustomSkill(input.name, input.content, customSkillDirs());
      } catch (error) {
        console.error('保存自定义技能失败:', error);
        return { error: String(error) };
      }
    }),

  importCustomSkill: t.procedure
    .input<{ srcDir: string; overwrite?: boolean }>()
    .action(async ({ input }) => {
      try {
        return await importCustomSkill(input.srcDir, customSkillDirs(), input.overwrite ?? false);
      } catch (error) {
        console.error('导入自定义技能失败:', error);
        return { error: String(error) };
      }
    }),
};
