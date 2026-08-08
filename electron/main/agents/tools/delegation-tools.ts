/**
 * Agent 协作模式通信工具（dogear-delegation MCP server，Step 2 重构）
 *
 * 语义从"父子专用"改为"平等会话间协作"：
 * - CreateSession / CreateSessionBatch / StopSession：仅挂主会话（role='main'）
 * - SendMessage / WaitForMessage / ListLinkedSessions：主/子会话都挂，靠工具子集防孙子
 *   （子会话没有 CreateSession，天然不能再往下派）
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


const SEND_MESSAGE_DESC =
  '向已建立契约通道的会话发送消息。目标会话必须与当前会话有直接派出关系（当前会话派出的，或派出当前会话的）。' +
  '可选 options.delivery=true 标记这是一次正式交付（任务完成通知），配合 WaitForMessage 使用。';

const WAIT_FOR_MESSAGE_DESC =
  '挂起当前回合，等待来自指定 sessionId 列表中任意一方的下一条消息（第一条到达即返回，不等齐全部）。' +
  '超时未收到任何消息则返回超时提示。';

const LIST_LINKED_DESC = '列出当前会话所有直接契约通道对方（既包含当前会话派出的，也包含派出当前会话的），用于获取可通信的 sessionId。';

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

export function createDelegationToolDefs(opts: DelegationToolsOpts): ToolDef[] {
  async function resolveOwnConversation() {
    return conversationService.getById(opts.workspaceId, opts.conversationId);
  }

  const sharedTools: ToolDef[] = [
    defineTool(
      'SendMessage',
      '向指定会话发消息',
      SEND_MESSAGE_DESC,
      z.object({
        toSessionId: z.string().min(1).describe('目标会话的 sessionId（通过 CreateSession 返回值或 ListLinkedSessions 获取）'),
        message: z.string().min(1).describe('消息内容'),
        options: z.object({
          delivery: z.boolean().optional().describe('标记为正式交付（任务完成通知），配合 WaitForMessage 使用'),
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

        // 若我是被派出的会话，且这是发给派出我的会话的正式交付，同步 bridge 的状态机（UI/no_delivery 检测依赖它）
        if (opts.role === 'sub' && delivery && target.conv.id === opts.parentConversationId) {
          bridge.markChildDelivered(opts.conversationId, args.message);
        }

        const outcome = bridge.deliverMessage({
          toConversationId: target.conv.id,
          fromSessionId: ownSessionId,
          fromLabel: ownConv?.title || '未知会话',
          message: args.message,
          delivery,
        });

        if (outcome === 'target_inactive') {
          return textResult('⚠ 消息已校验通过，但目标会话当前未在运行（可能已关闭），对方暂时收不到，请稍后重试');
        }
        const label = delivery ? '交付' : '消息';
        const via = outcome === 'waiter' ? '（对方正在等待，已直接送达）' : '（已加入对方下一轮输入）';
        return textResult(`✅ 已发送${label}给 ${args.toSessionId} ${via}`);
      },
    ),

    defineTool(
      'WaitForMessage',
      '等待指定会话的消息',
      WAIT_FOR_MESSAGE_DESC,
      z.object({
        fromSessionIds: z.array(z.string().min(1)).min(1).describe('要等待其消息的会话 sessionId 列表'),
        timeoutMs: z.number().int().positive().optional().describe('超时毫秒数；缺省走 settings.subAgent.timeoutMinutes'),
      }),
      async (args) => {
        const settings = await loadSettings();
        const effectiveTimeoutMs = args.timeoutMs ?? (settings.subAgent?.timeoutMinutes ?? 30) * 60_000;
        const result = await bridge.waitForMessage(opts.conversationId, args.fromSessionIds, effectiveTimeoutMs);
        if (!result) {
          return errorResult(`⏱ 等待超时（${effectiveTimeoutMs}ms），未收到来自 [${args.fromSessionIds.join(', ')}] 的消息`);
        }
        const label = result.delivery ? '📦 交付' : '📨 消息';
        return textResult(`${label} 来自 ${result.fromSessionId}：\n${result.message}`);
      },
    ),

    defineTool(
      'ListLinkedSessions',
      '列出契约通道会话',
      LIST_LINKED_DESC,
      z.object({}),
      async () => {
        if (opts.role === 'main') {
          const children = bridge.getChildrenByParent(opts.conversationId);
          if (children.length === 0) {
            return textResult('（当前会话还没有建立任何契约通道）');
          }
          const lines = children.map((c) =>
            `- sessionId=${c.sessionId ?? '(尚未就绪，稍后重试)'} · ${c.title} · status=${c.status} · 你派出的`
          );
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
      'CreateSession',
      '派出子会话执行任务',
      '创建一个平级的新会话来协作处理任务。新会话与当前会话建立契约通道，可通过 SendMessage / WaitForMessage 双向通信。' +
      'outputPath 用于建议新会话把较长的交付内容写到共享区（不可与其它在跑的会话冲突）；简短交付可以直接放进 SendMessage 里。',
      z.object({
        task: z.string().min(1).describe('委派给新会话的任务描述（自然语言）'),
        outputPath: z.string().min(1).describe('建议新会话写入共享区的相对路径（如 hello.md），用于承载较长的交付内容'),
        title: z.string().optional().describe('新会话标题；缺省由系统生成'),
      }),
      async (args) => {
        try {
          const snapshot = await bridge.startChild({
            parentConversationId: opts.conversationId,
            workspaceId: opts.workspaceId,
            groupId: opts.groupId,
            spec: { task: args.task, outputPath: args.outputPath, title: args.title },
          });
          const sessionId = await bridge.waitForChildSessionId(snapshot.childId);
          if (!sessionId) {
            return textResult(
              `✅ 已创建新会话「${snapshot.title}」，但它的 sessionId 还没就绪。\n` +
              `稍后用 ListLinkedSessions 查到 sessionId 后，再用 SendMessage / WaitForMessage 与它通信。`,
            );
          }
          return textResult(
            `✅ 已创建新会话 ${sessionId}（${snapshot.title}）→ 建议交付路径 ${args.outputPath}\n` +
            `用 SendMessage("${sessionId}", ...) 与它通信；WaitForMessage(["${sessionId}"]) 等待它交付。`,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(`创建会话失败: ${message}`);
        }
      },
    ),

    defineTool(
      'CreateSessionBatch',
      '批量派出多个子会话',
      '原子批量创建多个新会话。先一次性 dry-run 校验所有 outputPath 不冲突，任何一个冲突则整批拒绝；' +
      '全部 ok 才依次拉起。中途任意一个拉起失败将回滚已创建的会话。',
      z.object({
        items: z.array(z.object({
          task: z.string().min(1).describe('子任务描述'),
          outputPath: z.string().min(1).describe('建议写入共享区的相对路径'),
          title: z.string().optional().describe('会话标题；缺省自动生成'),
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

          const started: { childId: string; outputPath: string; title: string }[] = [];
          for (let i = 0; i < args.items.length; i++) {
            const item = args.items[i];
            try {
              const snapshot = await bridge.startChild({
                parentConversationId: opts.conversationId,
                workspaceId: opts.workspaceId,
                groupId: opts.groupId,
                spec: { task: item.task, outputPath: item.outputPath, title: item.title },
              });
              started.push({ childId: snapshot.childId, outputPath: snapshot.outputPath, title: snapshot.title });
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
            lines.push(`- ${sid ?? '(sessionId 尚未就绪)'}（${s.title}）→ ${s.outputPath}`);
          }
          lines.push('', '用 SendMessage / WaitForMessage 分别与它们通信（尚未就绪的稍后用 ListLinkedSessions 补查）。');
          return textResult(lines.join('\n'));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(`批量创建失败: ${message}`);
        }
      },
    ),

    defineTool(
      'StopSession',
      '停止已派出的会话',
      '停止当前会话直接派出的某个会话（仅对 running 有效）。停止后该会话状态变为 cancelled。',
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
  ];

  return [...mainOnlyTools, ...sharedTools];
}

registerToolGroup({
  server: 'dogear-delegation',
  label: 'Agent 协作',
  create: createDelegationToolDefs,
  placeholder: [{ role: 'main', workspaceId: '', groupId: '', conversationId: '' }],
});
