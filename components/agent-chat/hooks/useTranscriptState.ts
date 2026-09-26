/**
 * 转写状态 hook：初始化握手、批式 flush、pending 变更缓冲
 * 纯 reducer 在 transcript-core.ts，外部订阅 store 在 transcript-store.ts
 */
import { useRef, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Message, ContentBlock } from '../types';
import type { LivePermissionRequest } from './useAgentSession';
import {
  applyEventToCore,
  appendPendingBlockCore,
  buildAskUserBlock,
  buildPermissionBlock,
  cancelAllPendingCore,
  drainPendingStreamEvents,
  initialTranscriptCore,
  insertLocalBlockCore,
  isDeltaStreamEvent,
  loadHistoryCore,
  mergeHistorySnapshotCore,
  promoteCore,
  pushLiveAssistantCore,
  pushLocalUserCore,
  replaceLastLiveAssistantCore,
  resolveAskUserCore,
  resolvePermissionCore,
  settleTailCore,
} from './transcript-core';
import type {
  PendingAction,
  PendingStreamEvent,
  StreamEventSideEffect,
  TranscriptCore,
  TranscriptEvent,
} from './transcript-core';
import { createTranscriptStore, publishTranscriptStore } from './transcript-store';
import type { TranscriptStore, TranscriptStoreApi } from './transcript-store';

export * from './transcript-core';
export * from './transcript-store';

export interface UseTranscriptStateResult {
  initReady: boolean;
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
  const [initReady, setInitReady] = useState(conversationId === null);
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
    if (init.ready || (!force && init.history === undefined)) return;
    // timedOut 语义：ready 时仍有未到方（history 到而 snapshot 未到，或 force 下 history 也没到），后到方需走 merge 重建
    const nextInit = { ...init, ready: true, timedOut: init.history === undefined || init.snapshotEvents === undefined };
    initRef.current = nextInit;
    setInitReady(true);
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
    setInitReady(conversationId === null);
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
    initReady,
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
