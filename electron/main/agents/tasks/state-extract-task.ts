import type { AgentTask } from '../task-types.js';
import type { ModelProfile } from '../../services/settings-types.js';
import type { PiModelResult } from '../pi/provider.js';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { TaskHandlerContext } from './task-context.js';

/**
 * 话题状态卡增量抽取任务（STATE_EXTRACT）
 *
 * 逐会话处理（通常 1-2 个）：readSessionBranchEntries 读 sourcesSeen mtime 之后的新增 entry →
 * transcript-adapter 清洗 → prompt（新增逐字稿 + 本组现有条目）→ runOnce 便宜模型，
 * agent 调 emit_state_increment 工具输出增量（toPiTools 层 zod parse + handler 内 uuid/id 保真校验）→
 * mergeIncrementAndSave 写回状态卡并推进 sourcesSeen。单会话失败记 failed 继续下一个，
 * 失败会话不推进 sourcesSeen（保持滞后标注，下轮重抽；合并去重保证重抽幂等）。
 * 模型依次回退：payload.modelSelection → ai.stateModelSelection → ai.defaultModelSelection。
 */
export async function handleStateExtractTask(task: AgentTask, taskLogger: any, ctx: TaskHandlerContext): Promise<any> {
  const payload = task.payload as import('../task-types.js').StateExtractPayload;
  const { workspaceId, groupId, conversations } = payload;

  taskLogger.info('开始话题状态抽取任务:', groupId, '| workspace:', workspaceId, '| conversations:', conversations.length);
  const startedAt = Date.now();

  const { loadSettingsFromDir } = await import('../agent-query-config.js');
  const { resolvePiModel } = await import('../pi/provider.js');
  const appSettings = await loadSettingsFromDir(ctx.configDir);

  const selection = payload.modelSelection
    ?? appSettings.ai.stateModelSelection
    ?? appSettings.ai.defaultModelSelection;

  let model: PiModelResult['model'];
  let tier: string;
  let resolvedProfile: ModelProfile;
  let thinkingLevel: ThinkingLevel;
  try {
    const r = resolvePiModel(appSettings, selection, null, null);
    model = r.model;
    tier = r.tier;
    resolvedProfile = r.profile;
    thinkingLevel = r.thinkingLevel;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    taskLogger.error('话题状态抽取任务终止:', error);
    return { groupId, processed: 0, skipped: 0, failed: conversations.length, error };
  }

  const { readTopicStateCard, mergeIncrementAndSave } = await import('../../services/memory/background-store.js');
  const { TOPIC_CARD_CATEGORIES, StateIncrementSchema } = await import('../../services/memory/state-card.js');
  const { readSessionBranchEntries } = await import('../pi-session/session-history-reader.js');
  const { cleanMessagesFromEntries } = await import('../pi-session/transcript-adapter.js');
  const { loadStateExtractPrompt, STATE_EXTRACT_SYSTEM_PROMPT } = await import('../../services/memory/state-extract-prompt.js');
  const { defineTool } = await import('../pi/tool-adapter.js');
  const { runOnce } = await import('../pi/run-once.js');

  const template = await loadStateExtractPrompt(ctx.configDir);
  const { getGroup } = await import('../../services/group-service.js');
  const group = await getGroup(workspaceId, groupId);
  const groupTitle = group?.title?.trim() || '';
  const systemPrompt = STATE_EXTRACT_SYSTEM_PROMPT;

  const abortController = new AbortController();
  ctx.setAbortController(abortController);

  const processed: string[] = [];
  const skipped: string[] = [];
  const failures: Array<{ conversationId: string; error: string }> = [];

  const tokens = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
  let hasTokens = false;

  try {
    for (const conv of conversations) {
      if (abortController.signal.aborted) break;

      try {
        // 每会话重读卡：上个会话的写入要立刻对下个会话的旧条目/resolved 池可见
        const card = await readTopicStateCard(workspaceId, groupId);
        const lastSeenMtime = card?.sourcesSeen.find((s) => s.sessionId === conv.sessionId)?.mtime;

        const entries = await readSessionBranchEntries(workspaceId, conv.sessionId);
        const allMessages = cleanMessagesFromEntries(entries);
        const newMessages = lastSeenMtime === undefined
          ? allMessages
          : allMessages.filter((m) => Date.parse(m.timestamp) > lastSeenMtime);

        // resolved 候选池 = 本组全部六类条目（与 mergeIncrement 跨类退休范围一致）
        const oldEntries = new Map<string, { id: string; category: string; text: string }>();
        if (card) {
          for (const cat of TOPIC_CARD_CATEGORIES) {
            for (const e of card.entries[cat]) {
              oldEntries.set(e.id, { id: e.id, category: cat, text: e.text });
            }
          }
        }

        // 无新增可抽消息 → 空增量合并只推进 sourcesSeen，不白跑模型
        if (newMessages.length === 0) {
          await mergeIncrementAndSave(workspaceId, groupId, StateIncrementSchema.parse({}), {
            conversationId: conv.conversationId,
            dirtySources: [conv],
          });
          skipped.push(conv.conversationId);
          continue;
        }

        const uuidSet = new Set(newMessages.map((m) => m.uuid));
        const transcriptText = newMessages.map((m) => m.formatted).join('\n\n');
        const oldEntryText = oldEntries.size
          ? [...oldEntries.values()].map((e) => `- [${e.category}] ${e.id}: ${e.text}`).join('\n')
          : '（无）';

        let increment: import('../../services/memory/state-card.js').StateIncrement | null = null;

        const emitTool = defineTool(
          'emit_state_increment',
          '输出话题状态增量',
          '把本次逐字稿中抽取到的状态增量按 schema 一次性提交。uuid 必须来自逐字稿头部，resolved 必须引用「本组现有条目」列表中的 id。',
          StateIncrementSchema,
          async (args) => {
            const badUuids = new Set<string>();
            for (const cat of TOPIC_CARD_CATEGORIES) {
              for (const item of args[cat]) {
                if (!uuidSet.has(item.uuid)) badUuids.add(item.uuid);
              }
            }
            if (args.topicChange?.uuid && !uuidSet.has(args.topicChange.uuid)) badUuids.add(args.topicChange.uuid);
            const badResolved = args.resolved.filter((id: string) => !oldEntries.has(id));
            if (badUuids.size > 0 || badResolved.length > 0) {
              const lines = [
                '校验失败，未接受本次提交：',
                ...(badUuids.size > 0 ? [`非法 uuid（必须逐字复制逐字稿头部的 id）：${[...badUuids].join(', ')}`] : []),
                ...(badResolved.length > 0 ? [`resolved 引用了不存在的条目 id（只能用「本组现有条目」列出的 id）：${badResolved.join(', ')}`] : []),
                '请修正后重新调用 emit_state_increment。',
              ];
              return { content: [{ type: 'text' as const, text: lines.join('\n') }], isError: true };
            }
            increment = args;
            const itemCount = args.completed.length + args.inProgress.length + args.decisions.length
              + args.blockers.length + args.nextSteps.length + args.openQuestions.length;
            return { content: [{ type: 'text' as const, text: `已接受增量：${itemCount} 条新条目，${args.resolved.length} 条 resolved${args.topicChange ? '，含话题变更' : ''}` }] };
          },
        );

        const prompt = [
          template,
          '',
          '## 本次输入',
          `- groupId: ${groupId}`,
          `- conversationId: ${conv.conversationId}`,
          `- sessionId: ${conv.sessionId}`,
          `- 当前组标题: ${groupTitle || '（空）'}${group?.autoTitle ? '（自动占坑名）' : ''}`,
          '',
          `### 新增逐字稿（上次提炼位置之后的新增消息，共 ${newMessages.length} 条）`,
          '',
          transcriptText,
          '',
          '### 本组现有条目（resolved 只能引用这里的 id）',
          oldEntryText,
        ].join('\n');

        const result = await runOnce({
          systemPrompt,
          prompt,
          tools: [emitTool],
          model,
          profile: resolvedProfile,
          thinkingLevel,
          signal: abortController.signal,
          maxTurns: 5,
          revive: {
            shouldContinue: () => increment === null,
            continuePrompt: '你还没有成功提交任何增量。立即调用 emit_state_increment 工具（uuid 从逐字稿头部逐字复制，resolved 只引用现有条目列表中的 id）。',
            maxRevives: 1,
          },
          onLog: (m) => {
            if (m.startsWith('[tool-error]')) taskLogger.warn(m);
            else taskLogger.info(m);
          },
        });

        if (result.ok) {
          if (result.usage) {
            hasTokens = true;
            tokens.inputTokens += result.usage.inputTokens;
            tokens.outputTokens += result.usage.outputTokens;
            tokens.cacheReadInputTokens += result.usage.cacheReadInputTokens;
            tokens.cacheCreationInputTokens += result.usage.cacheCreationInputTokens;
          }
        } else {
          throw new Error(result.cancelled ? '已取消' : result.error);
        }
        if (!increment) throw new Error('模型未成功调 emit_state_increment');

        await mergeIncrementAndSave(workspaceId, groupId, increment, {
          conversationId: conv.conversationId,
          dirtySources: [conv],
        });
        processed.push(conv.conversationId);
        taskLogger.info(`会话 ${conv.conversationId} 抽取完成`);
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        failures.push({ conversationId: conv.conversationId, error: errorMsg });
        taskLogger.warn(`会话 ${conv.conversationId} 抽取失败（不推进 sourcesSeen，保持滞后）:`, errorMsg);
      }
    }

    if (abortController.signal.aborted) {
      taskLogger.info('话题状态抽取被取消:', groupId);
      return { groupId, processed: processed.length, skipped: skipped.length, failed: failures.length, cancelled: true, tokens: hasTokens ? { ...tokens } : undefined };
    }

    taskLogger.info('话题状态抽取任务完成，耗时:', Date.now() - startedAt, 'ms', '| processed:', processed.length, '| skipped:', skipped.length, '| failed:', failures.length, '| tier:', tier);
    return {
      groupId,
      processed: processed.length,
      skipped: skipped.length,
      failed: failures.length,
      failures,
      tier,
      profileName: resolvedProfile.name,
      tokens: hasTokens ? { ...tokens } : undefined,
    };
  } finally {
    ctx.setAbortController(null);
  }
}
