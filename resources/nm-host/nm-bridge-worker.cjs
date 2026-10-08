const fs = require('fs');
const net = require('net');

const ARG_PREFIX = '--nm-gateway=';
const gwArg = process.argv.find((a) => a.startsWith(ARG_PREFIX));
const PIPE_PATH = gwArg ? gwArg.slice(ARG_PREFIX.length) : '\\\\.\\pipe\\dogear-nm-gateway';
const CONNECT_RETRY_INTERVAL_MS = 500;
const CONNECT_MAX_WAIT_MS = 3000;

function describeError(err) {
  return err instanceof Error ? err.message : String(err);
}

function connectGatewayPipe() {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const attempt = () => {
      const socket = net.connect(PIPE_PATH);
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

connectGatewayPipe().then(
  (pipe) => {
    const stdoutStream = fs.createWriteStream(null, { fd: 1 });
    const stdinStream = fs.createReadStream(null, { fd: 0 });
    pipe.on('data', (chunk) => stdoutStream.write(chunk));
    pipe.on('error', () => process.exit(0));
    pipe.on('close', () => process.exit(0));
    stdinStream.on('data', (chunk) => pipe.write(chunk));
    stdinStream.on('end', () => process.exit(0));
    stdinStream.on('error', () => process.exit(0));
    stdoutStream.on('error', () => process.exit(0));
  },
  (err) => {
    process.stderr.write('[nm-bridge] 连接 Dogear 网关管道失败: ' + describeError(err) + '\n');
    process.exit(1);
  }
);
