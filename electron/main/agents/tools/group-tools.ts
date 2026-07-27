import { z } from 'zod';
import * as groupSharedService from '../../services/group-shared-service.js';
import { registerTools } from './tool-registry.js';
import { defineTool, toSdkServer, type ToolDef } from '../pi/tool-adapter.js';

registerTools([
  { name: 'ListGroupFiles', description: '列出当前会话组共享区的所有文件', server: 'dogear-group', category: 'other' },
  { name: 'ReadGroupFile', description: '读取共享区文件内容（按 relPath）', server: 'dogear-group', category: 'other' },
  { name: 'WriteGroupFile', description: '写入共享区文件（覆盖已有内容）', server: 'dogear-group', category: 'other' },
]);

export function createGroupToolDefs(workspaceId: string, groupId: string): ToolDef[] {
  return [
    defineTool(
      'ListGroupFiles',
      '列出当前会话组共享区的所有文件（agent 写出的文件）。',
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
              lines.push(`- ${f.relPath} (${kb} KB, ${date})`);
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
      'ReadGroupFile',
      '读取共享区文件内容（按相对路径）。',
      z.object({
        relPath: z.string().describe('共享区相对路径，例如 notes.md'),
      }),
      async (args) => {
        try {
          const content = await groupSharedService.readNativeFile(workspaceId, groupId, args.relPath);
          return {
            content: [{ type: 'text' as const, text: content }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: `读取文件失败: ${error}` }],
            isError: true,
          };
        }
      },
    ),

    defineTool(
      'WriteGroupFile',
      '写入共享区文件（覆盖已有内容）。',
      z.object({
        relPath: z.string().describe('共享区相对路径，例如 notes.md 或 ideas/2026-06-25.md'),
        content: z.string().describe('完整文件内容（UTF-8 文本）'),
      }),
      async (args) => {
        try {
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

export function createGroupTools(workspaceId: string, groupId: string) {
  return toSdkServer('dogear-group', '1.0.0', createGroupToolDefs(workspaceId, groupId));
}
