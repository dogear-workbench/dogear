export const NM_GATEWAY_PIPE_PATH = '\\\\.\\pipe\\dogear-nm-gateway';

const HEADER_SIZE = 4;
const MAX_FRAME_BYTES = 64 * 1024 * 1024;

export type NmMessage = Record<string, unknown>;

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
