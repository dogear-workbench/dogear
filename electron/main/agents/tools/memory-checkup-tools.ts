/**
 * 记忆库体检工具（dogear-memory-admin 工具组）
 *
 * 纯代码检测：重复对 / 死重 / 孤儿索引 / 垃圾文件 / 使用统计汇总；
 * 无歧义项（孤儿索引重建、垃圾清理）直接修，有歧义项只出报告等用户拍板。
 * 挂载点：定时任务场景（每周体检任务）与主会话按需拉起，不进普通会话常驻面。
 */
import { z } from 'zod';
import { runMemoryCheckup } from '../../services/memory/memory-checkup.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';

export function createMemoryCheckupToolDefs(): ToolDef[] {
  return [
    defineTool(
      'dogear__MemoryCheckup',
      '记忆库体检',
      '对记忆库做全面体检：自动修复无歧义问题（孤儿索引重建、.bak/.conflict 垃圾文件清理），检测重复主题对、死重（60 天未召回）、过时候选（90 天以上且被同主题新记忆覆盖），并附使用统计。\\n' +
        '返回结构化报告：autoFixed 已直接修复；duplicatePairs / deadWeight / staleCandidates 是待裁决建议（合并保留新/删除/存疑），由调用方整理成报告供用户拍板，不要据此直接删除或合并记忆。',
      z.object({
        workspaceIds: z
          .array(z.string().min(1))
          .optional()
          .describe('限定体检的工作区 id 列表；省略=全部工作区 + 全局记忆'),
      }),
      async (args) => {
        try {
          const report = await runMemoryCheckup({ workspaceIds: args.workspaceIds });
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(report, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `记忆库体检失败: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    ),
  ];
}

registerToolGroup({
  server: 'dogear-memory-admin',
  label: '记忆体检',
  create: createMemoryCheckupToolDefs,
  placeholder: [],
});
