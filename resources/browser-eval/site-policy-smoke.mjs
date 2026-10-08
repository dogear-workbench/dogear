import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');

const profileDir = mkdtempSync(path.join(os.tmpdir(), 'dogear-step3-policy-'));
process.env.DOGEAR_CONFIG_DIR = profileDir;

const tmpDir = mkdtempSync(path.join(projectRoot, '.tmp-step3-policy-'));
const distCopy = path.join(tmpDir, 'dist');
cpSync(path.join(projectRoot, 'dist'), distCopy, { recursive: true });
const nmProtocolCopy = path.join(distCopy, 'main', 'services', 'browser', 'nm-protocol.js');
writeFileSync(
  nmProtocolCopy,
  readFileSync(nmProtocolCopy, 'utf-8').replaceAll('dogear-nm-gateway', 'dogear-nm-gateway-step3-test'),
);

register('./electron-hooks.mjs', pathToFileURL(path.join(here, 'electron-hooks.mjs')).href);

const TEST_PIPE = '\\\\.\\pipe\\dogear-nm-gateway-step3-test';
const TAB_ID = 4242;

const gatewayUrl = pathToFileURL(path.join(distCopy, 'main', 'services', 'browser', 'browser-gateway.js')).href;
const toolsUrl = pathToFileURL(path.join(distCopy, 'main', 'agents', 'tools', 'extension-tools.js')).href;
const sitePolicyUrl = pathToFileURL(path.join(distCopy, 'main', 'services', 'browser', 'site-policy.js')).href;
const streamUrl = pathToFileURL(path.join(distCopy, 'main', 'services', 'browser', 'browser-action-stream.js')).href;

const { initBrowserGateway, getExtensionStatus } = await import(gatewayUrl);
const { createExtensionToolDefs } = await import(toolsUrl);
const sitePolicy = await import(sitePolicyUrl);
const { resetChannel } = await import(
  pathToFileURL(path.join(distCopy, 'main', 'services', 'browser', 'extension-ownership.js')).href
);
const { getBrowserActionHistory } = await import(streamUrl);
const { encodeNmFrame, makeNmDecoder } = await import(
  pathToFileURL(path.join(distCopy, 'main', 'services', 'browser', 'nm-protocol.js')).href
);

initBrowserGateway('step3-test');

sitePolicy.registerSitePolicy({
  matchOrigins: ['https://slow.example.com'],
  searchUrlIncludes: ['/search_result'],
  delayMs: { min: 200, max: 350 },
  searchDelayMs: { min: 300, max: 500 },
  budget: { maxNotes: 2, maxSearches: 2 },
  riskKeywords: ['verify-risk-token', '风控滑块测试词'],
});

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

const socket = net.connect(TEST_PIPE);
await new Promise((resolve, reject) => {
  socket.once('connect', resolve);
  socket.once('error', reject);
});

let responder = null;
const welcome = new Promise((resolve) => {
  const decoder = makeNmDecoder();
  decoder.onFrame((m) => {
    if (m.type === 'welcome') resolve(m);
    else if (m.type === 'command' && responder) responder(m);
  });
  socket.on('data', (chunk) => decoder.push(chunk));
});
socket.write(
  encodeNmFrame({ type: 'hello', extensionVersion: '0.0.0-step3', protocolVersion: 3, tabId: TAB_ID }),
);
await welcome;

function sendSnapshot(url) {
  socket.write(
    encodeNmFrame({ type: 'tab_snapshot', tabId: TAB_ID, title: '测试页', url, textPreview: '', generation: 0 }),
  );
}
function sendOrigins(origins) {
  socket.write(encodeNmFrame({ type: 'permission_state', origins }));
}
async function setGatewayPage(url, origins) {
  sendSnapshot(url);
  if (origins) sendOrigins(origins);
  await sleepMs(80);
}
function reply(cmd, body) {
  socket.write(encodeNmFrame({ type: 'command_result', requestId: cmd.requestId, ...body }));
}
function defaultSuccess(cmd) {
  const data =
    cmd.kind === 'navigate'
      ? { url: cmd.params.targetUrl }
      : cmd.kind === 'observe'
        ? {
            total: 2,
            regionCounts: { top: 1, middle: 1, bottom: 0 },
            elements: [
              { ref: 'e1', tag: 'a', role: 'link', text: '下一页', hint: '' },
              { ref: 'e2', tag: 'button', role: 'button', text: '收藏', hint: '' },
            ],
          }
        : cmd.kind === 'read_text'
          ? { text: '这是一篇测试笔记的正文内容，讲的是手工烘焙的日常。', totalLength: 24 }
          : { clicked: true, urlBefore: 'https://slow.example.com/list', urlAfter: 'https://slow.example.com/list' };
  reply(cmd, { ok: true, data });
}
responder = defaultSuccess;

const toolsByConv = new Map();
function toolDefsFor(conversationId) {
  if (!toolsByConv.has(conversationId)) {
    toolsByConv.set(conversationId, createExtensionToolDefs({ conversationId }));
  }
  return toolsByConv.get(conversationId);
}
function call(conversationId, name, args) {
  const def = toolDefsFor(conversationId).find((t) => t.name === `dogear__extension__${name}`);
  if (!def) throw new Error(`工具未注册: ${name}`);
  return def.handler(args);
}

check(
  'P0 gateway 连接 + 扩展状态 connected',
  getExtensionStatus().status === 'connected' && getExtensionStatus().tabId === TAB_ID,
);

const p = sitePolicy.getSitePolicy('https://www.xiaohongshu.com/explore/abc');
check('S1-1 小红书策略命中', p !== null && Array.isArray(p.matchOrigins));
check('S1-2 delayMs 15~45s（拍板保守取长）', p.delayMs.min === 15000 && p.delayMs.max === 45000);
check('S1-3 searchDelayMs 30~90s', p.searchDelayMs.min === 30000 && p.searchDelayMs.max === 90000);
check(
  'S1-4 预算量级对齐调研（≤20 篇 / ≤5 组关键词）',
  p.budget.maxNotes > 0 && p.budget.maxNotes <= 20 && p.budget.maxSearches > 0 && p.budget.maxSearches <= 5,
);
check(
  'S1-5 riskKeywords 覆盖滑块/验证码/频次/AI操作',
  p.riskKeywords.includes('验证码') &&
    p.riskKeywords.includes('滑块') &&
    p.riskKeywords.includes('访问频次异常') &&
    p.riskKeywords.includes('检测到AI操作'),
);
check('S1-6 非配置域名返回 null', sitePolicy.getSitePolicy('https://www.google.com/search') === null);
check(
  'S1-7 搜索 URL 特征匹配',
  sitePolicy.isSearchResultUrl(p, 'https://www.xiaohongshu.com/search_result?keyword=咖啡') &&
    !sitePolicy.isSearchResultUrl(p, 'https://www.xiaohongshu.com/explore/xyz'),
);

await setGatewayPage('https://slow.example.com/list', ['https://slow.example.com']);
const CONV_LAT = 'conv-lat';
let t0 = Date.now();
const navPlain = await call(CONV_LAT, 'navigate', { url: 'https://slow.example.com/page2' });
const navPlainElapsed = Date.now() - t0;
check(
  'S2-1 普通导航注入 delayMs（200~350ms 下限生效）',
  !isErr(navPlain) && navPlainElapsed >= 200 && navPlainElapsed < 2500,
  `elapsed=${navPlainElapsed}ms`,
);
t0 = Date.now();
const navSearch = await call(CONV_LAT, 'navigate', { url: 'https://slow.example.com/search_result?keyword=a' });
const navSearchElapsed = Date.now() - t0;
check(
  'S2-2 搜索导航注入 searchDelayMs（≥300ms）',
  !isErr(navSearch) && navSearchElapsed >= 300 && navSearchElapsed < 2500,
  `elapsed=${navSearchElapsed}ms`,
);
const lastNav = getBrowserActionHistory().filter((e) => e.action === 'navigate').at(-1);
check(
  'S2-3 策略延迟不进动作流时长（durationMs 仅含命令耗时）',
  typeof lastNav.durationMs === 'number' && lastNav.durationMs < navSearchElapsed - 100,
  `durationMs=${lastNav.durationMs} elapsed=${navSearchElapsed}ms`,
);

t0 = Date.now();
const navSearch2 = await call(CONV_LAT, 'navigate', { url: 'https://slow.example.com/search_result?keyword=b' });
check('S3-1 第 2 次搜索仍成功（预算 2/2 用满）', !isErr(navSearch2));
t0 = Date.now();
const navSearch3 = await call(CONV_LAT, 'navigate', { url: 'https://slow.example.com/search_result?keyword=c' });
const navSearch3Elapsed = Date.now() - t0;
check(
  'S3-2 第 3 次搜索超限拒绝 + 结构化文案 + 不延迟',
  isErr(navSearch3) &&
    textOf(navSearch3).includes('已用 2/2') &&
    textOf(navSearch3).includes('剩余额度 0') &&
    navSearch3Elapsed < 150,
  `elapsed=${navSearch3Elapsed}ms text=${textOf(navSearch3)}`,
);
await setGatewayPage('https://slow.example.com/note/1');
const note1 = await call(CONV_LAT, 'read_text', {});
const note2 = await call(CONV_LAT, 'read_text', {});
check('S3-3 无 ref 读取笔记 ×2 成功（预算 2/2 用满）', !isErr(note1) && !isErr(note2));
const note3 = await call(CONV_LAT, 'read_text', {});
check(
  'S3-4 第 3 次读取超限拒绝 + 结构化文案',
  isErr(note3) && textOf(note3).includes('已用 2/2') && textOf(note3).includes('剩余额度 0'),
  textOf(note3),
);
const noteRef = await call(CONV_LAT, 'read_text', { ref: 'e1' });
check('S3-5 带 ref 分次读取不计笔记预算', !isErr(noteRef));
const rsShared = await call(CONV_LAT, 'read_state', {});
check(
  'S3-6 read_state 与 read_text 共用笔记预算池（超限同样拒绝）',
  isErr(rsShared) && textOf(rsShared).includes('已用 2/2'),
  textOf(rsShared),
);

resetChannel();
const CONV_RISK = 'conv-risk';
await setGatewayPage('https://slow.example.com/note/9');
responder = (cmd) => {
  if (cmd.kind === 'read_text') {
    reply(cmd, { ok: true, data: { text: '系统提示：verify-risk-token 请完成人机验证', totalLength: 28 } });
  } else {
    defaultSuccess(cmd);
  }
};
const riskRead = await call(CONV_RISK, 'read_text', {});
check(
  'S4-1 风控关键词命中即停（isError + 信号词 + 人工检查引导）',
  isErr(riskRead) && textOf(riskRead).includes('verify-risk-token') && textOf(riskRead).includes('人工检查'),
  textOf(riskRead),
);
t0 = Date.now();
const riskObserve = await call(CONV_RISK, 'observe_page', {});
const riskObserveElapsed = Date.now() - t0;
check(
  'S4-2 同会话同域名 observe 前置拒绝（无延迟）',
  isErr(riskObserve) && textOf(riskObserve).includes('人工检查') && riskObserveElapsed < 150,
  `elapsed=${riskObserveElapsed}ms`,
);
const riskReadRef = await call(CONV_RISK, 'read_text', { ref: 'e1' });
check('S4-3 同会话同域名 read_text 前置拒绝', isErr(riskReadRef));
const riskNav = await call(CONV_RISK, 'navigate', { url: 'https://slow.example.com/other' });
check('S4-4 同会话同域名 navigate 前置拒绝', isErr(riskNav));
await setGatewayPage('https://www.google.com/search?q=dogear', ['https://www.google.com']);
const otherDomain = await call(CONV_RISK, 'observe_page', {});
check('S4-5 其他域名不受该会话风控标记影响', !isErr(otherDomain), textOf(otherDomain));

resetChannel();
const CONV_PLAIN = 'conv-plain';
responder = defaultSuccess;
t0 = Date.now();
const plainObserve = await call(CONV_PLAIN, 'observe_page', {});
const plainObserveElapsed = Date.now() - t0;
check(
  'S5-1 无策略域名 observe 无延迟行为不变',
  !isErr(plainObserve) && plainObserveElapsed < 1500,
  `elapsed=${plainObserveElapsed}ms`,
);
const plainReads = [];
for (let i = 0; i < 3; i += 1) plainReads.push(await call(CONV_PLAIN, 'read_text', {}));
check('S5-2 无策略域名 read_text 无预算限制（连续 3 次成功）', plainReads.every((r) => !isErr(r)));
t0 = Date.now();
const plainNav = await call(CONV_PLAIN, 'navigate', { url: 'https://www.google.com/advanced_search' });
const plainNavElapsed = Date.now() - t0;
check('S5-3 无策略域名 navigate 无延迟无预算', !isErr(plainNav) && plainNavElapsed < 1500);

const badScheme = await call(CONV_PLAIN, 'navigate', { url: 'javascript:alert(1)' });
check(
  'S6-1 非 http 协议文案精确（不走「目标域名未授权」固定文案）',
  isErr(badScheme) && !textOf(badScheme).includes('目标域名未授权') && textOf(badScheme).includes('http/https'),
  textOf(badScheme),
);
const badUrl = await call(CONV_PLAIN, 'navigate', { url: 'not a url' });
check('S6-2 非法 URL 文案透传 detail', isErr(badUrl) && textOf(badUrl).includes('无法导航'), textOf(badUrl));
const unauthorized = await call(CONV_PLAIN, 'navigate', { url: 'https://unauthorized.example.com/page' });
check('S6-3 未授权域文案保持「目标域名未授权」', isErr(unauthorized) && textOf(unauthorized).includes('目标域名未授权'));


responder = (cmd) => {
  if (cmd.kind === 'navigate') {
    reply(cmd, {
      ok: false,
      errorCode: 'navigated_away',
      error: '页面已离开命令发起时的地址',
      currentUrl: 'https://www.google.com/moved-away',
    });
  } else if (cmd.kind === 'observe') {
    reply(cmd, {
      ok: false,
      errorCode: 'ref_expired',
      error: '页面已变化',
      currentUrl: 'https://www.google.com/after-nav',
    });
  } else {
    defaultSuccess(cmd);
  }
};
const awayNav = await call(CONV_PLAIN, 'navigate', { url: 'https://www.google.com/x' });
check(
  'S6-4 navigated_away 文案拼接 currentUrl（agent 免重 observe）',
  isErr(awayNav) && textOf(awayNav).includes('当前页面: https://www.google.com/moved-away'),
  textOf(awayNav),
);
const expiredObserve = await call(CONV_PLAIN, 'observe_page', {});
check(
  'S6-5 ref_expired 文案拼接 currentUrl',
  isErr(expiredObserve) && textOf(expiredObserve).includes('当前页面: https://www.google.com/after-nav'),
  textOf(expiredObserve),
);
responder = defaultSuccess;
resetChannel();
const CONV_RS = 'conv-read-state';
await setGatewayPage('https://slow.example.com/note/rs1', ['https://slow.example.com']);
responder = (cmd) => {
  if (cmd.kind === 'read_state') reply(cmd, { ok: true, data: { summary: 'feed：array，长度 3' } });
  else defaultSuccess(cmd);
};
t0 = Date.now();
const rsDelay = await call(CONV_RS, 'read_state', {});
check(
  'R1 read_state 过 policyGate 随机延迟（≥200ms）',
  !isErr(rsDelay) && Date.now() - t0 >= 200,
  `elapsed=${Date.now() - t0}ms`,
);
const rsSame1 = await call(CONV_RS, 'read_state', { path: 'home.feed.0' });
const rsSame2 = await call(CONV_RS, 'read_state', {});
check('R2 同页多次 read_state 均成功（同 URL 不重复计数）', !isErr(rsSame1) && !isErr(rsSame2));
await setGatewayPage('https://slow.example.com/note/rs2');
const rsNewUrl = await call(CONV_RS, 'read_state', {});
check('R3 新页面 URL 计第 2 次笔记（预算 2/2 用满）', !isErr(rsNewUrl));
await setGatewayPage('https://slow.example.com/note/rs3');
const rsOver = await call(CONV_RS, 'read_state', {});
check(
  'R4 第 3 个页面超限拒绝 + 结构化文案',
  isErr(rsOver) && textOf(rsOver).includes('已用 2/2') && textOf(rsOver).includes('剩余额度 0'),
  textOf(rsOver),
);

resetChannel();
const CONV_RSRISK = 'conv-rs-risk';
await setGatewayPage('https://slow.example.com/note/rsrisk', ['https://slow.example.com']);
responder = (cmd) => {
  if (cmd.kind === 'read_state') {
    reply(cmd, { ok: true, data: { json: '{"tip":"请完成 verify-risk-token 验证"}', truncated: false, totalLength: 40 } });
  } else {
    defaultSuccess(cmd);
  }
};
const rsRisk = await call(CONV_RSRISK, 'read_state', { path: 'tip' });
check(
  'R5 read_state 返回内容风控扫描命中即停',
  isErr(rsRisk) && textOf(rsRisk).includes('verify-risk-token') && textOf(rsRisk).includes('人工检查'),
  textOf(rsRisk),
);
const rsRiskNext = await call(CONV_RSRISK, 'read_state', {});
check('R6 命中后同会话同域名 read_state 前置拒绝', isErr(rsRiskNext));

resetChannel();
const CONV_RSINFO = 'conv-rs-info';
await setGatewayPage('https://slow.example.com/note/rsinfo', ['https://slow.example.com']);
responder = (cmd) => {
  if (cmd.kind !== 'read_state') return defaultSuccess(cmd);
  if (cmd.params.path === 'missing_probe') reply(cmd, { ok: true, data: { missing: true } });
  else reply(cmd, { ok: true, data: { notFound: true, availableKeys: ['home', 'user'] } });
};
const rsMissing = await call(CONV_RSINFO, 'read_state', { path: 'missing_probe' });
check(
  'R7 missing → isError 引导改用 observe/read_text',
  isErr(rsMissing) && textOf(rsMissing).includes('__INITIAL_STATE__') && textOf(rsMissing).includes('observe_page'),
  textOf(rsMissing),
);
const rsNotFound = await call(CONV_RSINFO, 'read_state', { path: 'nope' });
check(
  'R8 notFound → isError + 该层可用 key 清单',
  isErr(rsNotFound) && textOf(rsNotFound).includes('home、user') && textOf(rsNotFound).includes('修正 path'),
  textOf(rsNotFound),
);
const rsEvents = getBrowserActionHistory().filter((e) => e.action === 'read_state' && e.source === 'extension');
check(
  'R9 read_state 动作流：成功/missing_state/path_not_found/budget_exceeded/risk_signal 标记齐全',
  rsEvents.some((e) => e.conversationId === CONV_RS && !e.result) &&
    rsEvents.some((e) => e.result === 'missing_state') &&
    rsEvents.some((e) => e.result === 'path_not_found') &&
    rsEvents.some((e) => e.result === 'budget_exceeded') &&
    rsEvents.some((e) => e.result === 'risk_signal'),
);

const history = getBrowserActionHistory().filter((e) => e.source === 'extension');
const latNavEvents = history.filter((e) => e.action === 'navigate' && e.conversationId === CONV_LAT);
check('S7-1 navigate 动作带 conversationId', latNavEvents.length >= 2);
check(
  'S7-2 navigate 成功动作带 urlBefore/urlAfter/durationMs',
  latNavEvents.some((e) => e.result === 'navigated' && !!e.urlBefore && !!e.urlAfter && typeof e.durationMs === 'number'),
);
check(
  'S7-3 协议失败动作带 errorCode',
  history.some((e) => e.result === 'error' && e.errorCode === 'navigated_away'),
);
check(
  'S7-4 预算超限动作 result=budget_exceeded',
  history.filter((e) => e.result === 'budget_exceeded').length >= 2,
);
check(
  'S7-5 风控拒绝动作 result=risk_blocked / 命中动作 result=risk_signal',
  history.some((e) => e.result === 'risk_blocked') && history.some((e) => e.result === 'risk_signal'),
);
check(
  'S7-6 observe/read_text 成功动作带 durationMs',
  history
    .filter((e) => (e.action === 'observe' || e.action === 'read_text') && !e.result)
    .every((e) => typeof e.durationMs === 'number'),
);

socket.destroy();
await sleepMs(100);
rmSync(tmpDir, { recursive: true, force: true });
rmSync(profileDir, { recursive: true, force: true });

console.log(`\n${passes} PASS / ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
