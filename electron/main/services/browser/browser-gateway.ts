import net from 'node:net';
import { mainLogger } from '../../agents/logger.js';
import {
  encodeNmFrame,
  makeNmDecoder,
  NM_GATEWAY_PIPE_PATH,
  ProtocolVersion,
  type CommandErrorCode,
  type CommandKind,
  type CommandResult,
  type NmMessage,
} from './nm-protocol.js';
import { resetChannel } from './extension-ownership.js';

export type ExtensionStatus =
  | { status: 'disconnected' }
  | {
      status: 'connected';
      extensionVersion: string;
      protocolVersion: number;
      tabId: number;
      title: string;
      url: string;
      textPreview: string;
      extractError?: string;
      connectedAt: number;
      authorizedOrigins: string[];
      generation: number;
    };

export interface CommandError {
  errorCode: CommandErrorCode;
  error: string;
  /** 扩展侧拒绝时附带的自愈信息：拒绝瞬间的受控页地址（command_result 可选字段透传） */
  currentUrl?: string;
}

interface PendingCommand {
  kind: CommandKind;
  resolve: (result: CommandResult) => void;
  reject: (error: CommandError) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 30000;
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

/** 注册制广播（对齐 browser-action-stream 模式：服务层零 electron 依赖，tipc 层接线） */
export function setExtensionStatusBroadcaster(fn: StatusBroadcaster | null): void {
  broadcaster = fn;
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
    tabId,
    title: '',
    url: '',
    textPreview: '',
    connectedAt: Date.now(),
    authorizedOrigins: [],
    generation: 0,
  });
  safeWrite(socket, { type: 'welcome', appVersion: gatewayAppVersion });
  logger.info('扩展已连接', `v${extensionVersion}`, `protocol=${protocolVersion}`, `tabId=${tabId}`);
}

function applySnapshot(message: NmMessage): void {
  if (currentStatus.status !== 'connected') {
    logger.warn('未连接状态下收到 tab_snapshot，已忽略');
    return;
  }
  const tabId = typeof message.tabId === 'number' ? message.tabId : currentStatus.tabId;
  const title = typeof message.title === 'string' ? message.title : '';
  const url = typeof message.url === 'string' ? message.url : '';
  const textPreview = typeof message.textPreview === 'string' ? message.textPreview : '';
  const extractError =
    typeof message.extractError === 'string' && message.extractError.length > 0
      ? message.extractError
      : undefined;
  const generation = typeof message.generation === 'number' ? message.generation : currentStatus.generation;
  setStatus({
    ...currentStatus,
    tabId,
    title,
    url,
    textPreview,
    generation,
    ...(extractError !== undefined ? { extractError } : {}),
  });
  logger.info('标签页快照已更新', url, `tabId=${tabId}`);
}

function extractOrigin(url: string): string | null {
  try {
    const origin = new URL(url).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

function isOriginAuthorized(url: string, authorizedOrigins: string[]): boolean {
  if (authorizedOrigins.includes('<all_urls>')) return true;
  const origin = extractOrigin(url);
  return origin !== null && authorizedOrigins.includes(origin);
}

export function validateNavigateTarget(targetUrl: unknown, authorizedOrigins: string[]): CommandError | null {
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
  if (!isOriginAuthorized(parsed.href, authorizedOrigins)) {
    return { errorCode: 'navigation_blocked', error: '目标域名未授权，请在扩展弹窗授权后重试' };
  }
  return null;
}

function applyPermissionState(message: NmMessage): void {
  if (currentStatus.status !== 'connected') {
    logger.warn('未连接状态下收到 permission_state，已忽略');
    return;
  }
  const raw = Array.isArray(message.origins) ? message.origins : [];
  const origins = raw.filter((item): item is string => typeof item === 'string');
  setStatus({ ...currentStatus, authorizedOrigins: origins });
  logger.info('授权域名列表已更新:', origins.length > 0 ? origins.join(', ') : '(空)');
}

function applyNavigateUrl(data: unknown): void {
  const url = (data as { url?: unknown } | null | undefined)?.url;
  if (typeof url !== 'string' || url.length === 0) return;
  if (currentStatus.status !== 'connected') return;
  setStatus({ ...currentStatus, url });
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
  if (message.ok === true) {
    if (pending.kind === 'navigate') applyNavigateUrl(message.data);
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
  if (type === 'permission_state') {
    applyPermissionState(message);
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

export function sendExtensionCommand(
  kind: CommandKind,
  params: Record<string, unknown>,
  timeoutMs: number = DEFAULT_COMMAND_TIMEOUT_MS,
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
  if (kind === 'navigate') {
    const blocked = validateNavigateTarget(params.targetUrl, currentStatus.authorizedOrigins);
    if (blocked) return Promise.reject(blocked);
  } else if (!isOriginAuthorized(currentStatus.url, currentStatus.authorizedOrigins)) {
    return Promise.reject({
      errorCode: 'permission_denied',
      error: '当前标签页域名未授权，请在浏览器扩展 Dogear 弹窗中授权此域名后重试',
    } satisfies CommandError);
  }
  const requestId = `${Date.now()}-${++commandSeq}`;
  const { tabId, url } = currentStatus;
  return new Promise<CommandResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCommands.delete(requestId);
      reject({ errorCode: 'timeout', error: '命令执行超时' } satisfies CommandError);
    }, timeoutMs);
    pendingCommands.set(requestId, { kind, resolve, reject, timer });
    safeWrite(socket, { type: 'command', requestId, tabId, url, kind, params });
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

/** app ready 时调用一次；appVersion 由调用方传入保持服务层零 electron 依赖 */
export function initBrowserGateway(appVersion: string): void {
  if (initialized) return;
  initialized = true;
  gatewayAppVersion = appVersion;
  const server = net.createServer(handleConnection);
  server.on('error', (err) => {
    logger.error('浏览器扩展网关管道启动失败:', err.message);
  });
  server.listen(NM_GATEWAY_PIPE_PATH, () => {
    logger.info('浏览器扩展网关已就绪:', NM_GATEWAY_PIPE_PATH);
  });
}
