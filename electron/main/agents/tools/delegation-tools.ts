import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import * as bridge from '../delegation-bridge.js';
import { registerTools } from './tool-registry.js';
import type { DeliveryResult } from '../../types.js';

registerTools([
  { name: 'DelegateTo', description: '派出子会话执行任务并指定交付路径', server: 'dogear-delegation', category: 'other' },
  { name: 'WaitForDeliveries', description: '等待一批子会话交付完成', server: 'dogear-delegation', category: 'other' },
  { name: 'DelegateBatch', description: '原子批量派出多个子会话（outputPath 冲突时整批回滚）', server: 'dogear-delegation', category: 'other' },
  { name: 'ListChildren', description: '列出当前主会话派出的所有子会话状态', server: 'dogear-delegation', category: 'other' },
  { name: 'StopChild', description: '主动停止某个仍在跑的子会话', server: 'dogear-delegation', category: 'other' },
  { name: 'SendMessageToChild', description: '向运行中的子会话追加一条消息（下一轮回应处理）', server: 'dogear-delegation', category: 'other' },
  { name: 'ReplyToChild', description: '回复子会话挂起的 AskParent 反问', server: 'dogear-delegation', category: 'other' },
]);

function statusEmoji(status: string): string {
  switch (status) {
    case 'running':     return '🏃';
    case 'done':        return '✅';
    case 'timeout':     return '⏱';
    case 'failed':      return '❌';
    case 'cancelled':   return '🛑';
    case 'no_delivery': return '⚠️';
    default:            return '·';
  }
}

function formatRelative(now: number, ts?: number): string {
  if (!ts) return '';
  const delta = Math.max(0, now - ts);
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s 前`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}min 前`;
  return `${Math.floor(delta / 3_600_000)}h 前`;
}

export function createDelegationTools(opts: {
  workspaceId: string;
  groupId: string;
  parentConversationId: string;
}) {
  return createSdkMcpServer({
    name: 'dogear-delegation',
    version: '1.0.0',
    tools: [
      tool(
        'DelegateTo',
        '派出一个子会话执行任务，它会把交付物写到指定 outputPath。立即返回子会话 ID，需用 WaitForDeliveries 等齐结果。outputPath 不可与其它在跑的子会话冲突。',
        {
          task: z.string().min(1).describe('委派给子会话的任务描述（自然语言）'),
          outputPath: z.string().min(1).describe('子会话必须把交付物写到共享区的这个相对路径（如 hello.md）'),
          title: z.string().optional().describe('子会话标题；缺省由 bridge 生成'),
        },
        async (args) => {
          try {
            const snapshot = await bridge.startChild({
              parentConversationId: opts.parentConversationId,
              workspaceId: opts.workspaceId,
              groupId: opts.groupId,
              spec: { task: args.task, outputPath: args.outputPath, title: args.title },
            });
            const text = [
              `✅ 已派出子会话 ${snapshot.childId}（${snapshot.title}）→ 交付路径 ${args.outputPath}`,
              '',
              `现在用 WaitForDeliveries([${JSON.stringify(snapshot.childId)}]) 等齐结果。`,
            ].join('\n');
            return { content: [{ type: 'text' as const, text }] };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: 'text' as const, text: `派出子会话失败: ${message}` }],
              isError: true,
            };
          }
        },
      ),

      tool(
        'WaitForDeliveries',
        '等待一批子会话交付完成（或超时）。返回每个子会话的状态与摘要；交付物正文可用 ReadGroupFile 按 outputPath 读取。',
        {
          childIds: z.array(z.string()).min(1).describe('要等的子会话 ID 列表'),
          timeoutMs: z.number().int().positive().optional().describe('整批超时毫秒数；缺省走 settings.subAgent.timeoutMinutes'),
        },
        async (args) => {
          try {
            const results: DeliveryResult[] = await bridge.waitFor(
              opts.parentConversationId,
              args.childIds,
              args.timeoutMs,
            );

            const done = results.filter(r => r.status === 'done').length;
            const timedOut = results.filter(r => r.status === 'timeout').length;
            const failed = results.length - done - timedOut;

            const lines: string[] = [
              `📦 交付汇总（共 ${results.length} 个：✅ ${done} · ⏱ ${timedOut} · ❌ ${failed}）`,
              '',
            ];

            for (const r of results) {
              let emoji: string;
              switch (r.status) {
                case 'done':        emoji = '✅'; break;
                case 'timeout':     emoji = '⏱'; break;
                case 'failed':      emoji = '❌'; break;
                case 'cancelled':   emoji = '🛑'; break;
                case 'no_delivery': emoji = '⚠️'; break;
                default:            emoji = '❌';
              }
              lines.push(`${emoji} ${r.childId}（${r.title}）→ ${r.outputPath}`);
              if (r.status === 'done' && r.summary) {
                lines.push(`   summary: ${r.summary}`);
              } else if (r.status !== 'done') {
                lines.push(`   status: ${r.status}`);
                if (r.errorMessage) {
                  lines.push(`   errorMessage: ${r.errorMessage}`);
                }
              }
              lines.push('');
            }

            return { content: [{ type: 'text' as const, text: lines.join('\n').trimEnd() }] };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: 'text' as const, text: `等待交付失败: ${message}` }],
              isError: true,
            };
          }
        },
      ),

      tool(
        'DelegateBatch',
        '原子批量派出多个子会话。先一次性 dry-run 校验所有 outputPath 不冲突，任何一个冲突则整批拒绝；全部 ok 才依次拉起。中途任意一个拉起失败将回滚已派出的子会话。',
        {
          items: z.array(z.object({
            task: z.string().min(1).describe('子任务描述'),
            outputPath: z.string().min(1).describe('交付物在共享区的相对路径'),
            title: z.string().optional().describe('子会话标题；缺省自动生成'),
          })).min(1).describe('批量派遣条目列表'),
        },
        async (args) => {
          try {
            const preview = await bridge.previewClaim(
              opts.workspaceId,
              opts.groupId,
              args.items.map(it => it.outputPath),
            );
            if (!preview.ok) {
              const lines = ['❌ 批量派遣未执行：outputPath 冲突', ''];
              for (const c of preview.conflicts) {
                const reason = c.reason === 'file_exists'
                  ? '文件已存在'
                  : `已被 ${c.holderChildId ?? '其他子会话'} 占用`;
                lines.push(`- ${c.relPath} → ${reason}`);
              }
              return { content: [{ type: 'text' as const, text: lines.join('\n') }], isError: true };
            }

            const started: { childId: string; outputPath: string; title: string }[] = [];
            for (let i = 0; i < args.items.length; i++) {
              const item = args.items[i];
              try {
                const snapshot = await bridge.startChild({
                  parentConversationId: opts.parentConversationId,
                  workspaceId: opts.workspaceId,
                  groupId: opts.groupId,
                  spec: { task: item.task, outputPath: item.outputPath, title: item.title },
                });
                started.push({ childId: snapshot.childId, outputPath: snapshot.outputPath, title: snapshot.title });
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                await Promise.all(started.map(s => bridge.stopChild(s.childId, 'cancelled').catch(() => { /* ignore */ })));
                return {
                  content: [{ type: 'text' as const, text: `批量派遣中途失败（item[${i}] "${item.outputPath}"）：${message}\n已回滚 ${started.length} 个先前派出的子会话。` }],
                  isError: true,
                };
              }
            }

            const lines = [`✅ 已批量派出 ${started.length} 个子会话`, ''];
            for (const s of started) {
              lines.push(`- ${s.childId}（${s.title}）→ ${s.outputPath}`);
            }
            lines.push('', `现在用 WaitForDeliveries([${started.map(s => JSON.stringify(s.childId)).join(', ')}]) 等齐结果。`);
            return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: 'text' as const, text: `批量派遣失败: ${message}` }],
              isError: true,
            };
          }
        },
      ),

      tool(
        'ListChildren',
        '列出当前主会话派出的所有子会话及其状态。用来诊断"我派了几个、各跑到哪一步了"。',
        {},
        async () => {
          const children = bridge.getChildrenByParent(opts.parentConversationId);
          if (children.length === 0) {
            return { content: [{ type: 'text' as const, text: '（当前主会话还没派出任何子会话）' }] };
          }
          const counts: Record<string, number> = {};
          for (const c of children) counts[c.status] = (counts[c.status] ?? 0) + 1;
          const now = Date.now();
          const lines = [`📋 子会话列表（共 ${children.length}）`, ''];
          for (const c of children) {
            lines.push(`${statusEmoji(c.status)} ${c.childId} ${c.title} — ${c.outputPath} (${formatRelative(now, c.startedAt)})`);
          }
          const summary = Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(' / ');
          lines.push('', `小计：${summary}`);
          return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
        },
      ),

      tool(
        'StopChild',
        '主动停止指定子会话（仅对 running 有效）。停止后子会话状态变为 cancelled，相关 WaitForDeliveries 会随之 resolve。',
        {
          childId: z.string().min(1).describe('要停止的子会话 ID'),
        },
        async (args) => {
          const snapshot = bridge.getChildSnapshot(args.childId);
          if (!snapshot) {
            return { content: [{ type: 'text' as const, text: `子会话 ${args.childId} 不存在或已被清理` }], isError: true };
          }
          if (snapshot.parentConversationId !== opts.parentConversationId) {
            return { content: [{ type: 'text' as const, text: `子会话 ${args.childId} 不属于当前主会话，无法操作` }], isError: true };
          }
          if (snapshot.status !== 'running') {
            return { content: [{ type: 'text' as const, text: `⚠ 子会话 ${args.childId} 已是 ${snapshot.status} 状态，无需停止` }] };
          }
          try {
            await bridge.stopChild(args.childId, 'cancelled');
            return { content: [{ type: 'text' as const, text: `✅ 已停止 ${args.childId}（${snapshot.title}）` }] };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text' as const, text: `停止失败: ${message}` }], isError: true };
          }
        },
      ),

      tool(
        'ReplyToChild',
        '回复子会话挂起的 AskParent 反问。仅对当前主会话派出且确实在等回复的子会话有效。',
        {
          childId: z.string().min(1).describe('挂起反问的子会话 ID'),
          answer: z.string().min(1).describe('给子会话的回答'),
        },
        async (args) => {
          const snapshot = bridge.getChildSnapshot(args.childId);
          if (!snapshot) {
            return { content: [{ type: 'text' as const, text: `子会话 ${args.childId} 不存在或已被清理` }], isError: true };
          }
          if (snapshot.parentConversationId !== opts.parentConversationId) {
            return { content: [{ type: 'text' as const, text: `子会话 ${args.childId} 不属于当前主会话，无法操作` }], isError: true };
          }
          try {
            bridge.replyToChild(args.childId, args.answer);
            return { content: [{ type: 'text' as const, text: `✅ 已回复 ${args.childId}（${snapshot.title}）` }] };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text' as const, text: `回复失败：${message}` }], isError: true };
          }
        },
      ),

      tool(
        'SendMessageToChild',
        '向运行中的子会话追加一条消息（push 到它的 pendingMessages 队列，下一轮回应处理）。常用于补充信息、修正方向或回应子会话的进度。',
        {
          childId: z.string().min(1).describe('目标子会话 ID'),
          message: z.string().min(1).describe('要追加的消息内容'),
        },
        async (args) => {
          const snapshot = bridge.getChildSnapshot(args.childId);
          if (!snapshot) {
            return { content: [{ type: 'text' as const, text: `子会话 ${args.childId} 不存在或已被清理` }], isError: true };
          }
          if (snapshot.parentConversationId !== opts.parentConversationId) {
            return { content: [{ type: 'text' as const, text: `子会话 ${args.childId} 不属于当前主会话，无法操作` }], isError: true };
          }
          if (snapshot.status !== 'running') {
            return { content: [{ type: 'text' as const, text: `⚠ 子会话 ${args.childId} 已是 ${snapshot.status} 状态，无法追加消息` }], isError: true };
          }
          try {
            await bridge.sendMessageToChild(args.childId, args.message);
            return { content: [{ type: 'text' as const, text: `✅ 已追加消息到 ${args.childId}（子会话将在下一轮回应中处理）` }] };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text' as const, text: `追加消息失败: ${message}` }], isError: true };
          }
        },
      ),
    ],
  });
}
