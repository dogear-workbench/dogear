import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');

const profileDir = mkdtempSync(path.join(os.tmpdir(), 'dogear-step3-site-tools-'));
process.env.DOGEAR_CONFIG_DIR = profileDir;

const tmpDir = mkdtempSync(path.join(projectRoot, '.tmp-step3-site-tools-'));
const distCopy = path.join(tmpDir, 'dist');
cpSync(path.join(projectRoot, 'dist'), distCopy, { recursive: true });
const nmProtocolCopy = path.join(distCopy, 'main', 'services', 'browser', 'nm-protocol.js');
writeFileSync(
  nmProtocolCopy,
  readFileSync(nmProtocolCopy, 'utf-8').replaceAll('dogear-nm-gateway', 'dogear-nm-gateway-st'),
);

register('./electron-hooks.mjs', pathToFileURL(path.join(here, 'electron-hooks.mjs')).href);

const TEST_PIPE = '\\\\.\\pipe\\dogear-nm-gateway-st';
const TAB_ID = 2048;

const gatewayUrl = pathToFileURL(path.join(distCopy, 'main', 'services', 'browser', 'browser-gateway.js')).href;
const toolsUrl = pathToFileURL(path.join(distCopy, 'main', 'agents', 'tools', 'extension-tools.js')).href;
const { initBrowserGateway, getExtensionStatus } = await import(gatewayUrl);
const { createExtensionToolDefs } = await import(toolsUrl);
const { encodeNmFrame, makeNmDecoder } = await import(
  pathToFileURL(path.join(distCopy, 'main', 'services', 'browser', 'nm-protocol.js')).href
);

initBrowserGateway('st-test');

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

const POINTER_TEXT = '本站有站点档案，建议先调 dogear__extension__site_knowledge 获取已知地图';
const knowledgeDir = () => path.join(profileDir, 'site-knowledge');
const findingFile = () => path.join(knowledgeDir(), 'pointer.example.com.md');

let defs;
{
  const defsPath = pathToFileURL(path.join(distCopy, 'main', 'agents', 'tools', 'extension-tools.js')).href;
  const mod = await import(defsPath);
  defs = mod.createExtensionToolDefs({ conversationId: 'conv-site-01' });
}
check('R1 site_knowledge 已注册且无参数', defs.some((t) => t.name === 'dogear__extension__site_knowledge' && Object.keys(t.schema.shape).length === 0));
check('R2 site_finding 已注册且 finding 参数存在', defs.some((t) => t.name === 'dogear__extension__site_finding' && typeof t.schema.shape.finding === 'object'));

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
  const data = cmd.kind === 'navigate' ? { url: cmd.params.targetUrl } : { clicked: true };
  reply(cmd, socket, { ok: true, data });
}
responder = defaultSuccess;

const OWNER = 'conv-site-01';
const RIVAL = 'conv-site-rival';
const rivalDefs = createExtensionToolDefs({ conversationId: RIVAL });

function call(conversationId, name, args) {
  const source = conversationId === RIVAL ? rivalDefs : defs;
  const def = source.find((t) => t.name === `dogear__extension__${name}`);
  if (!def) throw new Error(`工具未注册: ${name}`);
  return def.handler(args);
}

function setGatewayPage(url, origins) {
  socket.write(
    encodeNmFrame({ type: 'tab_snapshot', tabId: TAB_ID, title: '测试页', url, textPreview: '', generation: 0 }),
  );
  if (origins) socket.write(encodeNmFrame({ type: 'permission_state', origins }));
}

const AUTHORIZED = [
  'https://pointerless.example.com',
  'https://pointer.example.com',
  'https://pointer-target.example.com',
  'https://empty.example.com',
];

let socket = await connectAndHello('0.0.0-st');

setGatewayPage('https://pointer.example.com/home', AUTHORIZED);
await sleepMs(80);

const noPointerNav = await call(OWNER, 'navigate', { url: 'https://pointerless.example.com/x' });
check(
  'P1 navigate 无档案域：成功且尾部无指针',
  !isErr(noPointerNav) && !textOf(noPointerNav).includes(POINTER_TEXT),
  textOf(noPointerNav),
);

setGatewayPage('https://pointer.example.com/home', AUTHORIZED);
await sleepMs(80);
const add = await call(OWNER, 'site_finding', { finding: '发现：搜索卡片数组在 state.search.feeds._value' });
check(
  'F1 site_finding 成功文案',
  !isErr(add) && textOf(add) === '已追加到发现区，待审核合并',
  textOf(add),
);
const findingOnDisk = readFileSync(findingFile(), 'utf8');
check(
  'F2 追加落盘：日期 + 会话标注 + 发现文本',
  findingOnDisk.includes('# pointer.example.com 站点档案') && findingOnDisk.includes('- [') && findingOnDisk.includes('conv-sit') && findingOnDisk.includes('state.search.feeds._value'),
  findingOnDisk,
);

const withPointerNav = await call(OWNER, 'navigate', { url: 'https://pointer.example.com/list' });
check(
  'P2 navigate 有档案域：尾部含指针',
  !isErr(withPointerNav) && textOf(withPointerNav).includes(POINTER_TEXT),
  textOf(withPointerNav),
);

mkdirSync(knowledgeDir(), { recursive: true });
writeFileSync(
  path.join(knowledgeDir(), 'pointer.example.com.md'),
  findingOnDisk + '\n## 正式地图（已验证）\n- 直链拼法：/search_result/{id}?xsec_token={token}\n',
  'utf8',
);
responder = (cmd, socket) => {
  if (cmd.kind === 'navigate') {
    reply(cmd, socket, { ok: true, data: { url: 'https://pointer.example.com/redirected' } });
  } else {
    defaultSuccess(cmd, socket);
  }
};
const redirectNav = await call(OWNER, 'navigate', { url: 'https://pointer-target.example.com/a' });
check(
  'P3 重定向场景按最终 url 判指针',
  !isErr(redirectNav) && textOf(redirectNav).includes('发生重定向') && textOf(redirectNav).includes(POINTER_TEXT),
  textOf(redirectNav),
);
responder = defaultSuccess;

const known = await call(OWNER, 'site_knowledge', {});
check(
  'K1 site_knowledge 有档案：返回两区与正文',
  !isErr(known) &&
    textOf(known).includes('## 正式地图（已验证）') &&
    textOf(known).includes('## 探索发现') &&
    textOf(known).includes('pointer.example.com'),
  textOf(known),
);

setGatewayPage('https://empty.example.com/page', AUTHORIZED);
await sleepMs(80);
const unknown = await call(OWNER, 'site_knowledge', {});
check(
  'K2 site_knowledge 无档案：正常态非 isError + 鼓励探索 + site_finding 引导',
  !isErr(unknown) && textOf(unknown).includes('暂无站点档案') && textOf(unknown).includes('site_finding'),
  textOf(unknown),
);

setGatewayPage('https://pointer.example.com/home', AUTHORIZED);
await sleepMs(80);
const dup = await call(OWNER, 'site_finding', { finding: '发现：搜索卡片数组在 state.search.feeds._value' });
check(
  'D1 60s 去重：dedup 文案非 isError',
  !isErr(dup) && textOf(dup).includes('60 秒内已记录过') && textOf(dup).includes('未重复写入'),
  textOf(dup),
);
const dupCount = readFileSync(findingFile(), 'utf8').split('state.search.feeds._value').length - 1;
check('D2 文件中该发现仅一条', dupCount === 1, `count=${dupCount}`);

const tooLong = await call(OWNER, 'site_finding', { finding: '超'.repeat(501) });
check(
  'D3 超长拒绝 isError 中文',
  isErr(tooLong) && textOf(tooLong).includes('500'),
  textOf(tooLong),
);
const blank = await call(OWNER, 'site_finding', { finding: '   ' });
check('D4 空白拒绝 isError', isErr(blank) && textOf(blank).length > 0, textOf(blank));

const rivalFinding = await call(RIVAL, 'site_finding', { finding: '竞争会话的发现' });
check(
  'G1 ownership gate 生效：竞争会话 busy',
  isErr(rivalFinding) && textOf(rivalFinding).includes('扩展通道正被另一个会话使用'),
  textOf(rivalFinding),
);

socket.destroy();
await sleepMs(150);
check('N0 断连后 gateway 状态 disconnected', getExtensionStatus().status === 'disconnected');
const offlineKnown = await call(OWNER, 'site_knowledge', {});
check(
  'N1 断连后 site_knowledge：isError 未连接提示',
  isErr(offlineKnown) && textOf(offlineKnown).includes('未连接'),
  textOf(offlineKnown),
);

rmSync(tmpDir, { recursive: true, force: true });
rmSync(profileDir, { recursive: true, force: true });

console.log(`\n${passes} PASS / ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
