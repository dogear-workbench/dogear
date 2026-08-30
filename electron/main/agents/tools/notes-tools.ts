import { z } from 'zod';
import * as notesService from '../../services/notes/notes-service.js';
import * as conversationService from '../../services/conversation-service.js';
import type { NoteMeta, NoteSource } from '../../services/notes/note-types.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';

const LINK_SCHEMA = z
  .string()
  .regex(/^(article|stock|plan):.+/)
  .describe('引用格式：article:<文章id> / stock:<股票代码> / plan:<plan文档路径>');

function errorResult(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true as const };
}

function metaHeader(note: NoteMeta) {
  const rows = [
    `🗂 卡片 ${note.id}`,
    `标题: ${note.title}`,
    `创建: ${new Date(note.created).toLocaleString('zh-CN')} | 更新: ${new Date(note.updated).toLocaleString('zh-CN')}`,
  ];
  if (note.tags.length > 0) rows.push(`标签: ${note.tags.join(' / ')}`);
  if (note.links.length > 0) rows.push(`引用: ${note.links.join('、')}`);
  if (note.source) rows.push(`来源: 会话「${note.source.title || '未命名'}」（${note.source.conversationId}，${new Date(note.source.date).toLocaleString('zh-CN')}）`);
  return rows.join('\n');
}

function notFound(noteId: string) {
  return errorResult(`未找到卡片 ${noteId}，可先用 dogear__SearchNotes 确认卡片 ID。`);
}

/** 挂载上下文：存在时 CreateNote 自动写入来源身份证，agent 无需也不应传会话标识 */
export interface NotesToolSourceContext {
  workspaceId: string;
  conversationId: string;
}

/** 查当前会话标题快照，组装 source；会话已不存在时返回 undefined（不写来源） */
async function resolveSource(ctx: NotesToolSourceContext): Promise<NoteSource | undefined> {
  try {
    const conv = await conversationService.getById(ctx.workspaceId, ctx.conversationId);
    if (!conv) return undefined;
    return {
      conversationId: ctx.conversationId,
      title: conv.title,
      date: new Date().toISOString(),
    };
  } catch {
    return undefined;
  }
}

/**
 * 创建笔记卡片工具中立定义（ToolDef[]）
 * @param workspacePath - 工作区路径
 * @param sourceContext - 来源会话上下文，主会话挂载点传入
 */
export function createNotesToolDefs(workspacePath: string, sourceContext?: NotesToolSourceContext): ToolDef[] {
  return [
    defineTool(
      'dogear__CreateNote',
      '创建笔记卡片',
      '在工作区创建一张新的 Markdown 笔记卡片。\n' +
        '正文首行会成为卡片标题。',
      z.object({
        content: z.string().min(1).describe('卡片正文（Markdown），首行会成为卡片标题'),
        tags: z.array(z.string().min(1)).optional().describe('标签列表'),
        links: z.array(LINK_SCHEMA).optional().describe('引用列表'),
      }),
      async (args) => {
        try {
          const source = sourceContext ? await resolveSource(sourceContext) : undefined;
          const note = await notesService.createNote(workspacePath, {
            content: args.content,
            tags: args.tags,
            links: args.links,
            source,
          });
          return {
            content: [{
              type: 'text' as const,
              text: `✅ 已创建卡片 ${note.id}（${note.file}）\n${metaHeader(note)}`,
            }],
          };
        } catch (error) {
          return errorResult(`创建卡片失败: ${error}`);
        }
      },
    ),

    defineTool(
      'dogear__GetNote',
      '读取笔记卡片',
      '读取指定卡片的元数据（frontmatter：标签/引用）和完整正文。',
      z.object({
        noteId: z.string().min(1).describe('卡片 ID'),
      }),
      async (args) => {
        try {
          const note = await notesService.getNote(workspacePath, args.noteId);
          if (!note) return notFound(args.noteId);
          return {
            content: [{
              type: 'text' as const,
              text: `${metaHeader(note)}\n\n--- 正文 ---\n\n${note.content}`,
            }],
          };
        } catch (error) {
          return errorResult(`读取卡片失败: ${error}`);
        }
      },
    ),

    defineTool(
      'dogear__SearchNotes',
      '搜索笔记卡片',
      '按关键词或标签搜索卡片（仅元数据，不含正文）；两个条件都省略时列出全部卡片（按更新时间倒序）。',
      z.object({
        query: z.string().optional().describe('关键词，不区分大小写匹配标题与正文'),
        tag: z.string().optional().describe('按标签精确过滤'),
      }),
      async (args) => {
        try {
          const notes = await notesService.searchNotes(workspacePath, args);
          if (notes.length === 0) {
            return { content: [{ type: 'text' as const, text: '未找到匹配的卡片。' }] };
          }
          const list = notes.map((n) => {
            return `${n.id} 《${n.title}》\n` +
              `   更新: ${new Date(n.updated).toLocaleString('zh-CN')}` +
              ` | 标签: ${n.tags.join('/') || '无'}`;
          }).join('\n');
          return {
            content: [{
              type: 'text' as const,
              text: `📋 找到 ${notes.length} 张卡片：\n\n${list}\n\n用 dogear__GetNote 查看卡片全文。`,
            }],
          };
        } catch (error) {
          return errorResult(`搜索卡片失败: ${error}`);
        }
      },
    ),

    defineTool(
      'dogear__AppendNote',
      '追加卡片正文',
      '在指定卡片正文末尾追加一段文本（Markdown），用于写执行结果摘要等。',
      z.object({
        noteId: z.string().min(1).describe('卡片 ID'),
        content: z.string().min(1).describe('要追加到正文末尾的文本（Markdown）'),
      }),
      async (args) => {
        try {
          const note = await notesService.appendNote(workspacePath, args.noteId, args.content);
          if (!note) return notFound(args.noteId);
          return {
            content: [{
              type: 'text' as const,
              text: `✅ 已追加到卡片 ${note.id}（《${note.title}》）`,
            }],
          };
        } catch (error) {
          return errorResult(`追加正文失败: ${error}`);
        }
      },
    ),

    defineTool(
      'dogear__UpdateNote',
      '更新笔记卡片',
      '更新卡片的内容、标签或引用。tags/links 都是整体替换。',
      z.object({
        noteId: z.string().min(1).describe('卡片 ID'),
        patch: z.object({
          content: z.string().optional().describe('整体替换正文（首行会成为新标题）'),
          tags: z.array(z.string().min(1)).optional().describe('整体替换标签列表'),
          links: z.array(LINK_SCHEMA).optional().describe('整体替换引用列表'),
        }).describe('要更新的字段，未给出的字段保持不变'),
      }),
      async (args) => {
        const { patch } = args;
        const hasField = patch.content !== undefined || patch.tags !== undefined ||
          patch.links !== undefined;
        if (!hasField) {
          return errorResult('patch 为空：至少要提供 content / tags / links 之一。');
        }
        try {
          const note = await notesService.updateNote(workspacePath, args.noteId, patch);
          if (!note) return notFound(args.noteId);
          return {
            content: [{
              type: 'text' as const,
              text: `✅ 已更新卡片 ${note.id}\n${metaHeader(note)}`,
            }],
          };
        } catch (error) {
          return errorResult(`更新卡片失败: ${error}`);
        }
      },
    ),

    defineTool(
      'dogear__DeleteNote',
      '删除笔记卡片',
      '将指定卡片移入回收站（软删除）。',
      z.object({
        noteId: z.string().min(1).describe('卡片 ID'),
      }),
      async (args) => {
        try {
          const ok = await notesService.removeNote(workspacePath, args.noteId);
          if (!ok) return notFound(args.noteId);
          return {
            content: [{ type: 'text' as const, text: `🗑 已将卡片 ${args.noteId} 移入回收站。` }],
          };
        } catch (error) {
          return errorResult(`删除卡片失败: ${error}`);
        }
      },
    ),
  ];
}

registerToolGroup({
  server: 'dogear-notes',
  label: '笔记卡片',
  create: createNotesToolDefs,
  placeholder: [''],
});
