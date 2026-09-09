import { findInTab, observeTab, parseRef, readTabText, RefExpiredError } from './ax-observe.js';
import type { EmbeddedTabRecord } from './types.js';
import { ActionGuardError, clickTab, fillTab } from './actions.js';
import { getEmbeddedBrowserManager } from './embedded-browser-manager.js';
import { navigateTab } from './navigate.js';
import { pressTab } from './press.js';
import { readTabState } from './read-state.js';
import { scrollTab } from './scroll.js';
import { waitForTabCondition } from './wait-for.js';

const SELFTEST_URL = 'https://example.com/';
const SELFTEST_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 200;

const INJECT_FIXTURE_FN =
  `(() => {
    const spacer = document.createElement('div');
    spacer.style.height = '6000px';
    spacer.id = 'selftest-spacer';
    document.body.appendChild(spacer);
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'selftest-input';
    input.placeholder = 'selftest input target';
    document.body.appendChild(input);
    const password = document.createElement('input');
    password.type = 'password';
    password.id = 'selftest-password';
    password.placeholder = 'selftest password target';
    document.body.appendChild(password);
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = 'selftest submit';
    document.body.appendChild(submit);
    return 'ok';
  })()`;

export async function runEmbeddedBrowserSelfTest(): Promise<void> {
  const manager = getEmbeddedBrowserManager();
  manager.openTab({
    workspaceId: 'embedded-selftest',
    url: SELFTEST_URL,
    source: 'agent-opened',
    holderId: 'selftest',
  });
  await waitForReady(manager);
  const tabId = manager.getAgentTabId('embedded-selftest');
  const tab = tabId ? manager.getTabRecord(tabId) : null;
  if (!tab) throw new Error('自测标签页已丢失');

  const observe = await observeTab(tab);
  console.log('[embedded-selftest] observe:', JSON.stringify({
    url: observe.url,
    title: observe.title,
    state: observe.pageState,
    generation: observe.generation,
    interactive: observe.elements.length,
    headings: observe.headings.map((el) => el.text),
    regionCounts: observe.regionCounts,
  }));
  const link = observe.elements.find((el) => el.role === 'link' && !!el.href);
  if (!link) {
    console.log('[embedded-selftest] elements:', JSON.stringify(observe.elements, null, 2));
    throw new Error(`观察未发现预期链接（interactive=${observe.elements.length}）`);
  }
  if (!parseRef(link.ref)) throw new Error(`ref 格式异常: ${link.ref}`);

  const found = await findInTab(tab, { role: 'link' });
  if (found.elements.length === 0) throw new Error('find 未命中已知存在的链接');

  const elementText = await readTabText(tab, link.ref);
  const containerText = await readTabText(tab);
  console.log('[embedded-selftest] read_text:', JSON.stringify({
    ref: link.ref,
    chars: elementText.totalLength,
    containerChars: containerText.totalLength,
  }));
  if (elementText.totalLength === 0) throw new Error('按 ref 读取文本为空');
  if (!containerText.text.includes('Example Domain')) throw new Error('容器文本未包含页面标题');

  tab.generation += 1;
  let expired = false;
  try {
    await readTabText(tab, link.ref);
  } catch (err) {
    expired = err instanceof RefExpiredError;
    if (!expired) throw err;
  }
  if (!expired) throw new Error('generation 变化后 ref 校验未拦截');
  const generationAfterRefCheck = tab.generation;

  await operationSmoke(tab);

  const nav = await navigateTab(manager, 'embedded-selftest', 'https://www.iana.org/domains/example', 'selftest');
  console.log('[embedded-selftest] navigate:', JSON.stringify({
    url: nav.snapshot.url,
    state: nav.snapshot.state,
    generationBefore: observe.generation,
    generationAfter: nav.snapshot.generation,
  }));
  if (!nav.snapshot.url.includes('iana.org')) throw new Error('导航未生效');
  if (nav.snapshot.generation <= generationAfterRefCheck) {
    throw new Error(`二次导航 generation 应递增，实际 ${generationAfterRefCheck} → ${nav.snapshot.generation}`);
  }
  const wait = await waitForTabCondition(nav.record, { urlContains: 'iana.org', timeoutSec: 5 });
  if (!wait.matched) throw new Error('wait_for 未命中 url 条件');

  manager.release(tab.tabId, 'selftest');
  manager.closeTab(tab.tabId);
  console.log('[embedded-selftest] 通过');
}

/** 操作原语冒烟：注入固定 fixture 后验证 scroll / fill / guard 拦截 / press / read_state / click 真实输入事件 */
async function operationSmoke(tab: EmbeddedTabRecord): Promise<void> {
  const injected = await tab.view.webContents.executeJavaScript(INJECT_FIXTURE_FN);
  if (injected !== 'ok') throw new Error('自测 fixture 注入失败');

  const scrollDown = await scrollTab(tab, { deltaY: 500 });
  console.log('[embedded-selftest] scroll:', JSON.stringify({
    target: scrollDown.target,
    before: scrollDown.before.top,
    after: scrollDown.after.top,
    moved: scrollDown.moved,
  }));
  if (!scrollDown.moved || scrollDown.after.top <= scrollDown.before.top) throw new Error('文档 wheel 滚动未生效');

  const scrollBottom = await scrollTab(tab, { position: 'bottom' });
  const maxTop = scrollBottom.after.height - scrollBottom.after.clientHeight;
  if (Math.abs(scrollBottom.after.top - maxTop) > 2) {
    throw new Error(`position=bottom 未滚到底（top=${scrollBottom.after.top}, max=${maxTop}）`);
  }

  const fixtureObserve = await observeTab(tab, { textFilter: 'selftest' });
  const inputText = (el: { text: string; hint: string }) => `${el.text} ${el.hint}`;
  const input = fixtureObserve.elements.find((el) => inputText(el).includes('selftest input target'));
  if (!input) throw new Error(`未找到注入的输入框（interactive=${fixtureObserve.elements.length}）`);
  const fillResult = await fillTab(tab, input.ref, 'hello dogear');
  if (!fillResult.verified) throw new Error('fill 回读校验失败');

  const password = fixtureObserve.elements.find((el) => inputText(el).includes('selftest password target'));
  if (!password) throw new Error('未找到注入的密码输入框');
  let passwordGuarded = false;
  try {
    await fillTab(tab, password.ref, 'secret');
  } catch (err) {
    passwordGuarded = err instanceof ActionGuardError && err.code === 'guard_password';
    if (!passwordGuarded) throw err;
  }
  if (!passwordGuarded) throw new Error('密码类输入未被 guard_password 拦截');

  const submitButton = await findInTab(tab, { role: 'button', name: 'selftest submit', exact: true });
  const submitRef = submitButton.elements[0]?.ref;
  if (!submitRef) throw new Error('未找到注入的提交按钮');
  let submitGuarded = false;
  try {
    await clickTab(tab, submitRef);
  } catch (err) {
    submitGuarded = err instanceof ActionGuardError && err.code === 'guard_submit';
    if (!submitGuarded) throw err;
  }
  if (!submitGuarded) throw new Error('提交类点击未被 guard_submit 拦截');

  const press = await pressTab(tab, 'PageUp');
  if (!press.url) throw new Error('press 返回缺少 url');

  const state = await readTabState(tab);
  if (!state.missing) throw new Error('example.com 不应存在 __INITIAL_STATE__');

  const links = await findInTab(tab, { role: 'link' });
  const linkRef = links.elements[0]?.ref;
  if (!linkRef) throw new Error('未找到页面链接');
  const clickResult = await clickTab(tab, linkRef);
  console.log('[embedded-selftest] click:', JSON.stringify({
    ref: clickResult.ref,
    navigated: clickResult.navigated,
    method: clickResult.method,
    urlAfter: clickResult.urlAfter,
  }));
  if (!clickResult.navigated) throw new Error('点击链接未触发导航');
  await waitForTabCondition(tab, { urlContains: 'iana.org', timeoutSec: 10 });
}

async function waitForReady(manager: ReturnType<typeof getEmbeddedBrowserManager>): Promise<void> {
  const deadline = Date.now() + SELFTEST_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const snap = manager.getTab(manager.getAgentTabId('embedded-selftest') ?? '');
    if (snap && snap.state !== 'loading' && snap.title) return;
    await sleep(POLL_INTERVAL_MS);
  }
  const snap = manager.getTab(manager.getAgentTabId('embedded-selftest') ?? '');
  throw new Error(`自测页面加载超时（state=${snap?.state ?? 'unknown'}, url=${snap?.url ?? ''}）`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
