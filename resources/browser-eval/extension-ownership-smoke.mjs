import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');

const profileDir = mkdtempSync(path.join(os.tmpdir(), 'dogear-p3-ownership-'));
process.env.DOGEAR_CONFIG_DIR = profileDir;

const tmpDir = mkdtempSync(path.join(projectRoot, '.tmp-p3-ownership-'));
const distCopy = path.join(tmpDir, 'dist');
cpSync(path.join(projectRoot, 'dist'), distCopy, { recursive: true });
const nmProtocolCopy = path.join(distCopy, 'main', 'services', 'browser', 'nm-protocol.js');
writeFileSync(
  nmProtocolCopy,
  readFileSync(nmProtocolCopy, 'utf-8').replaceAll('dogear-nm-gateway', 'dogear-nm-gateway-p3own'),
);

register('./electron-hooks.mjs', pathToFileURL(path.join(here, 'electron-hooks.mjs')).href);

const TEST_PIPE = '\\\\.\\pipe\\dogear-nm-gateway-p3own';
const TAB_ID = 5150;

const ownershipUrl = pathToFileURL(path.join(distCopy, 'main', 'services', 'browser', 'extension-ownership.js')).href;
const gatewayUrl = pathToFileURL(path.join(distCopy, 'main', 'services', 'browser', 'browser-gateway.js')).href;
const toolsUrl = pathToFileURL(path.join(distCopy, 'main', 'agents', 'tools', 'extension-tools.js')).href;
const streamUrl = pathToFileURL(path.join(distCopy, 'main', 'services', 'browser', 'browser-action-stream.js')).href;

const ownership = await import(ownershipUrl);
const { initBrowserGateway, getExtensionStatus } = await import(gatewayUrl);
const { createExtensionToolDefs } = await import(toolsUrl);
const { getBrowserActionHistory } = await import(streamUrl);
const { encodeNmFrame, makeNmDecoder } = await import(
  pathToFileURL(path.join(distCopy, 'main', 'services', 'browser', 'nm-protocol.js')).href
);

initBrowserGateway('p3own-test');

let failures = 0;
let passes = 0;
function check(name, cond, extra = '') {
  if (cond) {
    passes += 1;
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL ${name}${extra ? `（${extra}）` : ''}`);
  }
}
const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const textOf = (r) => r.content.map((c) => c.text).join('\n');
const isErr = (r) => r.isError === true;

const { IDLE_RELEASE_MS, acquireChannel, releaseChannel, resetChannel } = ownership;

check('K0 IDLE_RELEASE_MS 为 10 分钟', IDLE_RELEASE_MS === 10 * 60 * 1000);

resetChannel();
const t0 = 1_000_000;
check('K1 首个 owner 获取成功', acquireChannel('conv-a', t0).ok === true);
const busyB = acquireChannel('conv-b', t0 + 1000);
check(
  'K2 不同 owner busy 且携带 idleMs',
  busyB.ok === false && busyB.busy === true && busyB.idleMs === 1000,
);
check('K3 同 owner 续期成功', acquireChannel('conv-a', t0 + 2000).ok === true);
const stillBusy = acquireChannel('conv-b', t0 + 2000 + IDLE_RELEASE_MS - 1);
check('K4 空闲未满 10 分钟仍 busy', stillBusy.ok === false && stillBusy.busy === true);
const takeoverAt = t0 + 2000 + IDLE_RELEASE_MS;
check('K5 空闲满 10 分钟后新 owner 可夺取', acquireChannel('conv-b', takeoverAt).ok === true);
const busyA = acquireChannel('conv-a', takeoverAt + 500);
check('K6 夺取后旧 owner 反被 busy', busyA.ok === false && busyA.busy === true);
releaseChannel('conv-zzz');
check('K7 release 非持有者不生效', acquireChannel('conv-a', takeoverAt + 600).ok === false);
releaseChannel('conv-b');
check('K8 持有者显式 release 后其他会话可获取', acquireChannel('conv-a', takeoverAt + 700).ok === true);
resetChannel();
check('K9 resetChannel 清零后任意会话可获取', acquireChannel('conv-c', takeoverAt + 800).ok === true);
resetChannel();

let responder = null;

function connectAndHello(extensionVersion) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(TEST_PIPE);
    socket.once('error', reject);
    socket.once('connect', () => {
      const decoder = makeNmDecoder();
      decoder.onFrame((m) => {
        if (m.type === 'welcome') resolve(socket);
        else if (m.type === 'command' && responder) responder(m, socket);
      });
      socket.on('data', (chunk) => decoder.push(chunk));
      socket.write(
        encodeNmFrame({ type: 'hello', extensionVersion, protocolVersion: 3, tabId: TAB_ID }),
      );
    });
  });
}

function reply(cmd, socket, body) {
  socket.write(encodeNmFrame({ type: 'command_result', requestId: cmd.requestId, ...body }));
}

function defaultSuccess(cmd, socket) {
  const data =
    cmd.kind === 'navigate'
      ? { url: cmd.params.targetUrl }
      : cmd.kind === 'observe'
        ? {
            total: 1,
            regionCounts: { top: 1, middle: 0, bottom: 0 },
            elements: [{ ref: 'e1', tag: 'a', role: 'link', text: '下一页', hint: '' }],
          }
        : cmd.kind === 'read_text'
          ? { text: '正文内容', totalLength: 4 }
          : { clicked: true };
  reply(cmd, socket, { ok: true, data });
}
responder = defaultSuccess;

const toolsByConv = new Map();
function toolDefsFor(conversationId) {
  if (!toolsByConv.has(conversationId)) {
    toolsByConv.set(conversationId, createExtensionToolDefs(conversationId ? { conversationId } : undefined));
  }
  return toolsByConv.get(conversationId);
}
function call(conversationId, name, args) {
  const def = toolDefsFor(conversationId).find((t) => t.name === `dogear__extension__${name}`);
  if (!def) throw new Error(`工具未注册: ${name}`);
  return def.handler(args);
}

let socket = await connectAndHello('0.0.0-p3own');
function setGatewayPage(url, origins) {
  socket.write(
    encodeNmFrame({ type: 'tab_snapshot', tabId: TAB_ID, title: '测试页', url, textPreview: '', generation: 0 }),
  );
  if (origins) socket.write(encodeNmFrame({ type: 'permission_state', origins }));
}

setGatewayPage('https://plain.example.com/page', ['https://plain.example.com']);
await sleepMs(80);

const OWNER = 'conv-owner';
const RIVAL = 'conv-rival';

const firstObserve = await call(OWNER, 'observe_page', {});
check('C1 持有会话首次调用成功', !isErr(firstObserve), textOf(firstObserve));

const rivalObserve = await call(RIVAL, 'observe_page', {});
check(
  'C2 竞争会话 busy：isError + 中文文案（含空闲时长与并行建议）',
  isErr(rivalObserve) &&
    textOf(rivalObserve).includes('扩展通道正被另一个会话使用') &&
    textOf(rivalObserve).includes('已空闲 1 分钟') &&
    textOf(rivalObserve).includes('受控浏览器'),
  textOf(rivalObserve),
);
const busyEvent = getBrowserActionHistory().filter((e) => e.result === 'busy').at(-1);
check(
  'C3 busy 动作进动作流（action=observe + conversationId=rival）',
  !!busyEvent && busyEvent.action === 'observe' && busyEvent.conversationId === RIVAL,
);
const rivalNav = await call(RIVAL, 'navigate', { url: 'https://plain.example.com/other' });
check('C4 busy 拦截覆盖 navigate', isErr(rivalNav) && textOf(rivalNav).includes('扩展通道正被另一个会话使用'), textOf(rivalNav));

const renewObserve = await call(OWNER, 'observe_page', {});
check('C5 持有会话续期不受影响', !isErr(renewObserve));

const adhocObserve = await call(undefined, 'observe_page', {});
check('C6 无 conversationId 的 adhoc 调用不参与独占', !isErr(adhocObserve), textOf(adhocObserve));

socket.destroy();
await sleepMs(150);
check('C7 断连后 gateway 状态 disconnected', getExtensionStatus().status === 'disconnected');

socket = await connectAndHello('0.0.0-p3own-reconnect');
setGatewayPage('https://plain.example.com/page', ['https://plain.example.com']);
await sleepMs(80);
const rivalAfterReconnect = await call(RIVAL, 'observe_page', {});
check(
  'C8 断连清零独占后原竞争会话可直接使用（无粘滞锁）',
  !isErr(rivalAfterReconnect),
  textOf(rivalAfterReconnect),
);

socket.destroy();
await sleepMs(100);
rmSync(tmpDir, { recursive: true, force: true });
rmSync(profileDir, { recursive: true, force: true });

console.log(`\n${passes} PASS / ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
