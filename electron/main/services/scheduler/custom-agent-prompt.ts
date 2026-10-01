/**
 * 定时计划自定义 agent 任务的提示词组装。
 *
 * systemPrompt 承担角色与约束（无人值守、工作区边界、产物落盘、末尾自述），
 * user prompt 只放任务名与用户指令本体。summary 从 assistant 最后一段文本截取，
 * 所以要求模型把结果自述放在输出末尾。
 */
import fs from 'node:fs/promises';
import type { CustomAgentTaskPayload } from '../../agents/task-types.js';
import { loadAllSkillEntries } from '../../agents/pi-session/skill-loader.js';

export interface CustomAgentPrompt {
  systemPrompt: string;
  prompt: string;
}

export function buildCustomAgentPrompt(payload: CustomAgentTaskPayload): CustomAgentPrompt {
  const systemPrompt = [
    '你是 Dogear 定时计划里的自定义任务执行 agent，在无人值守的后台线程运行：没有用户在线，任何提问、确认请求都不会得到回答。',
    '',
    `当前工作区根目录：${payload.workspacePath}`,
    '- 所有文件工具的路径都被限制在该工作区内（相对路径相对工作区根解析，越权访问会被拒绝）',
    '- 任务产物（报告、笔记、数据文件、记忆等）必须用工具实际写入（Write / Edit / dogear__WriteReport / dogear__SaveMemory 等），只在回复里描述产物而没有落盘视为未完成',
    '',
    '执行规则：',
    '- 这是一次性任务：理解指令后直接执行到底，不询问、不等待确认、不寒暄',
    '- 工具调用直接使用工具清单里给出的完整工具名',
    '- 结束时输出一段不超过 200 字的结果自述：做了什么、产物写到了哪里、是否遇到问题',
  ].join('\n');

  const prompt = [
    `## 任务：${payload.taskName}`,
    '',
    payload.prompt,
    '',
    '现在直接执行，完成后按规则输出结果自述。',
  ].join('\n');

  return { systemPrompt, prompt };
}

/** 选中 skill 的 SKILL.md 全文按 <mounted-skill> 分段；单个缺失/读取失败跳过并告警，不阻断任务 */
export async function buildMountedSkillsSection(skills?: string[]): Promise<string> {
  if (!skills?.length) return '';
  const entries = await loadAllSkillEntries();
  const byName = new Map(entries.map((e) => [e.name, e]));
  const sections: string[] = [];
  for (const name of skills) {
    const entry = byName.get(name);
    if (!entry) {
      console.warn(`[custom-agent] 挂载 skill ${name} 不在 skill 索引中，跳过`);
      continue;
    }
    try {
      const content = entry.content ?? await fs.readFile(entry.bodyPath, 'utf-8');
      sections.push(`<mounted-skill name="${name}">\n${content}\n</mounted-skill>`);
    } catch (err) {
      console.warn(`[custom-agent] 读取 skill ${name} 的 SKILL.md 失败，跳过:`, err);
    }
  }
  return sections.join('\n\n');
}
