/**
 * 扩展通道页面操作工具共享上下文：meta/emit/acquireGate/wallGate 闭包构建
 *
 * 从 extension-tools 拆出，read/act/nav 三域与 web 工具文件经 ExtensionToolContext 注入（循 SiteToolDeps/ExtensionTabToolDeps 先例）；
 * reasonOf 与 policyLogger 为跨域共用辅助（act+nav / read+nav），随本模块下发避免域文件互相 import。
 */

import { getExtensionStatus } from '../../services/browser/browser-gateway.js';
import type { BrowserActionType } from '../../services/browser/browser-action-stream.js';
import { acquireChannel, resetChannel } from '../../services/browser/extension-ownership.js';
import type { BrowserTaskMeta } from '../../services/browser/browser-task-meta.js';
import { mainLogger } from '../../agents/logger.js';
import {
  SHARED_SCOPE_NOTE,
  buildTaskMeta,
  busyChannelMessage,
  emitAction,
  isErrorResult,
  type ActionExtra,
} from './extension-command-shared.js';
import { loginWallGate } from './extension-login-wall.js';
import type { ToolResult } from '../pi/tool-adapter.js';

export const policyLogger = mainLogger.child('extension-policy');

export function reasonOf(data: unknown): string | null {
  const reason = (data as { reason?: unknown } | null | undefined)?.reason;
  return typeof reason === 'string' && reason ? reason : null;
}

export interface ExtensionToolContext {
  conversationId?: string;
  workspaceId?: string;
  workspacePath?: string;
  scopeNote: string;
  meta: () => BrowserTaskMeta;
  emit: (action: BrowserActionType, extra?: ActionExtra) => void;
  acquireGate: (action: BrowserActionType | null, detail: string, url?: string) => ToolResult | null;
  wallGate: (
    pageState: string | undefined,
    url: string | null | undefined,
    tabId: number | undefined,
    resumeNote: string,
  ) => Promise<ToolResult | null>;
}

export function createToolContext(opts?: {
  conversationId?: string;
  workspaceId?: string;
  workspacePath?: string;
}): ExtensionToolContext {
  const conversationId = opts?.conversationId;
  const meta = () => buildTaskMeta(conversationId);
  const emit = (action: BrowserActionType, extra?: ActionExtra): void => emitAction(meta(), action, extra);

  /** 各 handler 统一前置：断连清零独占 → 有 conversationId 时获取通道（busy 即拒，不排队）；action 为 null 的非页面操作（站点档案读写）busy 不记动作流 */
  function acquireGate(action: BrowserActionType | null, detail: string, url?: string): ToolResult | null {
    if (getExtensionStatus().status === 'disconnected') resetChannel();
    if (!conversationId) return null;
    const r = acquireChannel(conversationId, Date.now());
    if (r.ok) return null;
    if (action) {
      emitAction(meta(), action, { ...(url !== undefined ? { url } : {}), detail, result: 'busy' });
    }
    return isErrorResult(busyChannelMessage(r.idleMs));
  }

  /** 登录墙/验证墙闸口：命中则 raise 会话卡并阻塞等待用户处理（非命中返回 null 继续既有流程） */
  const wallGate = (
    pageState: string | undefined,
    url: string | null | undefined,
    tabId: number | undefined,
    resumeNote: string,
  ): Promise<ToolResult | null> => loginWallGate({ conversationId, pageState, url, tabId, resumeNote });

  return {
    conversationId,
    workspaceId: opts?.workspaceId,
    workspacePath: opts?.workspacePath,
    scopeNote: SHARED_SCOPE_NOTE,
    meta,
    emit,
    acquireGate,
    wallGate,
  };
}
