/**
 * Agent 协作模式通信工具（dogear-delegation MCP server，Step 2 重构）
 *
 * 语义从"父子专用"改为"平等会话间协作"：
 * - dogear__CreateSession / dogear__CreateSessionBatch / dogear__StopSession：仅挂主会话（role='main'）
 * - dogear__SendMessage / dogear__WaitForMessage / dogear__ListLinkedSessions：主/子会话都挂，靠工具子集防孙子
 *   （子会话没有 dogear__CreateSession，天然不能再往下派）
 *
 * 所有跨会话通信都必须先过 hasDirectContractChannel 校验（服务层，contract-channel-service.ts）。
 */
import { z } from 'zod';
import * as bridge from '../delegation-bridge.js';
import * as conversationService from '../../services/conversation-service.js';
import { loadSettings } from '../../services/settings-service.js';
import { hasDirectContractChannel } from '../../services/contract-channel-service.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';
import { formatTerminalSummary } from '../delegation-terminal.js';


const SEND_MESSAGE_DESC =
  '向与当前会话有直接派出关系的会话发送消息。仅用于与协作会话通信时。';

const WAIT_FOR_MESSAGE_DESC =
  '挂起当前回合，等待指定会话列表中任一方的消息（第一条到达即返回）；不传 fromSessionIds = 等待你派出的所有运行中子会话（子会话不传 = 等待派出你的会话）。仅用于派出子会话后等待其交付或回复时。显式传入的 sessionId 会做契约通道校验，无派出关系的 ID 会立即报错并返回正确清单；免传展开的结果来自运行时快照，不做校验。';

const LIST_LINKED_DESC =
  '列出当前会话所有直接契约通道对方（sessionId、运行状态、交付标记）。判定规则：status=running → 在跑，等它通知即可；status=stopped 且你收到过它的 delivery 消息、或共享区已有其交付文件 → 已完成，不要重派或调起；status=stopped 且无交付 → 可用 dogear__ResumeSession 调起，它会自检进度从中断处续跑。delivered 是本进程运行时视角，应用重启后一律为 false——此时以你的上下文记忆 / 共享区文件为准。';

const RESUME_SESSION_DESC =
  '调起之前派出、当前已停止且未交付的子会话继续执行：保留消息历史，它会自检进度并从中断处续跑。仅用于恢复已停止的子会话时。';

export interface MainDelegationOpts {
  role: 'main';
  workspaceId: string;
  groupId: string;
  /** 当前会话自身的 conversationId */
  conversationId: string;
}

export interface SubDelegationOpts {
  role: 'sub';
  workspaceId: string;
  groupId: string;
  /** 当前会话自身的 conversationId（同时也是 bridge 里的 childId） */
  conversationId: string;
  /** 派出当前会话的会话 conversationId */
  parentConversationId: string;
}

export type DelegationToolsOpts = MainDelegationOpts | SubDelegationOpts;

function errorResult(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true as const };
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function truncateTask(task: string): string {
  const one = task.replace(/\s+/g, ' ').trim();
  return one.length > 60 ? one.slice(0, 60) + '…' : one;
}

export function createDelegationToolDefs(opts: DelegationToolsOpts): ToolDef[] {
  async function resolveOwnConversation() {
    return conversationService.getById(opts.workspaceId, opts.conversationId);
  }

  async function expandWaitTargets(): Promise<{ ok: true; ids: string[] } | { ok: false; message: string }> {
    if (opts.role === 'sub') {
      const parent = await conversationService.getById(opts.workspaceId, opts.parentConversationId);
      if (!parent?.sessionId) {
        return { ok: false, message: '派出你的会话当前不可达（可能尚未初始化或已被删除），无法确定要等待的对象。可稍后重试免传等待，或用 dogear__WaitForMessage 的 fromSessionIds 显式传入目标。' };
      }
      return { ok: true, ids: [parent.sessionId] };
    }
    const children = await bridge.getChildrenByParent(opts.conversationId);
    const runningIds = children.filter((c) => c.status === 'running' && c.sessionId).map((c) => c.sessionId!);
    if (runningIds.length > 0) {
      return { ok: true, ids: runningIds };
    }
    const lines: string[] = ['❌ 没有运行中的直属子会话可等待（不传 fromSessionIds 时等待所有运行中的直属子会话）', ''];
    if (children.length === 0) {
      lines.push('先用 dogear__CreateSession 派出子会话，再免传调用 dogear__WaitForMessage。');
    } else {
      lines.push(`全部子会话状态（共 ${children.length} 个）：`);
      lines.push(...children.map((c) => `- sessionId=${c.sessionId ?? '(尚未就绪，稍后重试)'} · ${c.title} · status=${c.status} · ${c.delivered ? '✅已交付' : '⚠未交付'} · 你派出的`));
      lines.push('', '已交付的不用等；stopped 且未交付的可用 dogear__ResumeSession 调起后继续等待。');
    }
    return { ok: false, message: lines.join('\n') };
  }

  const sharedTools: ToolDef[] = [
    defineTool(
      'dogear__SendMessage',
      '向指定会话发消息',
      SEND_MESSAGE_DESC,
      z.object({
        toSessionId: z.string().min(1).describe('目标会话的 sessionId（通过 dogear__CreateSession 返回值或 dogear__ListLinkedSessions 获取）'),
        message: z.string().min(1).describe('消息内容'),
        options: z.object({
          delivery: z.boolean().optional().describe('标记为正式交付（任务完成通知）'),
        }).optional(),
      }),
      async (args) => {
        const ownConv = await resolveOwnConversation();
        const ownSessionId = ownConv?.sessionId;
        if (!ownSessionId) {
          return errorResult('当前会话尚未完成初始化（无 sessionId），暂时无法发送消息，请稍后重试');
        }
        if (args.toSessionId === ownSessionId) {
          return errorResult('不能向自己发送消息');
        }
        const allowed = await hasDirectContractChannel(ownSessionId, args.toSessionId);
        if (!allowed) {
          return errorResult('当前会话与目标会话之间无契约通道，无法直接通信');
        }
        const target = await conversationService.getBySessionId(args.toSessionId);
        if (!target) {
          return errorResult(`目标会话 ${args.toSessionId} 不存在`);
        }

        const delivery = args.options?.delivery === true;
        const label = delivery ? '交付' : '消息';

        // 若我是被派出的会话，且这是发给派出我的会话的正式交付，同步 bridge 的交付事实（UI/统计依赖它）
        if (opts.role === 'sub' && delivery && target.conv.id === opts.parentConversationId) {
          bridge.markChildDelivered(opts.conversationId);
        }

        const outcome = bridge.deliverMessage({
          toConversationId: target.conv.id,
          fromSessionId: ownSessionId,
          fromLabel: ownConv?.title || '未知会话',
          message: args.message,
          delivery,
        });

        if (outcome === 'target_inactive') {
          // 自动调起判断留在工具层（deliverMessage 保持同步纯投递）：只对「我直接派出的停机子会话」生效
          if (target.conv.contractMetadata?.parentSessionId === ownSessionId) {
            const childId = bridge.getChildIdBySessionId(opts.conversationId, args.toSessionId) ?? target.conv.id;
            const snapshot = bridge.getChildSnapshot(childId);
            if (snapshot && snapshot.status !== 'running') {
              try {
                await bridge.resumeChildAndDeliver(childId, {
                  fromSessionId: ownSessionId,
                  fromLabel: ownConv?.title || '未知会话',
                  message: args.message,
                  delivery,
                });
                return textResult(`✅ 目标会话已停机，已自动调起并送达${label}（${snapshot.title}），消息将作为它复活后的首轮输入`);
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return errorResult(`自动调起停机子会话失败: ${message}`);
              }
            }
          }
          return textResult('⚠ 消息已校验通过，但目标会话当前未在运行（可能已关闭），对方暂时收不到，请稍后重试');
        }
        const via = outcome === 'waiter' ? '（对方正在等待，已直接送达）' : '（已加入对方下一轮输入）';
        return textResult(`✅ 已发送${label}给 ${args.toSessionId} ${via}`);
      },
    ),

    defineTool(
      'dogear__WaitForMessage',
      '等待指定会话的消息',
      WAIT_FOR_MESSAGE_DESC,
      z.object({
        fromSessionIds: z.array(z.string().min(1)).min(1).optional().describe('要等待其消息的会话 sessionId 列表；不传 = 等待你派出的所有运行中子会话'),
        timeoutMs: z.number().int().positive().optional().describe('超时毫秒数；缺省走默认子会话 Profile 的 timeoutMinutes'),
      }),
      async (args) => {
        const ownConv = await resolveOwnConversation();
        const ownSessionId = ownConv?.sessionId;
        if (!ownSessionId) {
          return errorResult('当前会话尚未完成初始化（无 sessionId），暂时无法等待消息，请稍后重试');
        }
        let fromSessionIds = args.fromSessionIds;
        if (!fromSessionIds) {
          const expanded = await expandWaitTargets();
          if (!expanded.ok) {
            return errorResult(expanded.message);
          }
          fromSessionIds = expanded.ids;
        } else {
          const invalidIds: string[] = [];
          for (const id of fromSessionIds) {
            if (!invalidIds.includes(id) && !(await hasDirectContractChannel(ownSessionId, id))) {
              invalidIds.push(id);
            }
          }
          if (invalidIds.length > 0) {
            const lines: string[] = [
              `❌ 以下 fromSessionIds 与当前会话无直接派出关系：${invalidIds.join(', ')}`,
              '',
            ];
            if (opts.role === 'sub') {
              lines.push('你是被派出的子会话，只能等待派出你的会话的消息。');
              const parent = await conversationService.getById(opts.workspaceId, opts.parentConversationId);
              if (parent?.sessionId) {
                lines.push(`共 1 个契约通道：\n- sessionId=${parent.sessionId} · ${parent.title} · 派出你的会话`);
              } else {
                lines.push('派出你的会话当前不可达（可能尚未初始化或已被删除）。');
              }
            } else {
              const children = await bridge.getChildrenByParent(opts.conversationId);
              if (children.length === 0) {
                lines.push('当前会话还没有建立任何契约通道，先用 dogear__CreateSession 派出子会话。');
              } else {
                const listLines = children.map((c) => {
                  const parts = [
                    `sessionId=${c.sessionId ?? '(尚未就绪，稍后重试)'}`,
                    c.title,
                    `status=${c.status}`,
                    c.delivered ? '✅已交付' : '⚠未交付',
                  ];
                  parts.push('你派出的');
                  return `- ${parts.join(' · ')}`;
                });
                lines.push(`全部契约通道（共 ${children.length} 个）：`, ...listLines);
              }
            }
            lines.push('', '请修正 fromSessionIds 后重试（可用 dogear__ListLinkedSessions 查最新清单）。');
            return errorResult(lines.join('\n'));
          }
        }
        const settings = await loadSettings();
        const defaultProfile = settings.subAgent?.profiles?.find((p) => p.id === 'default') ?? settings.subAgent?.profiles?.[0];
        const effectiveTimeoutMs = args.timeoutMs ?? (defaultProfile?.timeoutMinutes ?? 30) * 60_000;
        const result = await bridge.waitForMessage(opts.conversationId, fromSessionIds, effectiveTimeoutMs);
        if (!result) {
          return errorResult(`⏱ 等待超时（${effectiveTimeoutMs}ms），未收到来自 [${fromSessionIds.join(', ')}] 的消息`);
        }
        if (result.terminal) {
          return textResult(`⚠ 子会话终态通知 来自 ${result.fromSessionId}：\n${result.message}\n\n${formatTerminalSummary(result.terminal)}`);
        }
        const label = result.delivery ? '📦 交付' : '📨 消息';
        return textResult(`${label} 来自 ${result.fromSessionId}：\n${result.message}`);
      },
    ),

    defineTool(
      'dogear__ListLinkedSessions',
      '列出契约通道会话',
      LIST_LINKED_DESC,
      z.object({}),
      async () => {
        if (opts.role === 'main') {
          const children = await bridge.getChildrenByParent(opts.conversationId);
          if (children.length === 0) {
            return textResult('（当前会话还没有建立任何契约通道）');
          }
          const lines = children.map((c) => {
            const parts = [
              `sessionId=${c.sessionId ?? '(尚未就绪，稍后重试)'}`,
              c.title,
              `status=${c.status}`,
              c.delivered ? '✅已交付' : '⚠未交付',
            ];
            if (c.outputPath) parts.push(`outputPath=${c.outputPath}`);
            if (c.task) parts.push(`task=${truncateTask(c.task)}`);
            parts.push('你派出的');
            return `- ${parts.join(' · ')}`;
          });
          return textResult(`共 ${children.length} 个契约通道：\n${lines.join('\n')}`);
        }

        const parent = await conversationService.getById(opts.workspaceId, opts.parentConversationId);
        if (!parent?.sessionId) {
          return textResult('（派出你的会话当前不可达，可能尚未初始化或已被删除）');
        }
        return textResult(`共 1 个契约通道：\n- sessionId=${parent.sessionId} · ${parent.title} · 派出你的会话`);
      },
    ),
  ];

  if (opts.role === 'sub') {
    return sharedTools;
  }

  const mainOnlyTools: ToolDef[] = [
    defineTool(
      'dogear__CreateSession',
      '派出子会话执行任务',
      '创建一个子会话来执行独立任务，与当前会话建立双向通信通道。仅用于需要把任务委派给独立会话处理时。',
      z.object({
        task: z.string().min(1).describe('委派给新会话的任务描述（自然语言）'),
        outputPath: z.string().min(1).optional().describe('子会话交付文件写入共享区的相对路径；可省略——省略时为通讯型交付（答案直接放交付消息正文），适合问答、验证类任务'),
        title: z.string().optional().describe('新会话标题；缺省由系统生成'),
        profile: z.string().optional().describe('子会话 Profile 名称或 id；未指定时用默认 Profile'),
        model: z.string().min(1).optional().describe('指定模型 ID（如 gemini-2.5-pro）；不填则按 Profile → 主会话模型的默认逻辑'),
      }),
      async (args) => {
        try {
          const snapshot = await bridge.startChild({
            parentConversationId: opts.conversationId,
            workspaceId: opts.workspaceId,
            groupId: opts.groupId,
            spec: { task: args.task, outputPath: args.outputPath, title: args.title, profile: args.profile, model: args.model },
          });
          const sessionId = await bridge.waitForChildSessionId(snapshot.childId);
          if (!sessionId) {
            return textResult(
              `✅ 已创建新会话「${snapshot.title}」，但它的 sessionId 还没就绪。\n` +
              `稍后用 dogear__ListLinkedSessions 查到 sessionId 后，再用 dogear__SendMessage / dogear__WaitForMessage 与它通信。`,
            );
          }
          const outputHint = args.outputPath ? `→ 建议交付路径 ${args.outputPath}` : '→ 通讯型交付（答案直接放交付消息正文）';
          return textResult(
            `✅ 已创建新会话 ${sessionId}（${snapshot.title}，profile: ${snapshot.profileName}）${outputHint}\n` +
            `用 dogear__SendMessage("${sessionId}", ...) 与它通信；dogear__WaitForMessage(["${sessionId}"]) 等待它交付，或直接 dogear__WaitForMessage() 不传参等待它。`,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(`创建会话失败: ${message}`);
        }
      },
    ),

    defineTool(
      'dogear__CreateSessionBatch',
      '批量派出多个子会话',
      '批量创建多个子会话（原子操作：要么全部成功，要么全部不创建）。仅用于需要同时派出多个互相独立的任务时。',
      z.object({
        items: z.array(z.object({
          task: z.string().min(1).describe('子任务描述'),
          outputPath: z.string().min(1).describe('子会话交付文件写入共享区的相对路径'),
          title: z.string().optional().describe('会话标题；缺省自动生成'),
          profile: z.string().optional().describe('子会话 Profile 名称或 id；未指定时用默认 Profile'),
          model: z.string().min(1).optional().describe('指定模型 ID（如 gemini-2.5-pro）；不填则按 Profile → 主会话模型的默认逻辑'),
        })).min(1).describe('批量创建条目列表'),
      }),
      async (args) => {
        try {
          const preview = await bridge.previewClaim(
            opts.workspaceId,
            opts.groupId,
            args.items.map((it) => it.outputPath),
          );
          if (!preview.ok) {
            const lines = ['❌ 批量创建未执行：outputPath 冲突', ''];
            for (const c of preview.conflicts) {
              const reason = c.reason === 'file_exists'
                ? '文件已存在'
                : `已被 ${c.holderChildId ?? '其他会话'} 占用`;
              lines.push(`- ${c.relPath} → ${reason}`);
            }
            return errorResult(lines.join('\n'));
          }

          const started: { childId: string; outputPath: string; title: string; profileName: string }[] = [];
          for (let i = 0; i < args.items.length; i++) {
            const item = args.items[i];
            try {
              const snapshot = await bridge.startChild({
                parentConversationId: opts.conversationId,
                workspaceId: opts.workspaceId,
                groupId: opts.groupId,
                spec: { task: item.task, outputPath: item.outputPath, title: item.title, profile: item.profile, model: item.model },
              });
              started.push({ childId: snapshot.childId, outputPath: snapshot.outputPath, title: snapshot.title, profileName: snapshot.profileName });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              await Promise.all(started.map((s) => bridge.stopChild(s.childId, 'cancelled').catch(() => { /* ignore */ })));
              return errorResult(
                `批量创建中途失败（item[${i}] "${item.outputPath}"）：${message}\n已回滚 ${started.length} 个先前创建的会话。`,
              );
            }
          }

          const sessionIds = await Promise.all(started.map((s) => bridge.waitForChildSessionId(s.childId)));
          const lines = [`✅ 已批量创建 ${started.length} 个新会话`, ''];
          for (let i = 0; i < started.length; i++) {
            const s = started[i];
            const sid = sessionIds[i];
            lines.push(`- ${sid ?? '(sessionId 尚未就绪)'}（${s.title}，profile: ${s.profileName}）→ ${s.outputPath}`);
          }
          lines.push('', '用 dogear__SendMessage / dogear__WaitForMessage 分别与它们通信（尚未就绪的稍后用 dogear__ListLinkedSessions 补查）。');
          return textResult(lines.join('\n'));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(`批量创建失败: ${message}`);
        }
      },
    ),

    defineTool(
      'dogear__StopSession',
      '停止已派出的会话',
      '停止当前会话直接派出的正在运行的子会话。仅用于需要中止子会话任务时。',
      z.object({
        sessionId: z.string().min(1).describe('要停止的会话 sessionId'),
      }),
      async (args) => {
        const ownConv = await resolveOwnConversation();
        const ownSessionId = ownConv?.sessionId;
        if (!ownSessionId) {
          return errorResult('当前会话尚未完成初始化（无 sessionId），暂时无法操作');
        }
        const target = await conversationService.getBySessionId(args.sessionId);
        if (!target) {
          return errorResult(`会话 ${args.sessionId} 不存在`);
        }
        if (target.conv.contractMetadata?.parentSessionId !== ownSessionId) {
          return errorResult('只能停止由当前会话直接派出的会话');
        }
        const childId = bridge.getChildIdBySessionId(opts.conversationId, args.sessionId) ?? target.conv.id;
        const snapshot = bridge.getChildSnapshot(childId);
        if (!snapshot) {
          return errorResult(`会话 ${args.sessionId} 当前不在运行时跟踪中（可能已结束或应用重启过）`);
        }
        if (snapshot.status !== 'running') {
          return textResult(`⚠ 该会话已是 ${snapshot.status} 状态，无需停止`);
        }
        try {
          await bridge.stopChild(childId, 'cancelled');
          return textResult(`✅ 已停止 ${args.sessionId}（${snapshot.title}）`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(`停止失败: ${message}`);
        }
      },
    ),

    defineTool(
      'dogear__ResumeSession',
      '调起中断的子会话',
      RESUME_SESSION_DESC,
      z.object({
        sessionId: z.string().min(1).describe('要调起的会话 sessionId（通过 dogear__ListLinkedSessions 获取）'),
      }),
      async (args) => {
        const ownConv = await resolveOwnConversation();
        const ownSessionId = ownConv?.sessionId;
        if (!ownSessionId) {
          return errorResult('当前会话尚未完成初始化（无 sessionId），暂时无法操作');
        }
        const target = await conversationService.getBySessionId(args.sessionId);
        if (!target) {
          return errorResult(`会话 ${args.sessionId} 不存在`);
        }
        if (target.conv.contractMetadata?.parentSessionId !== ownSessionId) {
          return errorResult('只能调起由当前会话直接派出的会话');
        }
        const childId = bridge.getChildIdBySessionId(opts.conversationId, args.sessionId) ?? target.conv.id;
        const snapshot = bridge.getChildSnapshot(childId);
        if (!snapshot) {
          return errorResult(`会话 ${args.sessionId} 不在本进程运行时跟踪中（应用重启后跟踪不保留，请先用 dogear__ListLinkedSessions 查）`);
        }
        if (snapshot.status === 'running') {
          return textResult(`⚠ 该会话正在运行中，无需调起（${snapshot.title}）`);
        }
        try {
          await bridge.resumeChild(childId, { reason: '主会话调起' });
          return textResult(`✅ 已调起 ${args.sessionId}（${snapshot.title}），它将检查进度后继续`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(`调起失败: ${message}`);
        }
      },
    ),
  ];

  return [...mainOnlyTools, ...sharedTools];
}

registerToolGroup({
  server: 'dogear-delegation',
  label: 'Agent 协作',
  create: createDelegationToolDefs,
  placeholder: [{ role: 'main', workspaceId: '', groupId: '', conversationId: '' }],
});
