/**
 * 转写纯 reducer 层：TranscriptCore 不可变状态与事件归并
 */
import type { Message, ContentBlock } from '../types';
import { streamReducer, generateLocalMessageId } from '../transformers';
import type { LivePermissionRequest } from './useAgentSession';
import type { HumanInterventionRequest } from '../../../electron/main/services/browser/human-intervention';

export interface TranscriptEvent {
  type: string;
  timestamp: number;
  role?: 'user' | 'assistant';
  uuid?: string;
  isReplay?: boolean;
}

export type StreamEventSideEffect = () => void;

export function isDeltaStreamEvent(event: TranscriptEvent): boolean {
  return event.type === 'text'
    || event.type === 'thinking'
    || event.type === 'tool_use'
    || event.type === 'tool_result';
}

export interface PendingStreamEvent {
  event: TranscriptEvent;
  sideEffect?: StreamEventSideEffect;
}

export function drainPendingStreamEvents(
  pending: PendingStreamEvent[],
  apply: (event: TranscriptEvent) => void,
): void {
  const events = pending.splice(0, pending.length);
  for (const item of events) {
    apply(item.event);
    item.sideEffect?.();
  }
}

export interface PendingAction {
  requestId: string;
  kind: 'permission' | 'ask_user' | 'intervention';
}

export interface TranscriptCore {
  stable: Message[];
  live: Message[];
  pendingActions: PendingAction[];
  structuralVersion: number;
  structuralSig: string;
}

export function initialTranscriptCore(): TranscriptCore {
  return { stable: [], live: [], pendingActions: [], structuralVersion: 0, structuralSig: structureSignature([], []) };
}

// 指纹覆盖 tool_use 的 name/id/结果有无（tool_result 填充不改块数，running→完成翻转依赖 hasOutput 位）；
// human_intervention 覆盖 resolved 位（等待中→已处理翻转需触发结构重渲染）；
// text/thinking 增量只改 content，指纹刻意不含以跳过 delta 帧
function blockFingerprint(b: ContentBlock): string {
  if (b.type === 'human_intervention') return `${b.type}|${b.interventionResolved ? 1 : 0}`;
  if (b.type !== 'tool_use') return b.type;
  return `${b.toolName ?? ''}|${b.toolUseId ?? ''}|${b.toolOutput !== undefined ? 1 : 0}`;
}

function messageFingerprint(m: Message): string {
  return `${m.role === 'assistant' ? 'a' : 'u'}:${(m.contentBlocks ?? []).map(blockFingerprint).join('+')}`;
}

export function structureSignature(stable: Message[], live: Message[]): string {
  // 写入口只动 stable 尾部（append/挂块）或 live（整 turn 写入，pushLocalUser/重放），stable 中段结构不可变，
  // 签名取 stable 长度 + 尾消息指纹 + live 全量指纹即可
  const stablePart = stable.length ? `${stable.length}:${messageFingerprint(stable[stable.length - 1])}` : '0';
  return `${stablePart}|${live.map(messageFingerprint).join('/')}`;
}

function withChanges(
  core: TranscriptCore,
  stable: Message[],
  live: Message[],
  pendingActions?: PendingAction[],
): TranscriptCore {
  const sig = structureSignature(stable, live);
  return {
    stable,
    live,
    pendingActions: pendingActions ?? core.pendingActions,
    structuralVersion: sig !== core.structuralSig ? core.structuralVersion + 1 : core.structuralVersion,
    structuralSig: sig,
  };
}

function reduceInto(
  core: TranscriptCore,
  target: Message[],
  extendedMsg: TranscriptEvent,
  showReplayMessages: boolean,
  into: 'stable' | 'live',
): TranscriptCore {
  const reduced = streamReducer(target, extendedMsg, showReplayMessages);
  if (!reduced || reduced === target) return core;
  return into === 'live'
    ? withChanges(core, core.stable, reduced)
    : withChanges(core, reduced, core.live);
}

export function applyEventToCore(
  core: TranscriptCore,
  extendedMsg: TranscriptEvent,
  showReplayMessages: boolean,
): TranscriptCore {
  if ((extendedMsg as { isReplay?: boolean }).isReplay && !showReplayMessages) return core;

  if (extendedMsg.type === 'message_id' && extendedMsg.role === 'user') {
    // 本地乐观 user 恒落 live；promote 可能先于 message_id 到达（user 已提升进 stable），故保留 stable fallback
    const viaLive = reduceInto(core, core.live, extendedMsg, showReplayMessages, 'live');
    if (viaLive !== core) return viaLive;
    return reduceInto(core, core.stable, extendedMsg, showReplayMessages, 'stable');
  }

  if (extendedMsg.type === 'user') {
    return reduceInto(core, core.live, extendedMsg, showReplayMessages, 'live');
  }

  return reduceInto(core, core.live, extendedMsg, showReplayMessages, 'live');
}

export function loadHistoryCore(core: TranscriptCore, msgs: Message[]): TranscriptCore {
  // 同结构的两次 loadHistory 签名可能相同，structuralVersion 无条件 +1 强制派生层感知替换
  const sig = structureSignature(msgs, []);
  return { stable: msgs, live: [], pendingActions: [], structuralVersion: core.structuralVersion + 1, structuralSig: sig };
}

function messageEntryIds(message: Message): string[] {
  if (message.entryIds && message.entryIds.length > 0) return message.entryIds;
  return message.id ? [message.id] : [];
}

export function findHistoryOverlapIndex(history: Message[], turnEntryIds: string[]): number {
  if (turnEntryIds.length === 0) return -1;
  const turnIds = new Set(turnEntryIds);
  for (let index = history.length - 1; index >= 0; index--) {
    if (messageEntryIds(history[index]).some((id) => turnIds.has(id))) return index;
  }
  return -1;
}

// 磁盘切掉段（overlap 命中及其后）里运行中 turn 的 user header 捞回：desktop 自发消息在事件流里只有
// message_id(user) 事件、reducer 不产实体，重放后 live 缺 user。锚点取 user 前面最近一条磁盘 assistant
// 的末尾 entryId，且需回看完整 history：命中点之前的同 run assistant 留在 stable 侧，但其 entry 仍被
// 重放产物覆盖，锚点能解析。只捞 turnEntryIds 成员；带实体的 user 重放已落 live，按 id 去重。
export function reinsertCutUsers(live: Message[], history: Message[], cutFrom: number, turnEntryIds: string[]): Message[] {
  const turnIds = new Set(turnEntryIds);
  const result = [...live];
  let anchorId: string | null = null;
  let anchorDirty = true;
  let insertAt = 0;
  history.forEach((msg, index) => {
    if (msg.role === 'assistant') {
      const ids = messageEntryIds(msg);
      if (ids.length > 0) {
        anchorId = ids[ids.length - 1];
        anchorDirty = true;
      }
      return;
    }
    if (index < cutFrom || msg.role !== 'user' || !msg.id) return;
    if (!messageEntryIds(msg).some((id) => turnIds.has(id))) return;
    if (result.some((m) => m.id === msg.id)) return;
    if (anchorDirty) {
      if (anchorId === null) {
        insertAt = 0;
      } else {
        const anchor = anchorId;
        insertAt = result.findIndex((m) => m.role === 'assistant' && messageEntryIds(m).includes(anchor)) + 1;
      }
      anchorDirty = false;
    }
    result.splice(insertAt, 0, { ...msg, isQueued: undefined });
    insertAt += 1;
  });
  return result;
}

export function mergeHistorySnapshotCore(
  history: Message[],
  snapshotEvents: TranscriptEvent[],
  turnEntryIds: string[],
  pendingPermissionRequests: LivePermissionRequest[],
  showReplayMessages: boolean,
): TranscriptCore {
  const overlapIndex = findHistoryOverlapIndex(history, turnEntryIds);
  const stable = overlapIndex >= 0 ? history.slice(0, overlapIndex) : history.slice();
  const cutFrom = overlapIndex >= 0 ? overlapIndex : history.length;
  let next = initialTranscriptCore();
  if (turnEntryIds.length > 0) {
    for (const event of snapshotEvents) {
      next = applyEventToCore(next, event, showReplayMessages);
    }
    next = withChanges(next, next.stable, reinsertCutUsers(next.live, history, cutFrom, turnEntryIds));
  }
  for (const request of pendingPermissionRequests) {
    next = appendPendingBlockCore(next, buildPermissionBlock({
      requestId: request.requestId,
      toolName: request.toolName,
      toolInput: request.toolInput,
    }));
  }
  return withChanges(next, stable, next.live, next.pendingActions);
}

export function pushLocalUserCore(core: TranscriptCore, msg: Message): TranscriptCore {
  if (core.live.length) {
    const promoted = promoteCore(core);
    return withChanges(promoted, promoted.stable, [msg]);
  }
  return withChanges(core, core.stable, [...core.live, msg]);
}

export function pushLiveAssistantCore(core: TranscriptCore, msg: Message): TranscriptCore {
  return withChanges(core, core.stable, [...core.live, msg]);
}

export function replaceLastLiveAssistantCore(core: TranscriptCore, msg: Message): TranscriptCore {
  if (core.live.length === 0) return core;
  return withChanges(core, core.stable, [...core.live.slice(0, -1), msg]);
}

function newLocalAssistant(block: ContentBlock, streaming: boolean): Message {
  return {
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    id: generateLocalMessageId(),
    isStreaming: streaming,
    contentBlocks: [block],
  };
}

function appendBlockToLastAssistant(arr: Message[], block: ContentBlock): Message[] {
  const lastIdx = arr.length - 1;
  if (lastIdx < 0 || arr[lastIdx].role !== 'assistant') return arr;
  const next = [...arr];
  next[lastIdx] = { ...next[lastIdx], contentBlocks: [...(next[lastIdx].contentBlocks ?? []), block] };
  return next;
}

// 模式切换通知 / compacting 等本地块：挂到合成视图尾部消息（live 非空看 live，否则看 stable），
// 尾部不是 assistant 时新建非流式 assistant 落 live，与旧扁平 setMessages 行为一致
export function insertLocalBlockCore(core: TranscriptCore, block: ContentBlock): TranscriptCore {
  if (core.live.length) {
    const live = appendBlockToLastAssistant(core.live, block);
    if (live !== core.live) return withChanges(core, core.stable, live);
    return withChanges(core, core.stable, [...core.live, newLocalAssistant(block, false)]);
  }
  if (core.stable.length && core.stable[core.stable.length - 1].role === 'assistant') {
    return withChanges(core, appendBlockToLastAssistant(core.stable, block), core.live);
  }
  return withChanges(core, core.stable, [newLocalAssistant(block, false)]);
}

export function buildPermissionBlock(data: {
  requestId: string;
  toolName: string;
  toolInput: unknown;
  decisionReason?: string;
}): ContentBlock {
  return {
    type: 'permission_request',
    timestamp: Date.now(),
    permissionRequestId: data.requestId,
    permissionToolName: data.toolName,
    permissionInput: data.toolInput,
    ...(data.decisionReason !== undefined ? { permissionDecisionReason: data.decisionReason } : {}),
  };
}

export function buildAskUserBlock(data: { requestId: string; questions: NonNullable<ContentBlock['askUserQuestions']> }): ContentBlock {
  return {
    type: 'ask_user_question',
    timestamp: Date.now(),
    askUserRequestId: data.requestId,
    askUserQuestions: data.questions,
  };
}

export function buildInterventionBlock(request: HumanInterventionRequest): ContentBlock {
  return {
    type: 'human_intervention',
    timestamp: request.createdAt,
    interventionRequestId: request.id,
    interventionReason: request.reason,
    interventionMessage: request.message,
    interventionUrl: request.url,
    ...(request.actions ? { interventionActions: request.actions } : {}),
  };
}

// 权限/AskUser/人工介入占位：挂块到尾部 assistant（与 insertLocalBlock 同规则），无 assistant 时
// push 新 isStreaming assistant 落 live（外部启动会话无占位场景），同时登记 pendingActions
export function appendPendingBlockCore(core: TranscriptCore, block: ContentBlock): TranscriptCore {
  const action: PendingAction = {
    requestId: (block.permissionRequestId ?? block.askUserRequestId ?? block.interventionRequestId) as string,
    kind: block.type === 'ask_user_question' ? 'ask_user' : block.type === 'human_intervention' ? 'intervention' : 'permission',
  };
  const base: TranscriptCore = { ...core, pendingActions: [...core.pendingActions, action] };
  if (core.live.length) {
    const live = appendBlockToLastAssistant(core.live, block);
    return live !== core.live
      ? withChanges(base, core.stable, live)
      : withChanges(base, core.stable, [...core.live, newLocalAssistant(block, true)]);
  }
  if (core.stable.length && core.stable[core.stable.length - 1].role === 'assistant') {
    return withChanges(base, appendBlockToLastAssistant(core.stable, block), core.live);
  }
  return withChanges(base, core.stable, [newLocalAssistant(block, true)]);
}

function mapBlocksIn(
  arr: Message[],
  matchKey: 'permissionRequestId' | 'askUserRequestId' | 'interventionRequestId',
  requestId: string,
  apply: (b: ContentBlock) => ContentBlock,
): Message[] {
  let changed = false;
  const next = arr.map((msg) => {
    if (!msg.contentBlocks) return msg;
    const hasTarget = msg.contentBlocks.some((b) =>
      (matchKey === 'permissionRequestId' ? b.permissionRequestId : matchKey === 'askUserRequestId' ? b.askUserRequestId : b.interventionRequestId) === requestId,
    );
    if (!hasTarget) return msg;
    changed = true;
    return {
      ...msg,
      contentBlocks: msg.contentBlocks.map((b) =>
        (matchKey === 'permissionRequestId' ? b.permissionRequestId : matchKey === 'askUserRequestId' ? b.askUserRequestId : b.interventionRequestId) === requestId ? apply(b) : b,
      ),
    };
  });
  return changed ? next : arr;
}

export function resolvePermissionCore(
  core: TranscriptCore,
  requestId: string,
  behavior: 'allow' | 'deny' | 'allow_session',
): TranscriptCore {
  const apply = (b: ContentBlock): ContentBlock => ({ ...b, permissionResolved: behavior });
  const stable = mapBlocksIn(core.stable, 'permissionRequestId', requestId, apply);
  const live = mapBlocksIn(core.live, 'permissionRequestId', requestId, apply);
  const pendingActions = core.pendingActions.filter((p) => !(p.kind === 'permission' && p.requestId === requestId));
  if (stable === core.stable && live === core.live && pendingActions.length === core.pendingActions.length) return core;
  return { ...core, stable, live, pendingActions };
}

export function resolveAskUserCore(core: TranscriptCore, requestId: string, answers: Record<string, string>): TranscriptCore {
  const apply = (b: ContentBlock): ContentBlock => ({ ...b, askUserResolved: true, askUserAnswers: answers });
  const stable = mapBlocksIn(core.stable, 'askUserRequestId', requestId, apply);
  const live = mapBlocksIn(core.live, 'askUserRequestId', requestId, apply);
  const pendingActions = core.pendingActions.filter((p) => !(p.kind === 'ask_user' && p.requestId === requestId));
  if (stable === core.stable && live === core.live && pendingActions.length === core.pendingActions.length) return core;
  return { ...core, stable, live, pendingActions };
}

/** 收集当前未解除的人工介入卡 id（去重挂卡与漏网 resolved 同步用） */
export function pendingInterventionIds(core: TranscriptCore): Set<string> {
  const ids = new Set<string>();
  for (const msg of [...core.stable, ...core.live]) {
    for (const b of msg.contentBlocks ?? []) {
      if (b.type === 'human_intervention' && !b.interventionResolved && b.interventionRequestId) {
        ids.add(b.interventionRequestId);
      }
    }
  }
  return ids;
}

export function resolveInterventionCore(core: TranscriptCore, requestId: string, result?: string): TranscriptCore {
  const apply = (b: ContentBlock): ContentBlock => ({ ...b, interventionResolved: true, interventionResult: result });
  const stable = mapBlocksIn(core.stable, 'interventionRequestId', requestId, apply);
  const live = mapBlocksIn(core.live, 'interventionRequestId', requestId, apply);
  const pendingActions = core.pendingActions.filter((p) => !(p.kind === 'intervention' && p.requestId === requestId));
  if (stable === core.stable && live === core.live && pendingActions.length === core.pendingActions.length) return core;
  return { ...core, stable, live, pendingActions };
}

export function cancelAllPendingCore(core: TranscriptCore): TranscriptCore {
  const mapArr = (arr: Message[]): Message[] => {
    let changed = false;
    const next = arr.map((msg) => {
      if (!msg.contentBlocks) return msg;
      let msgChanged = false;
      const blocks = msg.contentBlocks.map((b) => {
        if (b.type === 'permission_request' && !b.permissionResolved) {
          msgChanged = true;
          return { ...b, permissionResolved: 'deny' as const, permissionDenyMessage: '已中断' };
        }
        if (b.type === 'ask_user_question' && !b.askUserResolved) {
          msgChanged = true;
          return { ...b, askUserResolved: true, askUserCancelled: true };
        }
        return b;
      });
      if (!msgChanged) return msg;
      changed = true;
      return { ...msg, contentBlocks: blocks };
    });
    return changed ? next : arr;
  };
  if (core.pendingActions.length === 0) return core;
  return { ...core, stable: mapArr(core.stable), live: mapArr(core.live), pendingActions: [] };
}

function closeTailStreaming(arr: Message[]): Message[] {
  const lastIdx = arr.length - 1;
  if (lastIdx < 0 || arr[lastIdx].role !== 'assistant' || !arr[lastIdx].isStreaming) return arr;
  const next = [...arr];
  next[lastIdx] = { ...next[lastIdx], isStreaming: false };
  return next;
}

// 会话完成：关闭合成视图尾部流式标记（live 非空关 live 尾，否则关 stable 尾），与旧 complete 分支一致
export function settleTailCore(core: TranscriptCore): TranscriptCore {
  if (core.live.length) {
    const live = closeTailStreaming(core.live);
    return live === core.live ? core : withChanges(core, core.stable, live);
  }
  const stable = closeTailStreaming(core.stable);
  return stable === core.stable ? core : withChanges(core, stable, core.live);
}

export function promoteCore(core: TranscriptCore): TranscriptCore {
  if (core.live.length === 0) return core;
  const live = closeTailStreaming(core.live);
  return withChanges(core, [...core.stable, ...live], []);
}
