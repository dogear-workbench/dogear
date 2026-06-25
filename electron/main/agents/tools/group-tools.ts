import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import * as groupSharedService from '../../services/group-shared-service.js';
import * as groupService from '../../services/group-service.js';
import { registerTools } from './tool-registry.js';

registerTools([
  { name: 'ListGroupFiles', description: '列出当前会话组共享区的所有文件（原生项+引用项）', server: 'dogear-group', category: 'other' },
  { name: 'ReadGroupFile', description: '读取共享区文件内容（原生项按 relPath，引用项按 refId）', server: 'dogear-group', category: 'other' },
  { name: 'WriteGroupFile', description: '写入共享区原生文件（覆盖已有内容；引用项只读不可写）', server: 'dogear-group', category: 'other' },
  { name: 'AddGroupReference', description: '把工作区内的某个文件添加为当前组的引用项', server: 'dogear-group', category: 'other' },
]);

export function createGroupTools(workspaceId: string, groupId: string) {
  return createSdkMcpServer({
    name: 'dogear-group',
    version: '1.0.0',
    tools: [
      tool(
        'ListGroupFiles',
        '列出当前会话组共享区的所有文件。\n' +
        '可按 section 过滤：native=仅原生项，references=仅引用项，all=全部（默认）。',
        {
          section: z.enum(['native', 'references', 'all']).optional().describe('过滤范围，默认 all'),
        },
        async (args) => {
          try {
            const section = args.section ?? 'all';
            const lines: string[] = ['📁 会话组共享区', ''];

            if (section === 'native' || section === 'all') {
              const natives = await groupSharedService.listNativeFiles(workspaceId, groupId);
              lines.push(`=== 原生项（共 ${natives.length} 个） ===`);
              if (natives.length === 0) {
                lines.push('暂无原生文件');
              } else {
                for (const f of natives) {
                  const kb = (f.size / 1024).toFixed(1);
                  const date = new Date(f.mtime).toLocaleString('zh-CN', { hour12: false });
                  lines.push(`- ${f.relPath} (${kb} KB, ${date})`);
                }
              }
              lines.push('');
            }

            if (section === 'references' || section === 'all') {
              const refs = await groupSharedService.listReferences(workspaceId, groupId);
              lines.push(`=== 引用项（共 ${refs.length} 个） ===`);
              if (refs.length === 0) {
                lines.push('暂无引用文件');
              } else {
                for (const ref of refs) {
                  if (ref.type === 'file') {
                    const display = ref.label || ref.path;
                    lines.push(`- ${display} (refId: ${ref.id})`);
                    lines.push(`  路径: ${ref.path}`);
                  }
                }
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

      tool(
        'ReadGroupFile',
        '读取共享区文件内容。读原生项提供 relPath，读引用项提供 refId，两者互斥，至少传一个。',
        {
          relPath: z.string().optional().describe('原生项相对路径（与 refId 互斥）'),
          refId: z.string().optional().describe('引用项 ID（与 relPath 互斥）'),
        },
        async (args) => {
          try {
            if (!args.relPath && !args.refId) {
              return {
                content: [{ type: 'text' as const, text: '参数错误：relPath 和 refId 至少提供一个' }],
                isError: true,
              };
            }
            let content: string;
            if (args.relPath) {
              content = await groupSharedService.readNativeFile(workspaceId, groupId, args.relPath);
            } else {
              content = await groupSharedService.readReferencedFile(workspaceId, groupId, args.refId!);
            }
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

      tool(
        'WriteGroupFile',
        '写入共享区原生文件（覆盖已有内容）。引用项只读，不可通过此工具写入。',
        {
          relPath: z.string().describe('共享区相对路径，例如 notes.md 或 ideas/2026-06-25.md'),
          content: z.string().describe('完整文件内容（UTF-8 文本）'),
        },
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

      tool(
        'AddGroupReference',
        '把工作区内的某个文件添加为当前组的引用项。路径可以是绝对路径或相对工作区根的路径。',
        {
          path: z.string().describe('workspace 内文件路径（绝对或相对 workspace 根）'),
          label: z.string().optional().describe('可选显示标签'),
        },
        async (args) => {
          try {
            const ref = await groupService.addReference(workspaceId, groupId, {
              type: 'file',
              path: args.path,
              label: args.label,
            });
            const display = args.label || args.path;
            return {
              content: [{ type: 'text' as const, text: `✅ 已添加引用：${display}（refId: ${ref.id}）` }],
            };
          } catch (error) {
            return {
              content: [{ type: 'text' as const, text: `添加引用失败: ${error}` }],
              isError: true,
            };
          }
        },
      ),
    ],
  });
}
