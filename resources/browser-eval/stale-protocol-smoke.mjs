import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');

process.env.DOGEAR_CONFIG_DIR = mkdtempSync(path.join(os.tmpdir(), 'dogear-stale-proto-'));

const tmpDir = mkdtempSync(path.join(projectRoot, '.tmp-stale-proto-'));
const distCopy = path.join(tmpDir, 'dist');
cpSync(path.join(projectRoot, 'dist'), distCopy, { recursive: true });
const nmProtocolCopy = path.join(distCopy, 'main', 'services', 'browser', 'nm-protocol.js');
writeFileSync(
  nmProtocolCopy,
  readFileSync(nmProtocolCopy, 'utf-8').replaceAll('dogear-nm-gateway', 'dogear-nm-gateway-stale-test'),
);

register('./electron-hooks.mjs', pathToFileURL(path.join(here, 'electron-hooks.mjs')).href);

const TEST_PIPE = '\\\\.\\pipe\\dogear-nm-gateway-stale-test';
const TAB_ID = 7777;

const { initBrowserGateway, sendExtensionCommand, getExtensionStatus } = await import(
  pathToFileURL(path.join(distCopy, 'main', 'services', 'browser', 'browser-gateway.js')).href
);
const { encodeNmFrame, makeNmDecoder } = await import(
  pathToFileURL(path.join(distCopy, 'main', 'services', 'browser', 'nm-protocol.js')).href
);

initBrowserGateway('stale-test');
await new Promise((resolve) => setTimeout(resolve, 200));

let failures = 0;
const check = (name, cond) => {
  console.log(cond ? `PASS ${name}` : `FAIL ${name}`);
  if (!cond) failures++;
};

const connectSocket = () =>
  new Promise((resolve, reject) => {
    const socket = net.connect(TEST_PIPE);
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });

const errCodeOf = (p) =>
  p.then(
    () => null,
    (e) => e?.errorCode ?? null,
  );

const caseA = await connectSocket();
const aCode = await errCodeOf(sendExtensionCommand('observe', {}));
check('A: socket 连上但无 hello → not_connected（未握手不占用 activeSocket）', aCode === 'not_connected');
check('A: 此刻 status 仍 disconnected', getExtensionStatus().status === 'disconnected');

const caseB = await connectSocket();
const decoderB = makeNmDecoder();
caseB.on('data', (c) => decoderB.push(c));
caseB.write(encodeNmFrame({ type: 'hello', extensionVersion: '0.0.0', protocolVersion: 1, tabId: TAB_ID }));
await new Promise((resolve) => {
  decoderB.onFrame((m) => (m.type === 'welcome' ? resolve() : null));
});
check('B: 旧协议 hello 后 status=connected 且版本记 1', (() => {
  const s = getExtensionStatus();
  return s.status === 'connected' && s.protocolVersion === 1;
})());
const bCode = await errCodeOf(sendExtensionCommand('observe', {}));
check('B: protocolVersion 1 < 3 → stale_protocol', bCode === 'stale_protocol');

const caseC = await connectSocket();
const decoderC = makeNmDecoder();
caseC.on('data', (c) => decoderC.push(c));
caseC.write(encodeNmFrame({ type: 'hello', extensionVersion: '0.0.0', protocolVersion: 3, tabId: TAB_ID }));
caseC.write(encodeNmFrame({ type: 'permission_state', origins: ['https://www.example.com'] }));
caseC.write(
  encodeNmFrame({ type: 'tab_snapshot', tabId: TAB_ID, title: 't', url: 'https://www.example.com/x', textPreview: '' }),
);
await new Promise((resolve) => {
  const poll = setInterval(() => {
    const s = getExtensionStatus();
    if (s.status === 'connected' && s.protocolVersion === 3 && s.url === 'https://www.example.com/x') {
      clearInterval(poll);
      resolve();
    }
  }, 20);
  setTimeout(() => {
    clearInterval(poll);
    resolve();
  }, 1500);
});
let snapshotSeen = new Promise((resolve) => {
  decoderC.onFrame((m) => (m.type === 'command' ? resolve(m) : null));
  setTimeout(resolve, 1500);
});
const commandPromise = sendExtensionCommand('observe', {});
const cmd = await snapshotSeen;
if (cmd) caseC.write(encodeNmFrame({ type: 'command_result', requestId: cmd.requestId, ok: true, data: { total: 0, elements: [] } }));
const cResult = await commandPromise.then(
  (r) => r.ok === true,
  () => false,
);
check('C: 正常握手后命令链路通（对照组）', cResult);

caseA.destroy();
caseB.destroy();
caseC.destroy();
rmSync(tmpDir, { recursive: true, force: true });
process.exit(failures > 0 ? 1 : 0);
