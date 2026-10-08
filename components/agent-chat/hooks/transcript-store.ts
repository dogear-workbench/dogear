/**
 * 转写外部订阅 store：结构化快照发布与 live tail 订阅
 */
import { useSyncExternalStore } from 'react';
import type { Message } from '../types';
import { initialTranscriptCore } from './transcript-core';
import type { TranscriptCore, PendingAction } from './transcript-core';

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

export interface TranscriptStore extends TranscriptStoreApi {
  core: TranscriptCore;
  structuralSnapshot: TranscriptStructuralSnapshot;
  listeners: Set<() => void>;
  getStructuralSnapshot: () => TranscriptStructuralSnapshot;
}

export function createTranscriptStore(): TranscriptStore {
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

export function publishTranscriptStore(store: TranscriptStore, next: TranscriptCore): void {
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
