import { app } from 'electron';
import * as fs from 'fs';
import * as net from 'net';
import { NM_GATEWAY_PIPE_PATH, encodeNmFrame, makeNmDecoder } from './nm-protocol.js';

const CONNECT_RETRY_INTERVAL_MS = 500;
const CONNECT_MAX_WAIT_MS = 3000;
const HEARTBEAT_TIMEOUT_MS = 30_000;
const HEARTBEAT_CHECK_INTERVAL_MS = 5_000;

export async function runNmBridge(): Promise<void> {
  app.disableHardwareAcceleration();

  let pipe: net.Socket;
  try {
    pipe = await connectGatewayPipe();
  } catch (err) {
    process.stderr.write(`[nm-bridge] 连接 Dogear 网关管道失败: ${describeError(err)}\n`);
    app.exit(1);
    return;
  }

  let lastActivityAt = Date.now();
  const touch = () => {
    lastActivityAt = Date.now();
  };

  pipe.on('error', () => app.exit(0));
  pipe.on('close', () => app.exit(0));

  await app.whenReady();
  const stdinStream = fs.createReadStream(null as unknown as fs.PathLike, { fd: 0 });
  stdinStream.on('data', (chunk) => {
    touch();
    pipe.write(chunk);
  });
  stdinStream.on('end', () => app.exit(0));
  stdinStream.on('error', () => app.exit(0));

  const stdoutStream = fs.createWriteStream(null as unknown as fs.PathLike, { fd: 1 });
  stdoutStream.on('error', () => app.exit(0));

  const decoder = makeNmDecoder();
  decoder.onFrame((message) => {
    if (message.type === 'ping') return;
    stdoutStream.write(encodeNmFrame(message));
  });
  pipe.on('data', (chunk) => {
    touch();
    decoder.push(chunk);
  });

  setInterval(() => {
    if (Date.now() - lastActivityAt <= HEARTBEAT_TIMEOUT_MS) return;
    process.stderr.write('[nm-bridge] 管道心跳超时（疑似半开），主动退出\n');
    app.exit(0);
  }, HEARTBEAT_CHECK_INTERVAL_MS);
}

function connectGatewayPipe(): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const attempt = () => {
      const socket = net.connect(NM_GATEWAY_PIPE_PATH);
      socket.once('connect', () => resolve(socket));
      socket.once('error', (err) => {
        socket.destroy();
        if (Date.now() - startedAt >= CONNECT_MAX_WAIT_MS) {
          reject(err);
          return;
        }
        setTimeout(attempt, CONNECT_RETRY_INTERVAL_MS);
      });
    };
    attempt();
  });
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
