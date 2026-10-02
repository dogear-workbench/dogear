import { join } from 'path';

export const NM_WIN_PIPE_PATH = '\\\\.\\pipe\\dogear-nm-gateway';
export const NM_SOCKET_FILE = 'nm-gateway.sock';

/** win32 走 named pipe（路径固定）；darwin 走 userData 下 unix socket，路径由调用方传入 userDataDir */
export function nmGatewayAddress(userDataDir: string): string {
  return process.platform === 'win32' ? NM_WIN_PIPE_PATH : join(userDataDir, NM_SOCKET_FILE);
}

const HEADER_SIZE = 4;
const MAX_FRAME_BYTES = 64 * 1024 * 1024;

export type NmMessage = Record<string, unknown>;

export const ProtocolVersion = 4;

export type CommandKind =
  | 'observe'
  | 'find'
  | 'click'
  | 'fill'
  | 'read_text'
  | 'navigate'
  | 'read_state'
  | 'scroll'
  | 'open_tab'
  | 'close_tab'
  | 'list_tabs';

export type CommandErrorCode =
  | 'not_connected'
  | 'stale_protocol'
  | 'timeout'
  | 'disconnected'
  | 'stale_tab'
  | 'navigated_away'
  | 'tab_closed'
  | 'permission_denied'
  | 'ref_expired'
  | 'value_mismatch'
  | 'guard_password'
  | 'guard_submit'
  | 'navigation_blocked';

export interface ExtensionCommand {
  requestId: string;
  tabId: number;
  url: string;
  kind: CommandKind;
  params: Record<string, unknown>;
}

export interface CommandResult {
  requestId: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  errorCode?: CommandErrorCode;
}

export interface PermissionStateMessage {
  type: 'permission_state';
  origins: string[];
}

export interface NavigateCommandParams {
  targetUrl: string;
}

export interface ReadStateCommandParams {
  path?: string;
}

export interface OpenTabCommandParams {
  targetUrl: string;
  background?: boolean;
}

export interface CloseTabCommandParams {
  targetTabId?: number;
}

export interface TabSnapshotMessage {
  type: 'tab_snapshot';
  tabId: number;
  title: string;
  url: string;
  textPreview: string;
  extractError?: string;
  generation: number;
}

/** 扩展主动推送的一键移交帧；与 tab_snapshot 同类无 requestId，NmMessage 为宽 Record 故此类型仅作文档 */
export interface PageHandoffMessage {
  type: 'page_handoff';
  url: string;
  title: string;
  selectionText?: string;
  textExcerpt?: string;
}

export interface NmDecoder {
  onFrame(handler: (message: NmMessage) => void): void;
  push(chunk: Uint8Array): void;
}

export function encodeNmFrame(message: NmMessage): Buffer {
  const payload = Buffer.from(JSON.stringify(message), 'utf-8');
  const frame = Buffer.alloc(HEADER_SIZE + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, HEADER_SIZE);
  return frame;
}

export function makeNmDecoder(): NmDecoder {
  let buffer = Buffer.alloc(0);
  let frameHandler: ((message: NmMessage) => void) | null = null;

  const consume = () => {
    while (buffer.length >= HEADER_SIZE) {
      const length = buffer.readUInt32LE(0);
      if (buffer.length < HEADER_SIZE + length) return;
      if (length > MAX_FRAME_BYTES) {
        buffer = Buffer.alloc(0);
        frameHandler?.({ type: 'protocol_error', error: 'frame too large' });
        return;
      }
      const payload = buffer.subarray(HEADER_SIZE, HEADER_SIZE + length);
      buffer = buffer.subarray(HEADER_SIZE + length);
      let message: NmMessage;
      try {
        message = JSON.parse(payload.toString('utf-8')) as NmMessage;
      } catch {
        frameHandler?.({ type: 'protocol_error', error: 'invalid json frame' });
        continue;
      }
      frameHandler?.(message);
    }
  };

  return {
    onFrame(handler) {
      frameHandler = handler;
    },
    push(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      consume();
    },
  };
}
