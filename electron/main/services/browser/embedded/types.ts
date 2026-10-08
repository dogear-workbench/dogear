import type { BrowserWindow, Rectangle, Session, WebContentsView } from 'electron';
import type { BrowserTaskMeta } from '../browser-task-meta.js';

export type EmbeddedTabSource = 'agent-opened' | 'user-connected';

export type EmbeddedPageState =
  | 'loading'
  | 'ready'
  | 'login_required'
  | 'verification_required'
  | 'awaiting_human'
  | 'rate_limited'
  | 'changed_layout'
  | 'crashed';

export interface EmbeddedTabSnapshot {
  tabId: string
  source: EmbeddedTabSource
  workspaceId: string
  url: string
  title: string
  generation: number
  state: EmbeddedPageState
  attached: boolean
  holders: string[]
  takeover: { active: boolean } | null
  canGoBack: boolean
  canGoForward: boolean
}

export interface EmbeddedTabRecord {
  tabId: string
  source: EmbeddedTabSource
  workspaceId: string
  view: WebContentsView
  url: string
  title: string
  generation: number
  state: EmbeddedPageState
  holders: Set<string>
  lastActivityAt: number
  attachedWindow: BrowserWindow | null
  bounds: Rectangle | null
  takeover: { active: boolean; taskMeta?: BrowserTaskMeta } | null
}

export interface EmbeddedWorkspaceRecord {
  workspaceId: string
  partition: string
  session: Session
  tabs: Map<string, EmbeddedTabRecord>
  agentTabId: string | null
  activeTabId: string | null
}

export interface OpenEmbeddedTabInput {
  workspaceId: string
  url: string
  source: EmbeddedTabSource
  holderId?: string
  skipInitialLoad?: boolean
}
