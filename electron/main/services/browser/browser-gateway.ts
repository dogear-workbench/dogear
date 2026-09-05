import net from 'node:net';
import { mainLogger } from '../../agents/logger.js';
import {
  encodeNmFrame,
  makeNmDecoder,
  NM_GATEWAY_PIPE_PATH,
  type NmMessage,
} from './nm-protocol.js';

export type ExtensionStatus =
  | { status: 'disconnected' }
  | {
      status: 'connected';
      extensionVersion: string;
      tabId: number;
      title: string;
      url: string;
      textPreview: string;
      extractError?: string;
      connectedAt: number;
    };

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

function takeOver(socket: net.Socket, extensionVersion: string, tabId: number): void {
  if (activeSocket && activeSocket !== socket && !activeSocket.destroyed) {
    safeWrite(activeSocket, { type: 'goodbye' });
    activeSocket.destroy();
    logger.info('单会话接管：旧连接已发送 goodbye 并关闭');
  }
  activeSocket = socket;
  setStatus({
    status: 'connected',
    extensionVersion,
    tabId,
    title: '',
    url: '',
    textPreview: '',
    connectedAt: Date.now(),
  });
  safeWrite(socket, { type: 'welcome', appVersion: gatewayAppVersion });
  logger.info('扩展已连接', `v${extensionVersion}`, `tabId=${tabId}`);
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
  setStatus({
    ...currentStatus,
    tabId,
    title,
    url,
    textPreview,
    ...(extractError !== undefined ? { extractError } : {}),
  });
  logger.info('标签页快照已更新', url, `tabId=${tabId}`);
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
    takeOver(socket, extensionVersion, tabId);
    return;
  }
  if (type === 'tab_snapshot') {
    applySnapshot(message);
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
  setStatus({ status: 'disconnected' });
  logger.info('扩展连接断开');
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
