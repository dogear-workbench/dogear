import { z } from 'zod';
import * as groupSharedService from '../../services/group-shared-service.js';
import { requireActiveGroup } from '../../services/group-service.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';


export function createGroupToolDefs(workspaceId: string, groupId: string): ToolDef[] {
  return [
    defineTool(
      'dogear__ListGroupFiles',
      '列出共享区文件清单',
      '列出会话组共享区的文件清单；传 relPath 读取单个共享区文件的完整内容。仅用于查看同组会话放到共享区的文件时。',
      z.object({
        relPath: z.string().min(1).optional().describe('要读取完整内容的共享区文件相对路径；不传则只列文件清单（relPath + 大小 + 修改时间）'),
      }),
      async (args) => {
        try {
          if (args.relPath) {
            try {
              const content = await groupSharedService.readNativeFile(workspaceId, groupId, args.relPath);
              return {
                content: [{ type: 'text' as const, text: content }],
              };
            } catch (error: any) {
              const reason = error?.code === 'ENOENT'
                ? `共享区不存在文件 ${args.relPath}`
                : `读取 ${args.relPath} 失败: ${error instanceof Error ? error.message : String(error)}`;
              return {
                content: [{ type: 'text' as const, text: reason }],
                isError: true as const,
              };
            }
          }
          const { files } = await groupSharedService.listNativeFiles(workspaceId, groupId);
          const lines: string[] = [`📁 会话组共享区文件清单（共 ${files.length} 个文件）`, ''];
          if (files.length === 0) {
            lines.push('暂无文件');
          } else {
            for (const f of files) {
              const kb = (f.size / 1024).toFixed(1);
              const date = new Date(f.mtime).toLocaleString('zh-CN', { hour12: false });
              lines.push(`- ${f.relPath} (${kb} KB, ${date})`);
            }
            lines.push('', '需要某个文件的完整内容时，传 relPath 参数读取。');
          }
          return {
            content: [{ type: 'text' as const, text: lines.join('\n') }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: `列出文件失败: ${error}` }],
            isError: true,
          };
        }
      },
    ),

    defineTool(
      'dogear__TrackUserActions',
      '提议用户待办勾选卡',
      '提议一组必须由用户本人完成的事项（登录/授权/线下操作/人工拍板等），会话界面会渲染成可勾选卡片。仅当事项必须用户本人完成且需要跟踪进度时调用；不要用它记录你自己要做的事（那走任务）。用户勾选后会自动记入话题状态卡「已完成」区，后续会话自然感知——无需等待用户回复，不要为同一批事项重复调用。',
      z.object({
        actions: z.array(z.string().min(1)).min(1).max(10).describe('待办事项列表，每条一句话描述用户要做的事'),
      }),
      async (args) => {
        if (!groupId) {
          return {
            content: [{ type: 'text' as const, text: '当前会话不属于任何话题组，无法跟踪用户待办' }],
            isError: true as const,
          };
        }
        return {
          content: [{ type: 'text' as const, text: `✅ 已向用户渲染待办勾选卡（${args.actions.length} 项）：\n${args.actions.map((a, i) => `${i + 1}. ${a}`).join('\n')}\n用户勾选后会自动记入话题状态卡「已完成」区，无需在回复中重复罗列，也无需等待用户回复。` }],
        };
      },
    ),

    defineTool(
      'dogear__SaveSharedNote',
      '保存到共享区',
      '向会话组共享区写入文件（覆盖已有内容）。仅用于需要向同组其他会话传递文件时。',
      z.object({
        relPath: z.string().describe('共享区相对路径，例如 notes.md 或 ideas/2026-06-25.md'),
        content: z.string().describe('完整文件内容（UTF-8 文本）'),
      }),
      async (args) => {
        try {
          await requireActiveGroup(workspaceId, groupId);
          await groupSharedService.writeNativeFile(workspaceId, groupId, args.relPath, args.content);
          const bytes = Buffer.byteLength(args.content, 'utf-8');
          return {
            content: [{ type: 'text' as const, text: `✅ 已写入 ${args.relPath}（${bytes} 字节）` }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: `写入文件失败: ${error}` }],
            isError: true,
          };
        }
      },
    ),
  ];
}

registerToolGroup({
  server: 'dogear-group',
  label: '会话组共享区',
  create: createGroupToolDefs,
  placeholder: ['', ''],
});
