import { useRef, useCallback, useEffect, useSyncExternalStore } from 'react';
import type { Message, ContentBlock } from '../types';
import { streamReducer, generateLocalMessageId } from '../transformers';
import type { LivePermissionRequest } from './useAgentSession';

export interface TranscriptEvent {
  type: string;
  timestamp: number;
  role?: 'user' | 'assistant';
  uuid?: string;
  isReplay?: boolean;
  source?: string;
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
  kind: 'permission' | 'ask_user';
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

// aggregateTasks 消费 tool_use 块的 toolOutput/toolInput（tool_result 填充不改块数），
// 指纹必须覆盖这些字段；text/thinking 增量只改 content，指纹刻意不含以跳过 delta 帧
function blockFingerprint(b: ContentBlock): string {
  if (b.type !== 'tool_use') return b.type;
  const base = `${b.toolName ?? ''}|${b.toolUseId ?? ''}|${b.toolOutput !== undefined ? 1 : 0}`;
  if (b.toolName === 'TaskCreate' || b.toolName === 'TaskUpdate') {
    return `${base}|${JSON.stringify(b.toolInput ?? null)}|${JSON.stringify(b.toolOutput ?? null)}`;
  }
  return base;
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

export function mergeHistorySnapshotCore(
  history: Message[],
  snapshotEvents: TranscriptEvent[],
  turnEntryIds: string[],
  pendingPermissionRequests: LivePermissionRequest[],
  showReplayMessages: boolean,
): TranscriptCore {
  const overlapIndex = findHistoryOverlapIndex(history, turnEntryIds);
  const stable = overlapIndex >= 0 ? history.slice(0, overlapIndex) : history.slice();
  let next = initialTranscriptCore();
  if (turnEntryIds.length > 0) {
    for (const event of snapshotEvents) {
      next = applyEventToCore(next, event, showReplayMessages);
    }
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

// 权限/AskUser 占位：挂块到尾部 assistant（与 insertLocalBlock 同规则），无 assistant 时
// push 新 isStreaming assistant 落 live（外部启动会话无占位场景），同时登记 pendingActions
export function appendPendingBlockCore(core: TranscriptCore, block: ContentBlock): TranscriptCore {
  const action: PendingAction = {
    requestId: (block.permissionRequestId ?? block.askUserRequestId) as string,
    kind: block.type === 'ask_user_question' ? 'ask_user' : 'permission',
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
  matchKey: 'permissionRequestId' | 'askUserRequestId',
  requestId: string,
  apply: (b: ContentBlock) => ContentBlock,
): Message[] {
  let changed = false;
  const next = arr.map((msg) => {
    if (!msg.contentBlocks) return msg;
    const hasTarget = msg.contentBlocks.some((b) =>
      (matchKey === 'permissionRequestId' ? b.permissionRequestId : b.askUserRequestId) === requestId,
    );
    if (!hasTarget) return msg;
    changed = true;
    return {
      ...msg,
      contentBlocks: msg.contentBlocks.map((b) =>
        (matchKey === 'permissionRequestId' ? b.permissionRequestId : b.askUserRequestId) === requestId ? apply(b) : b,
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

export interface TranscriptStoreApi {
  subscribe: (listener: () => void) => () => void;
  getLiveSnapshot: () => Message[];
}

interface TranscriptStructuralSnapshot {
  stableHistory: Message[];
  structuredLiveTail: Message[];
  pendingActions: PendingAction[];
  structuralVersion: number;
}

interface TranscriptStore extends TranscriptStoreApi {
  core: TranscriptCore;
  structuralSnapshot: TranscriptStructuralSnapshot;
  listeners: Set<() => void>;
  getStructuralSnapshot: () => TranscriptStructuralSnapshot;
}

function createTranscriptStore(): TranscriptStore {
  const store = {
    core: initialTranscriptCore(),
    structuralSnapshot: {
      stableHistory: [],
      structuredLiveTail: [],
      pendingActions: [],
      structuralVersion: 0,
    },
    listeners: new Set<() => void>(),
    subscribe(listener: () => void) {
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    },
    getLiveSnapshot: () => store.core.live,
    getStructuralSnapshot: () => store.structuralSnapshot,
  } as TranscriptStore;
  return store;
}

function publishTranscriptStore(store: TranscriptStore, next: TranscriptCore): void {
  const prev = store.core;
  if (next === prev) return;
  store.core = next;
  const structuralChanged = next.stable !== prev.stable
    || next.pendingActions !== prev.pendingActions
    || next.structuralVersion !== prev.structuralVersion;
  if (structuralChanged) {
    const structuredLiveTail = next.structuralVersion !== prev.structuralVersion
      ? next.live
      : store.structuralSnapshot.structuredLiveTail;
    store.structuralSnapshot = {
      stableHistory: next.stable,
      structuredLiveTail,
      pendingActions: next.pendingActions,
      structuralVersion: next.structuralVersion,
    };
  }
  for (const listener of store.listeners) listener();
}

export function useTranscriptLiveTail(store: TranscriptStoreApi): Message[] {
  return useSyncExternalStore(store.subscribe, store.getLiveSnapshot, store.getLiveSnapshot);
}

export interface UseTranscriptStateResult {
  stableHistory: Message[];
  pendingActions: PendingAction[];
  structuralVersion: number;
  structuredLiveTail: Message[];
  transcriptStore: TranscriptStoreApi;
  getMessages: () => Message[];
  loadHistory: (msgs: Message[]) => void;
  enqueueStreamEvent: (e: TranscriptEvent, sideEffect?: StreamEventSideEffect) => void;
  applySnapshot: (events: TranscriptEvent[], pendingPermissionRequests: LivePermissionRequest[], turnEntryIds?: string[]) => void;
  pushLocalUser: (msg: Message) => void;
  pushLiveAssistant: (msg: Message) => void;
  replaceLastLiveAssistant: (msg: Message) => void;
  insertLocalBlock: (block: ContentBlock) => void;
  registerPermission: (data: { requestId: string; toolName: string; toolInput: unknown; decisionReason?: string }) => void;
  registerAskUser: (data: { requestId: string; questions: NonNullable<ContentBlock['askUserQuestions']> }) => void;
  resolvePermission: (requestId: string, behavior: 'allow' | 'deny' | 'allow_session') => void;
  resolveAskUser: (requestId: string, answers: Record<string, string>) => void;
  markAllPendingCancelled: () => void;
  onSessionComplete: () => void;
}

interface TranscriptInitState {
  key: string | null;
  history?: Message[];
  snapshotEvents?: TranscriptEvent[];
  turnEntryIds: string[];
  pendingPermissionRequests: LivePermissionRequest[];
  startedAt: number;
  ready: boolean;
  timedOut: boolean;
}

export function shouldFinalizeTranscriptInit(init: TranscriptInitState, now: number, timeoutMs = 2000): boolean {
  return !init.ready && now - init.startedAt >= timeoutMs;
}

function createTranscriptInit(key: string | null, now: number): TranscriptInitState {
  const empty = key === null;
  return {
    key,
    history: empty ? [] : undefined,
    snapshotEvents: empty ? [] : undefined,
    turnEntryIds: [],
    pendingPermissionRequests: [],
    startedAt: now,
    ready: empty,
    timedOut: false,
  };
}

export function useTranscriptState(showReplayMessages: boolean, visible = true, conversationId: string | null = null): UseTranscriptStateResult {
  const storeRef = useRef<TranscriptStore | null>(null);
  if (storeRef.current === null) storeRef.current = createTranscriptStore();
  const store = storeRef.current;
  const structural = useSyncExternalStore(store.subscribe, store.getStructuralSnapshot, store.getStructuralSnapshot);
  const coreRef = useRef(store.core);
  const showReplayRef = useRef(showReplayMessages);
  showReplayRef.current = showReplayMessages;
  const settledRef = useRef(false);
  const visibleRef = useRef(visible);
  const pendingEventsRef = useRef<PendingStreamEvent[]>([]);
  const rafRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initRef = useRef<TranscriptInitState>(createTranscriptInit(conversationId, Date.now()));
  const initTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tryPromoteRef = useRef<() => void>(() => {});
  const pendingInitMutationsRef = useRef<Array<(value: TranscriptCore) => TranscriptCore>>([]);
  const pendingCompleteRef = useRef(false);

  const commit = useCallback((next: TranscriptCore) => {
    if (next === coreRef.current) return;
    coreRef.current = next;
    publishTranscriptStore(store, next);
  }, [store]);

  const flushPending = useCallback(() => {
    if (!initRef.current.ready) return;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    drainPendingStreamEvents(pendingEventsRef.current, (event) => {
      settledRef.current = false;
      commit(applyEventToCore(coreRef.current, event, showReplayRef.current));
    });
  }, [commit]);

  const finishInitialization = useCallback((force = false) => {
    const init = initRef.current;
    if (init.ready || (!force && (init.history === undefined || init.snapshotEvents === undefined))) return;
    const nextInit = { ...init, ready: true, timedOut: force && (init.history === undefined || init.snapshotEvents === undefined) };
    initRef.current = nextInit;
    const merged = mergeHistorySnapshotCore(
      init.history ?? [],
      init.snapshotEvents ?? [],
      init.turnEntryIds,
      init.pendingPermissionRequests,
      showReplayRef.current,
    );
    let nextCore = merged;
    for (const mutation of pendingInitMutationsRef.current.splice(0, pendingInitMutationsRef.current.length)) {
      nextCore = mutation(nextCore);
    }
    commit(nextCore);
    flushPending();
    if (pendingCompleteRef.current) {
      pendingCompleteRef.current = false;
      commit(settleTailCore(coreRef.current));
    }
    tryPromoteRef.current();
  }, [commit, flushPending]);

  useEffect(() => {
    initRef.current = createTranscriptInit(conversationId, Date.now());
    pendingEventsRef.current.splice(0, pendingEventsRef.current.length);
    pendingInitMutationsRef.current.splice(0, pendingInitMutationsRef.current.length);
    pendingCompleteRef.current = false;
    settledRef.current = false;
    commit(initialTranscriptCore());
    if (initTimerRef.current !== null) clearTimeout(initTimerRef.current);
    if (conversationId !== null) {
      initTimerRef.current = setTimeout(() => finishInitialization(true), 2000);
    }
    return () => {
      if (initTimerRef.current !== null) {
        clearTimeout(initTimerRef.current);
        initTimerRef.current = null;
      }
    };
  }, [conversationId, commit, finishInitialization]);

  const scheduleFlush = useCallback(() => {
    if (pendingEventsRef.current.length === 0) return;
    if (visibleRef.current) {
      if (rafRef.current === null && typeof requestAnimationFrame === 'function') {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          flushPending();
        });
      }
      if (timeoutRef.current === null) {
        timeoutRef.current = setTimeout(() => {
          timeoutRef.current = null;
          flushPending();
        }, 50);
      }
      return;
    }
    if (timeoutRef.current === null) {
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        flushPending();
      }, 500);
    }
  }, [flushPending]);

  useEffect(() => {
    visibleRef.current = visible;
    if (visible) {
      flushPending();
      return;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    scheduleFlush();
  }, [visible, flushPending, scheduleFlush]);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    if (initTimerRef.current !== null) clearTimeout(initTimerRef.current);
  }, []);

  const loadHistory = useCallback((msgs: Message[]) => {
    const init = initRef.current;
    if (!init.ready) {
      initRef.current = { ...init, history: msgs };
      finishInitialization();
      return;
    }
    if (init.timedOut) {
      const nextInit = { ...init, history: msgs };
      initRef.current = nextInit;
      if (nextInit.snapshotEvents !== undefined) {
        const wasSettled = settledRef.current || pendingCompleteRef.current;
        commit(mergeHistorySnapshotCore(
          msgs,
          nextInit.snapshotEvents,
          nextInit.turnEntryIds,
          nextInit.pendingPermissionRequests,
          showReplayRef.current,
        ));
        initRef.current = { ...nextInit, timedOut: false };
        if (wasSettled) {
          pendingCompleteRef.current = false;
          commit(settleTailCore(coreRef.current));
        }
        flushPending();
        tryPromoteRef.current();
        return;
      }
    }
    flushPending();
    settledRef.current = false;
    commit(loadHistoryCore(coreRef.current, msgs));
  }, [commit, finishInitialization, flushPending]);

  const enqueueStreamEvent = useCallback((e: TranscriptEvent, sideEffect?: StreamEventSideEffect) => {
    if (!initRef.current.ready) {
      pendingEventsRef.current.push({ event: e, sideEffect });
      return;
    }
    settledRef.current = false;
    if (!isDeltaStreamEvent(e)) {
      flushPending();
      commit(applyEventToCore(coreRef.current, e, showReplayRef.current));
      sideEffect?.();
      return;
    }
    pendingEventsRef.current.push({ event: e, sideEffect });
    scheduleFlush();
  }, [commit, flushPending, scheduleFlush]);

  const applySnapshot = useCallback((events: TranscriptEvent[], pendingPermissionRequests: LivePermissionRequest[], turnEntryIds: string[] = []) => {
    const init = initRef.current;
    if (!init.ready) {
      initRef.current = {
        ...init,
        snapshotEvents: events,
        turnEntryIds,
        pendingPermissionRequests,
      };
      finishInitialization();
      return;
    }
    if (init.timedOut) {
      const nextInit = {
        ...init,
        snapshotEvents: events,
        turnEntryIds,
        pendingPermissionRequests,
      };
      initRef.current = nextInit;
      if (nextInit.history !== undefined) {
        const wasSettled = settledRef.current || pendingCompleteRef.current;
        commit(mergeHistorySnapshotCore(
          nextInit.history,
          events,
          turnEntryIds,
          pendingPermissionRequests,
          showReplayRef.current,
        ));
        initRef.current = { ...nextInit, timedOut: false };
        if (wasSettled) {
          pendingCompleteRef.current = false;
          commit(settleTailCore(coreRef.current));
        }
        flushPending();
        tryPromoteRef.current();
        return;
      }
    }
    flushPending();
    if (events.length === 0 && pendingPermissionRequests.length === 0) return;
    settledRef.current = false;
    let next = coreRef.current;
    for (const e of events) {
      next = applyEventToCore(next, e, showReplayRef.current);
    }
    for (const request of pendingPermissionRequests) {
      next = appendPendingBlockCore(next, buildPermissionBlock({
        requestId: request.requestId,
        toolName: request.toolName,
        toolInput: request.toolInput,
      }));
    }
    commit(next);
  }, [commit, finishInitialization, flushPending]);

  const pushLocalUser = useCallback((msg: Message) => {
    if (!initRef.current.ready) {
      pendingInitMutationsRef.current.push((value) => pushLocalUserCore(value, msg));
      settledRef.current = false;
      return;
    }
    flushPending();
    settledRef.current = false;
    commit(pushLocalUserCore(coreRef.current, msg));
  }, [commit, flushPending]);

  const pushLiveAssistant = useCallback((msg: Message) => {
    if (!initRef.current.ready) {
      pendingInitMutationsRef.current.push((value) => pushLiveAssistantCore(value, msg));
      settledRef.current = false;
      return;
    }
    flushPending();
    settledRef.current = false;
    commit(pushLiveAssistantCore(coreRef.current, msg));
  }, [commit, flushPending]);

  const replaceLastLiveAssistant = useCallback((msg: Message) => {
    if (!initRef.current.ready) {
      pendingInitMutationsRef.current.push((value) => replaceLastLiveAssistantCore(value, msg));
      return;
    }
    flushPending();
    commit(replaceLastLiveAssistantCore(coreRef.current, msg));
  }, [commit, flushPending]);

  const insertLocalBlock = useCallback((block: ContentBlock) => {
    if (!initRef.current.ready) {
      pendingInitMutationsRef.current.push((value) => insertLocalBlockCore(value, block));
      settledRef.current = false;
      return;
    }
    flushPending();
    settledRef.current = false;
    commit(insertLocalBlockCore(coreRef.current, block));
  }, [commit, flushPending]);

  const registerPermission = useCallback((data: { requestId: string; toolName: string; toolInput: unknown; decisionReason?: string }) => {
    const block = buildPermissionBlock(data);
    if (!initRef.current.ready) {
      pendingInitMutationsRef.current.push((value) => appendPendingBlockCore(value, block));
      settledRef.current = false;
      return;
    }
    flushPending();
    settledRef.current = false;
    commit(appendPendingBlockCore(coreRef.current, block));
  }, [commit, flushPending]);

  const registerAskUser = useCallback((data: { requestId: string; questions: NonNullable<ContentBlock['askUserQuestions']> }) => {
    const block = buildAskUserBlock(data);
    if (!initRef.current.ready) {
      pendingInitMutationsRef.current.push((value) => appendPendingBlockCore(value, block));
      settledRef.current = false;
      return;
    }
    flushPending();
    settledRef.current = false;
    commit(appendPendingBlockCore(coreRef.current, block));
  }, [commit, flushPending]);

  const tryPromote = useCallback(() => {
    if (!settledRef.current) return;
    const cur = coreRef.current;
    if (cur.pendingActions.length > 0 || cur.live.length === 0) return;
    settledRef.current = false;
    commit(promoteCore(cur));
  }, [commit]);
  tryPromoteRef.current = tryPromote;

  const resolvePermission = useCallback((requestId: string, behavior: 'allow' | 'deny' | 'allow_session') => {
    flushPending();
    commit(resolvePermissionCore(coreRef.current, requestId, behavior));
    tryPromote();
  }, [commit, flushPending, tryPromote]);

  const resolveAskUser = useCallback((requestId: string, answers: Record<string, string>) => {
    flushPending();
    commit(resolveAskUserCore(coreRef.current, requestId, answers));
    tryPromote();
  }, [commit, flushPending, tryPromote]);

  const markAllPendingCancelled = useCallback(() => {
    flushPending();
    commit(cancelAllPendingCore(coreRef.current));
    tryPromote();
  }, [commit, flushPending, tryPromote]);

  const onSessionComplete = useCallback(() => {
    if (!initRef.current.ready) {
      pendingCompleteRef.current = true;
      return;
    }
    flushPending();
    settledRef.current = true;
    commit(settleTailCore(coreRef.current));
    tryPromote();
  }, [commit, flushPending, tryPromote]);

  const getMessages = useCallback(() => [...coreRef.current.stable, ...coreRef.current.live], []);

  return {
    stableHistory: structural.stableHistory,
    pendingActions: structural.pendingActions,
    structuralVersion: structural.structuralVersion,
    structuredLiveTail: structural.structuredLiveTail,
    transcriptStore: store,
    getMessages,
    loadHistory,
    enqueueStreamEvent,
    applySnapshot,
    pushLocalUser,
    pushLiveAssistant,
    replaceLastLiveAssistant,
    insertLocalBlock,
    registerPermission,
    registerAskUser,
    resolvePermission,
    resolveAskUser,
    markAllPendingCancelled,
    onSessionComplete,
  };
}
