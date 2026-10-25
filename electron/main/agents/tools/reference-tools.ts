/**
 * 跨会话检索 + 组协作工具
 *
 * dogear-history（跨会话检索，常驻组）：绑定工作区即注册，不可关，与基础工具同性质——通用检索是基础设施。
 * - dogear__ListTopics：列工作区全部话题（零模型纯本地 IO，跨话题检索入口；可传 workspaceId 列其他工作区）
 * - dogear__SearchSessions：跨会话与共享文件检索（多词 OR → 结论文件命中 + 过程会话命中，零模型本地扫描）
 * - dogear__ReadReferenceSession：读任意 sessionId 的去噪原文（可尾切 / 区间切）
 *
 * dogear-sibling（兄弟会话组）：归 Agent 协作包。
 * - dogear__ListSiblingSessions：列组内兄弟会话（子会话排除派自己的父会话；主会话无父会话，列全部同组非子会话）
 */
import fs from 'node:fs/promises';
import { z } from 'zod';
import { readCleanTranscript } from '../pi-session/transcript-adapter.js';
import { getPiSessionRepository } from '../pi-session/pi-session-repository.js';
import { searchSessions, fmtTs } from '../../services/session-search-service.js';
import * as conversationService from '../../services/conversation-service.js';
import { listGroups } from '../../services/group-service.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';


const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;

/** 跨会话检索常驻组：只依赖 workspaceId，不需要 groupId / 会话身份 */
export function createHistorySearchToolDefs(workspaceId: string): ToolDef[] {
  return [
    defineTool(
      'dogear__ListTopics',
      '列出工作区全部话题',
      '列出指定工作区的全部话题（含已归档）：每个话题一行 groupId + 话题一句话 + 更新时间 + 主会话数 + 归档状态。零模型纯本地读取，用于跨话题检索时先定位目标话题，再用 dogear__ReadReferenceSession 深挖。不传 workspaceId 时列当前绑定工作区；协助用户把会话移入其他工作区时，传入候选工作区 id 列出近期话题，结合话题标题与更新时间给出归置建议（你只能建议，移入操作由用户点 UI 确认）。',
      z.object({
        workspaceId: z.string().optional().describe('目标工作区 id；缺省为当前会话绑定的工作区'),
      }),
      async (args) => {
        try {
          const wsId = args.workspaceId?.trim() || workspaceId;
          const [groups, convs] = await Promise.all([
            listGroups(wsId),
            conversationService.getByWorkspaceId(wsId, { includeArchived: true }),
          ]);
          const mainConvCount = new Map<string, number>();
          for (const c of convs) {
            if (c.groupId && c.role !== 'sub') {
              mainConvCount.set(c.groupId, (mainConvCount.get(c.groupId) ?? 0) + 1);
            }
          }
          const rows: Array<{ groupId: string; label: string; updatedAt: string; mainConvs: number; archived: boolean; sortTs: number }> = [];
          for (const g of groups) {
            rows.push({
              groupId: g.id,
              label: g.title?.trim() || '(未命名话题)',
              updatedAt: fmtTs(new Date(g.updatedAt).toISOString()),
              mainConvs: mainConvCount.get(g.id) ?? 0,
              archived: g.archivedAt !== undefined,
              sortTs: g.updatedAt,
            });
          }
          rows.sort((a, b) => (a.archived === b.archived ? b.sortTs - a.sortTs : a.archived ? 1 : -1));
          if (!rows.length) {
            return { content: [{ type: 'text' as const, text: `(工作区 ${wsId} 暂无话题)` }] };
          }
          const lines = rows.map((r) =>
            `- groupId=${r.groupId} · ${r.label} · 更新 ${r.updatedAt} · 主会话 ${r.mainConvs}${r.archived ? ' · 已归档' : ''}`,
          );
          return {
            content: [{ type: 'text' as const, text: `共 ${rows.length} 个话题（workspaceId=${wsId}，活跃在前、按更新时间倒序）：\n${lines.join('\n')}` }],
          };
        } catch (e) {
          return {
            content: [{ type: 'text' as const, text: `列话题失败: ${e instanceof Error ? e.message : String(e)}` }],
            isError: true,
          };
        }
      },
    ),

    defineTool(
      'dogear__SearchSessions',
      '跨会话与共享文件检索',
      `跨会话与共享区文件检索：按多个关键词扫描工作区会话原文（只搜 user/assistant 讨论文本，不含工具输出与引用块）与话题共享区文件，返回「📄 结论文件命中」（附内容，读完即得）+「💬 过程会话命中」（片段 + 结论预览）。检索策略：\n- queries 一次传 1~5 个候选词，任一命中即返回：同义词、原话变体、中英文写法一次传齐，如 ["检索预算","扫描上限","budget"]\n- 优先用讨论中可能出现过的原文字面词：文件名、报错信息、专有名词、代码标识符\n- 0 命中时换更短的词根或更多同义词重试，不要直接放弃\n- 📄 文件命中是结论沉淀（交付物/报告）：内容直接附上，命中带 sourceSessionId 时可用 dogear__ReadReferenceSession 深挖讨论过程\n- 💬 会话命中是过程原文：按片段与结论预览判断相关性，需要细节用 dogear__ReadReferenceSession(sessionId)\n- 「上周」「昨天」等时间词自行换算成日期传 after/before\n受扫描预算限制（最多 150 个文件 / 200MB / 10 秒，按 主会话 → 共享文件 → 子会话 优先扫描），未扫完时返回如实覆盖率，此时换更精确关键词或传 groupId 缩小范围再搜。`,
      z.object({
        queries: z.array(z.string().min(2)).min(1).max(5).describe('检索关键词 1~5 个，任一命中即候选（ASCII 大小写不敏感，中文按原样子串匹配；至少 2 字符/词）'),
        groupId: z.string().optional().describe('限定只在指定话题组内检索（groupId 从 dogear__ListTopics 获取）'),
        limit: z.number().int().min(1).max(100).optional().describe('会话命中数上限，默认 30'),
        after: z.string().optional().describe('只返回该时间之后（不含）更新的内容，ISO 或 YYYY-MM-DD'),
        before: z.string().optional().describe('只返回该时间之前（不含）更新的内容，ISO 或 YYYY-MM-DD'),
      }),
      async (args) => {
        try {
          const r = await searchSessions(workspaceId, args);
          const q = `queries=[${r.queries.map((x) => `"${x}"`).join(', ')}]`;
          const coverage = r.stoppedBy === 'completed'
            ? `已扫 ${r.scanned}/${r.totalCandidates} 个候选源`
            : `已按 主会话→共享文件→子会话 优先扫描 ${r.scanned}/${r.totalCandidates} 个候选源（${{ files: '文件数', bytes: '容量', time: '时长' }[r.stoppedBy]}预算触顶），可用更精确关键词或 groupId 缩小范围`;
          if (!r.fileHits.length && !r.sessionHits.length) {
            return {
              content: [{ type: 'text' as const, text: `${q} 未命中任何文件或会话（${coverage}，耗时 ${r.elapsedMs}ms）。建议换更短的词根或更同义的词重试，也可先用 dogear__ListTopics 定位话题再传 groupId 限定范围。` }],
            };
          }
          const lines: string[] = [`${q} 命中共享文件 ${r.fileHits.length} 个、会话 ${r.sessionHits.length} 个（${coverage}，耗时 ${r.elapsedMs}ms）`];
          if (r.fileHits.length) {
            lines.push('', '📄 结论文件命中（内容如下，读完即得）：');
            r.fileHits.forEach((f, i) => {
              lines.push(`${i + 1}. ${f.relPath} · ${f.groupTitle} · groupId=${f.groupId} · 更新 ${fmtTs(f.mtime)} · matched=[${f.matchedTerms.join(', ')}]`);
              lines.push(`   片段：${f.snippet}`);
              if (f.sourceSessionId) lines.push(`   源会话 sessionId=${f.sourceSessionId}（可 dogear__ReadReferenceSession 深挖过程）`);
              lines.push(`--- 文件内容${f.truncated ? '（超长，截断至前 8K 字符）' : ''} ---`);
              lines.push(f.content);
              lines.push('--- 内容结束 ---');
            });
          }
          if (r.sessionHits.length) {
            lines.push('', '💬 过程会话命中：');
            r.sessionHits.forEach((hit, i) => {
              lines.push(`${i + 1}. 「${hit.title}」 convId=${hit.conversationId} sessionId=${hit.sessionId} 更新 ${fmtTs(hit.updatedAt)}${hit.groupId ? ` groupId=${hit.groupId}` : ''}${hit.archived ? ' · 已归档' : ''}${hit.titleMatched ? ' · 标题命中' : ''} · matched=[${hit.matchedTerms.join(', ')}]`);
              for (const m of hit.matches) lines.push(`   [${m.role} ${fmtTs(m.timestamp)}] ${m.snippet}`);
              if (hit.tailPreview) lines.push(`   结论预览：${hit.tailPreview}`);
            });
          }
          return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
        } catch (e) {
          return {
            content: [{ type: 'text' as const, text: `跨会话检索失败: ${e instanceof Error ? e.message : String(e)}` }],
            isError: true,
          };
        }
      },
    ),

    defineTool(
      'dogear__ReadReferenceSession',
      '读取会话去噪原文',
      '读指定会话的去噪原文（可尾切或区间切）。仅用于需要查看其他会话的完整对话内容时。默认 detail=clean：只含 user/assistant 文本与工具调用骨架，适合快速了解会话讲了什么；排查任务运行过程、需要复现 agent 当时看到/执行了什么时传 detail="full"（完整工具调用参数 + 每条执行结果文本前 300 字）。',
      z.object({
        sessionId: z.string().describe('目标会话的 SDK sessionId'),
        workspaceId: z.string().optional().describe('目标会话所属工作区 id；引用跨工作区会话时从 <conversation> 标签取'),
        tail: z.number().int().positive().optional().describe('返回最后 N 条；不传则返回全量'),
        rangeStart: z.number().int().nonnegative().optional().describe('区间起始（含），与 rangeEnd 配合使用；不传则不切区间'),
        rangeEnd: z.number().int().nonnegative().optional().describe('区间结束（不含），与 rangeStart 配合使用'),
        detail: z.enum(['clean', 'full']).optional().describe('输出保真度：clean（默认）快速了解内容；full 保留完整工具调用参数与执行结果摘要，排查运行过程时用'),
      }),
      async (args) => {
        const range = (args.rangeStart != null && args.rangeEnd != null)
          ? [args.rangeStart, args.rangeEnd] as [number, number]
          : undefined;
        const r = await readCleanTranscript(args.workspaceId ?? workspaceId, args.sessionId, {
          tail: args.tail,
          range,
          detail: args.detail,
        });
        if (!r.ok) {
          return {
            content: [{ type: 'text' as const, text: `读会话失败: ${r.error}` }],
            isError: true,
          };
        }
        return {
          content: [{
            type: 'text' as const,
            text: `sessionId=${args.sessionId} detail=${args.detail ?? 'clean'} count=${r.count} totalCount=${r.totalCount} lastTimestamp=${r.lastTimestamp}\n\n${r.text}`,
          }],
        };
      },
    ),
  ];
}

export interface ReferenceToolsOpts {
  workspaceId: string;
  groupId: string;
  /** 派出这个子会话的父会话 conversationId，用于从兄弟列表里排除。主会话没有父会话 */
  parentConversationId?: string;
}

export function createSiblingToolDefs(opts: ReferenceToolsOpts): ToolDef[] {
  const { workspaceId, groupId, parentConversationId } = opts;

  return [
    defineTool(
      'dogear__ListSiblingSessions',
      '列出组内兄弟会话',
      '列出当前会话组内的兄弟会话（不含父/子会话和已归档）。仅用于需要了解组内还有哪些活跃会话时。',
      z.object({}),
      async () => {
        try {
          const parentSessionId = parentConversationId
            ? (await conversationService.getById(workspaceId, parentConversationId))?.sessionId ?? null
            : null;

          const allConvs = await conversationService.getByWorkspaceId(workspaceId);
          const siblings = allConvs.filter((c) =>
            c.groupId === groupId
            && c.role !== 'sub'
            && c.id !== parentConversationId
            && !!c.sessionId,
          );

          const now = Date.now();
          const rows: string[] = [];
          for (const c of siblings) {
            const sid = c.sessionId!;
            if (sid === parentSessionId) continue; // 兜底防御
            let mtime = 0;
            try {
              const sessionPath = await getPiSessionRepository().getSessionPath(workspaceId, sid);
              const stat = await fs.stat(sessionPath);
              mtime = stat.mtimeMs;
            } catch { /* session 不存在，视为无活动 */ }
            const isActive = mtime > 0 && now - mtime < ACTIVE_THRESHOLD_MS;
            const lastActivity = mtime ? new Date(mtime).toISOString() : '(未知)';
            rows.push(
              `- sessionId=${sid} · title=${c.title} · lastActivity=${lastActivity}`
                + ` · isActive=${isActive}`,
            );
          }

          const text = rows.length
            ? `本组共 ${rows.length} 个兄弟会话（groupId=${groupId}）：\n${rows.join('\n')}`
            : `(本组当前无其他兄弟会话，groupId=${groupId})`;
          return { content: [{ type: 'text' as const, text }] };
        } catch (e) {
          return {
            content: [{
              type: 'text' as const,
              text: `列兄弟会话失败: ${e instanceof Error ? e.message : String(e)}`,
            }],
            isError: true,
          };
        }
      },
    ),
  ];
}

registerToolGroup({
  server: 'dogear-history',
  label: '跨会话检索',
  create: createHistorySearchToolDefs,
  placeholder: [''],
});

registerToolGroup({
  server: 'dogear-sibling',
  label: '兄弟会话',
  create: createSiblingToolDefs,
  placeholder: [{ workspaceId: '', groupId: '' }],
});
