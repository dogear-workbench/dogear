import { z } from 'zod';
import * as groupSharedService from '../../services/group-shared-service.js';
import { requireActiveGroup } from '../../services/group-service.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';


export function createGroupToolDefs(workspaceId: string, groupId: string): ToolDef[] {
  return [
    defineTool(
      'dogear__ListGroupFiles',
      '列出共享区文件',
      '列出会话组共享区的所有文件并返回内容。仅用于查看同组会话放到共享区的文件时。',
      z.object({}),
      async () => {
        try {
          const { files } = await groupSharedService.listNativeFiles(workspaceId, groupId);
          const lines: string[] = [`📁 会话组共享区（共 ${files.length} 个文件）`, ''];
          if (files.length === 0) {
            lines.push('暂无文件');
          } else {
            for (const f of files) {
              const kb = (f.size / 1024).toFixed(1);
              const date = new Date(f.mtime).toLocaleString('zh-CN', { hour12: false });
              lines.push(`── ${f.relPath} (${kb} KB, ${date}) ──`);
              try {
                const content = await groupSharedService.readNativeFile(workspaceId, groupId, f.relPath);
                lines.push(content);
              } catch (error) {
                lines.push(`⚠ 读取失败: ${error}`);
              }
              lines.push('');
            }
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
