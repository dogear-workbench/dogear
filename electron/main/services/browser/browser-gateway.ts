import { unlinkSync } from 'node:fs';
import net from 'node:net';
import { mainLogger } from '../../agents/logger.js';
import {
  encodeNmFrame,
  makeNmDecoder,
  nmGatewayAddress,
  ProtocolVersion,
  type CommandErrorCode,
  type CommandKind,
  type CommandResult,
  type NmMessage,
  type PageHandoffMessage,
} from './nm-protocol.js';
import { resetChannel } from './extension-ownership.js';
import {
  adoptFocusedTab,
  applyTabSnapshot,
  initialTabFields,
  removeClosedTab,
  syncTabsFromList,
  type GatewayTabEntry,
  type GatewayTabFields,
} from './gateway-tab-state.js';

export type ExtensionStatus =
  | { status: 'disconnected' }
  | ({
      status: 'connected';
      extensionVersion: string;
      protocolVersion: number;
      connectedAt: number;
      extractError?: string;
    } & GatewayTabFields);

export type { GatewayTabEntry };

export interface CommandError {
  errorCode: CommandErrorCode;
  error: string;
  /** 扩展侧拒绝时附带的自愈信息：拒绝瞬间的受控页地址（command_result 可选字段透传） */
  currentUrl?: string;
  /** 扩展侧 guard 拒绝附带的补充数据（如 guard_submit 的 submitTarget） */
  data?: unknown;
}

interface PendingCommand {
  kind: CommandKind;
  resolve: (result: CommandResult) => void;
  reject: (error: CommandError) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const CLOSE_WAIT_MS = 3000;
const COMMAND_ERROR_CODES: readonly CommandErrorCode[] = [
  'not_connected',
  'stale_protocol',
  'timeout',
  'disconnected',
  'stale_tab',
  'navigated_away',
  'tab_closed',
  'permission_denied',
  'ref_expired',
  'value_mismatch',
  'guard_password',
  'guard_submit',
  'navigation_blocked',
];

const pendingCommands = new Map<string, PendingCommand>();
let commandSeq = 0;

const logger = mainLogger.child('browser-gateway');

type StatusBroadcaster = (status: ExtensionStatus) => void;

let broadcaster: StatusBroadcaster | null = null;
let currentStatus: ExtensionStatus = { status: 'disconnected' };
let activeSocket: net.Socket | null = null;
let initialized = false;
let gatewayAppVersion = '';
let gatewayServer: net.Server | null = null;
let gatewaySocketPath: string | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

/** 注册制广播（对齐 browser-action-stream 模式：服务层零 electron 依赖，tipc 层接线） */
export function setExtensionStatusBroadcaster(fn: StatusBroadcaster | null): void {
  broadcaster = fn;
}

type HandoffHandler = (handoff: PageHandoffMessage) => void;

let handoffHandler: HandoffHandler | null = null;

/** 注册制回调（对齐 setExtensionStatusBroadcaster）：page_handoff 是独立事件流，不进 ExtensionStatus */
export function setHandoffHandler(fn: HandoffHandler | null): void {
  handoffHandler = fn;
}

export function getExtensionStatus(): ExtensionStatus {
  return currentStatus;
}

function setStatus(next: ExtensionStatus): void {
  currentStatus = next;
  broadcaster?.(currentStatus);
}

function safeWrite(socket: net.Socket, message: NmMessage): void {
  if (socket.destroyed) return;
  socket.write(encodeNmFrame(message));
}

function rejectAllPending(error: CommandError): void {
  if (pendingCommands.size === 0) return;
  for (const pending of pendingCommands.values()) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  pendingCommands.clear();
}

function takeOver(socket: net.Socket, extensionVersion: string, protocolVersion: number, tabId: number): void {
  if (activeSocket && activeSocket !== socket && !activeSocket.destroyed) {
    safeWrite(activeSocket, { type: 'goodbye' });
    activeSocket.destroy();
    logger.info('单会话接管：旧连接已发送 goodbye 并关闭');
  }
  rejectAllPending({ errorCode: 'disconnected', error: '扩展连接已切换，命令已取消' });
  activeSocket = socket;
  setStatus({
    status: 'connected',
    extensionVersion,
    protocolVersion,
    connectedAt: Date.now(),
    ...initialTabFields(tabId),
  });
  safeWrite(socket, { type: 'welcome', appVersion: gatewayAppVersion });
  logger.info('扩展已连接', `v${extensionVersion}`, `protocol=${protocolVersion}`, `tabId=${tabId}`);
}

function applySnapshot(message: NmMessage): void {
  if (currentStatus.status !== 'connected') {
    logger.warn('未连接状态下收到 tab_snapshot，已忽略');
    return;
  }
  const prevTabId = currentStatus.tabId;
  const snapTabId = typeof message.tabId === 'number' ? message.tabId : prevTabId;
  const extractError =
    typeof message.extractError === 'string' && message.extractError.length > 0
      ? message.extractError
      : undefined;
  const fields = applyTabSnapshot(currentStatus, message);
  if (fields.tabId === prevTabId && fields.url !== currentStatus.url) {
    logger.warn(`焦点页面导航: tabId=${fields.tabId} ${currentStatus.url} -> ${fields.url}`);
  }
  const extractErrorPatch =
    snapTabId === prevTabId
      ? extractError !== undefined
        ? { extractError }
        : { extractError: undefined }
      : fields.tabId !== prevTabId
        ? { extractError: undefined }
        : {};
  setStatus({ ...currentStatus, ...fields, ...extractErrorPatch });
  logger.info('标签页快照已更新', fields.url, `tabId=${fields.tabId}`);
}

export function validateNavigateTarget(targetUrl: unknown): CommandError | null {
  if (typeof targetUrl !== 'string' || targetUrl.length === 0) {
    return { errorCode: 'navigation_blocked', error: 'navigate 缺少有效的目标地址' };
  }
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return { errorCode: 'navigation_blocked', error: '目标地址不是合法 URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { errorCode: 'navigation_blocked', error: '仅支持 http/https 目标地址' };
  }
  return null;
}

function applyNavigateUrl(data: unknown): void {
  const url = (data as { url?: unknown } | null | undefined)?.url;
  if (typeof url !== 'string' || url.length === 0) return;
  if (currentStatus.status !== 'connected') return;
  setStatus({ ...currentStatus, url });
}

function applyOpenTabResult(data: unknown): void {
  if (currentStatus.status !== 'connected') return;
  const d = (data ?? {}) as { tabId?: unknown; url?: unknown; title?: unknown };
  if (typeof d.tabId !== 'number') return;
  setStatus({ ...currentStatus, ...adoptFocusedTab(currentStatus, d.tabId, { url: d.url, title: d.title }) });
}

function applyClickResult(data: unknown): void {
  if (currentStatus.status !== 'connected') return;
  const d = ((data ?? {}) as { openedTab?: { tabId?: unknown; url?: unknown; title?: unknown } }).openedTab;
  if (!d || typeof d.tabId !== 'number') return;
  setStatus({ ...currentStatus, ...adoptFocusedTab(currentStatus, d.tabId, { url: d.url, title: d.title }) });
}

function applyCloseTabResult(data: unknown): void {
  if (currentStatus.status !== 'connected') return;
  const d = (data ?? {}) as { closedTabId?: unknown; focusedTabId?: unknown };
  if (typeof d.closedTabId !== 'number') return;
  setStatus({ ...currentStatus, ...removeClosedTab(currentStatus, d.closedTabId, d.focusedTabId) });
}

function applyListTabsResult(data: unknown): void {
  if (currentStatus.status !== 'connected') return;
  setStatus({ ...currentStatus, ...syncTabsFromList(currentStatus, data) });
}

function parseErrorCode(value: unknown): CommandErrorCode {
  return typeof value === 'string' && (COMMAND_ERROR_CODES as readonly string[]).includes(value)
    ? (value as CommandErrorCode)
    : 'stale_protocol';
}

function handleCommandResult(message: NmMessage): void {
  const requestId = typeof message.requestId === 'string' ? message.requestId : null;
  if (!requestId) {
    logger.warn('command_result 缺少 requestId，已忽略');
    return;
  }
  const pending = pendingCommands.get(requestId);
  if (!pending) {
    logger.warn('command_result 未命中等待中的命令（迟到或未知），已忽略', `requestId=${requestId}`);
    return;
  }
  pendingCommands.delete(requestId);
  clearTimeout(pending.timer);
  if (pending.kind === 'click') {
    logger.warn(
      `click 命令结果: ok=${message.ok === true} errorCode=${typeof message.errorCode === 'string' ? message.errorCode : '-'} confirmed=${(message.data as { confirmed?: unknown } | undefined)?.confirmed === true}`,
    );
  }
  if (message.ok === true) {
    if (pending.kind === 'navigate') applyNavigateUrl(message.data);
    else if (pending.kind === 'open_tab') applyOpenTabResult(message.data);
    else if (pending.kind === 'click') applyClickResult(message.data);
    else if (pending.kind === 'close_tab') applyCloseTabResult(message.data);
    else if (pending.kind === 'list_tabs') applyListTabsResult(message.data);
    pending.resolve({
      requestId,
      ok: true,
      ...(message.data !== undefined ? { data: message.data } : {}),
    });
    return;
  }
  pending.reject({
    errorCode: parseErrorCode(message.errorCode),
    error:
      typeof message.error === 'string' && message.error.length > 0
        ? message.error
        : '扩展返回了不合规的失败结果',
    ...(typeof message.currentUrl === 'string' && message.currentUrl.length > 0
      ? { currentUrl: message.currentUrl }
      : {}),
    ...(message.data !== undefined ? { data: message.data } : {}),
  });
}

function applyHandoff(message: NmMessage): void {
  const url = typeof message.url === 'string' ? message.url : '';
  if (url.length === 0) {
    logger.warn('page_handoff 缺少 url，已忽略');
    return;
  }
  if (!handoffHandler) {
    logger.warn('page_handoff 无处理器，已忽略:', url);
    return;
  }
  const selectionText = typeof message.selectionText === 'string' ? message.selectionText : '';
  const textExcerpt = typeof message.textExcerpt === 'string' ? message.textExcerpt : '';
  handoffHandler({
    type: 'page_handoff',
    url,
    title: typeof message.title === 'string' ? message.title : '',
    ...(selectionText.length > 0 ? { selectionText } : {}),
    ...(textExcerpt.length > 0 ? { textExcerpt } : {}),
  });
}

function handleFrame(socket: net.Socket, message: NmMessage): void {
  const type = message.type;
  if (type === 'hello') {
    const extensionVersion = typeof message.extensionVersion === 'string' ? message.extensionVersion : null;
    const tabId = typeof message.tabId === 'number' ? message.tabId : null;
    if (!extensionVersion || tabId === null) {
      logger.warn('hello 缺少必要字段，已忽略');
      return;
    }
    const protocolVersion = typeof message.protocolVersion === 'number' ? message.protocolVersion : 1;
    takeOver(socket, extensionVersion, protocolVersion, tabId);
    return;
  }
  if (type === 'tab_snapshot') {
    applySnapshot(message);
    return;
  }
  if (type === 'command_result') {
    handleCommandResult(message);
    return;
  }
  if (type === 'page_handoff') {
    applyHandoff(message);
    return;
  }
  if (type === 'protocol_error') {
    logger.warn('收到坏帧，已忽略:', String(message.error));
    return;
  }
  logger.warn('未知消息类型，已忽略:', String(type));
}

function handleDisconnect(socket: net.Socket): void {
  if (activeSocket !== socket) return;
  activeSocket = null;
  rejectAllPending({ errorCode: 'disconnected', error: '扩展连接已断开' });
  setStatus({ status: 'disconnected' });
  resetChannel();
  logger.info('扩展连接断开');
}

export interface SendExtensionCommandOptions {
  /** 目标 tab；缺省用焦点 tab（协议帧 tabId/url 与扩展侧 navigated_away 检查都依赖它） */
  tabId?: number;
}

export function sendExtensionCommand(
  kind: CommandKind,
  params: Record<string, unknown>,
  timeoutMs: number = DEFAULT_COMMAND_TIMEOUT_MS,
  opts?: SendExtensionCommandOptions,
): Promise<CommandResult> {
  const socket = activeSocket;
  if (!socket || socket.destroyed) {
    return Promise.reject({ errorCode: 'not_connected', error: '扩展未连接' } satisfies CommandError);
  }
  if (currentStatus.status !== 'connected' || currentStatus.protocolVersion < ProtocolVersion) {
    return Promise.reject({
      errorCode: 'stale_protocol',
      error: '扩展版本过旧，请在浏览器扩展管理页重载 Dogear 扩展',
    } satisfies CommandError);
  }
  const targetTabId = opts?.tabId ?? currentStatus.tabId;
  const targetUrl =
    targetTabId === currentStatus.tabId
      ? currentStatus.url
      : currentStatus.tabs.find((t) => t.tabId === targetTabId)?.url ?? '';
  if (kind === 'navigate' || kind === 'open_tab') {
    const blocked = validateNavigateTarget(params.targetUrl);
    if (blocked) return Promise.reject(blocked);
  }
  const requestId = `${Date.now()}-${++commandSeq}`;
  return new Promise<CommandResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCommands.delete(requestId);
      reject({ errorCode: 'timeout', error: '命令执行超时' } satisfies CommandError);
    }, timeoutMs);
    pendingCommands.set(requestId, { kind, resolve, reject, timer });
    safeWrite(socket, { type: 'command', requestId, tabId: targetTabId, url: targetUrl, kind, params });
  });
}

function handleConnection(socket: net.Socket): void {
  const decoder = makeNmDecoder();
  decoder.onFrame((message) => handleFrame(socket, message));
  socket.on('data', (chunk) => decoder.push(chunk));
  socket.on('close', () => handleDisconnect(socket));
  socket.on('error', (err) => {
    logger.warn('连接错误:', err.message);
    socket.destroy();
  });
}

function startHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    const socket = activeSocket;
    if (socket && !socket.destroyed) safeWrite(socket, { type: 'ping' });
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (!heartbeatTimer) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function unlinkGatewaySocket(): void {
  if (!gatewaySocketPath || process.platform === 'win32') return;
  try {
    unlinkSync(gatewaySocketPath);
  } catch {}
}

/** app ready 时调用一次；appVersion/userDataDir 由调用方传入保持服务层零 electron 依赖 */
export function initBrowserGateway(appVersion: string, userDataDir: string): void {
  if (initialized) return;
  initialized = true;
  gatewayAppVersion = appVersion;
  gatewaySocketPath = nmGatewayAddress(userDataDir);
  const server = net.createServer(handleConnection);
  server.on('error', (err) => {
    logger.error('浏览器扩展网关管道启动失败:', err.message);
  });
  server.on('close', () => unlinkGatewaySocket());
  unlinkGatewaySocket();
  server.listen(gatewaySocketPath, () => {
    logger.info('浏览器扩展网关已就绪:', gatewaySocketPath);
  });
  gatewayServer = server;
  startHeartbeat();
}

/** 退出前收尾：goodbye 广播 → 管道 end（等 bridge 退出最多 CLOSE_WAIT_MS 后强拆）→ 停止管道监听 + darwin socket 文件清理；幂等可重复调用 */
export function closeBrowserGateway(): Promise<void> {
  stopHeartbeat();
  if (gatewayServer) {
    gatewayServer.close();
    gatewayServer = null;
  } else {
    unlinkGatewaySocket();
  }
  const socket = activeSocket;
  if (!socket || socket.destroyed) {
    activeSocket = null;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      logger.warn('扩展网关关闭等待超时，强制断开管道');
      socket.destroy();
      finish();
    }, CLOSE_WAIT_MS);
    socket.once('close', finish);
    safeWrite(socket, { type: 'goodbye' });
    logger.info('关闭浏览器扩展网关：已广播 goodbye');
    socket.end();
  });
}
