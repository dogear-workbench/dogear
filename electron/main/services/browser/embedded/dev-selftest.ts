import { findInTab, observeTab, parseRef, readTabText, RefExpiredError } from './ax-observe.js';
import type { EmbeddedTabRecord } from './types.js';
import { ActionGuardError, clickTab, fillTab } from './actions.js';
import { readArticleWithBrowser } from '../browser-article-service.js';
import { searchWeb } from '../browser-search-service.js';
import {
  listPendingHumanInterventions,
  raiseHumanIntervention,
  resolveHumanIntervention,
  resolveInterventionsForTab,
} from '../human-intervention.js';
import { getEmbeddedBrowserManager, type EmbeddedBrowserManager } from './embedded-browser-manager.js';
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
    const checkboxWrap = document.createElement('label');
    checkboxWrap.textContent = 'selftest checkbox';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'selftest-checkbox';
    checkboxWrap.insertBefore(checkbox, checkboxWrap.firstChild);
    document.body.appendChild(checkboxWrap);
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

  takeoverSmoke(manager, tab);
  manager.release(tab.tabId, 'selftest');
  manager.closeTab(tab.tabId);
  await fetchSmoke(manager);
  await observeFallbackSmoke(manager);
  humanInterventionSmoke();
  console.log('[embedded-selftest] 通过');
}

/** observe_page DOM 兜底分期：aria-hidden 让 AX 树剔除链接（模拟 AX 覆盖不足）+ 正文充足 → ObservePayload 附 domFallbackLinks */
async function observeFallbackSmoke(manager: EmbeddedBrowserManager): Promise<void> {
  const links = Array.from({ length: 35 }, (_, i) => `<a href="https://example.com/target-${i + 1}">兜底链接 ${i + 1}</a>`).join('');
  const paragraph = `兜底正文。${'内嵌浏览器观察兜底自测文本，用于把正文长度推过判定阈值。'.repeat(24)}`;
  const html = `<html><body><div aria-hidden="true">${links}</div><p>${paragraph}</p></body></html>`;
  const nav = await navigateTab(manager, 'embedded-selftest', `data:text/html,${encodeURIComponent(html)}`, 'selftest');
  manager.ensureInputReady(nav.record.tabId);
  const observe = await observeTab(nav.record);
  console.log('[embedded-selftest] observe fallback:', JSON.stringify({
    interactive: observe.elements.length,
    fallbackLinks: observe.domFallbackLinks?.length ?? 0,
    first: observe.domFallbackLinks?.[0],
  }));
  if (observe.elements.length >= 5) throw new Error(`fixture 页 AX 交互元素应 < 5，实际 ${observe.elements.length}`);
  if (!observe.domFallbackLinks || observe.domFallbackLinks.length !== 30) {
    throw new Error(`DOM 链接兜底应收集前 30 个链接，实际 ${observe.domFallbackLinks?.length ?? 0}`);
  }
  const first = observe.domFallbackLinks[0];
  if (!first.href.includes('example.com/target-1') || !first.text.includes('兜底链接 1')) {
    throw new Error(`DOM 链接兜底内容异常: ${JSON.stringify(first)}`);
  }
  manager.closeTab(nav.record.tabId);
}

/** 接管锁闭环：接管 → 锁生效 → 交还（taskMeta 透出 + generation 递增） → 幂等拒绝 */
function takeoverSmoke(manager: EmbeddedBrowserManager, tab: EmbeddedTabRecord): void {
  const generationBefore = tab.generation;
  if (!manager.takeOverTab(tab.tabId, { kind: 'agent', conversationId: 'selftest' })) throw new Error('接管失败');
  if (!manager.isTabTakenOver(tab.tabId)) throw new Error('接管后锁未生效');
  if (manager.getTab(tab.tabId)?.takeover?.active !== true) throw new Error('快照未透出接管状态');
  if (!manager.listTakeovers().some((entry) => entry.tabId === tab.tabId)) throw new Error('全量接管列表缺失');
  const released = manager.releaseTakeover(tab.tabId);
  if (!released || released.taskMeta?.conversationId !== 'selftest') throw new Error('交还未透出 taskMeta');
  if (tab.generation <= generationBefore) throw new Error(`交还后 generation 应递增，实际 ${generationBefore} → ${tab.generation}`);
  if (manager.isTabTakenOver(tab.tabId)) throw new Error('交还后锁未解除');
  if (manager.listTakeovers().length !== 0) throw new Error('交还后全量接管列表应清空');
  if (manager.releaseTakeover(tab.tabId) !== null) throw new Error('重复交还不应成功');
  console.log('[embedded-selftest] takeover:', JSON.stringify({ ok: true, generation: tab.generation }));
}

/** awaiting_human 闭环：上报 → 同 tab 去重 → 用户确认解除 → 状态恢复自动解除 */
function humanInterventionSmoke(): void {
  const raised = raiseHumanIntervention({
    tabId: 'selftest-tab',
    reason: 'login_required',
    message: '自测登录墙',
    url: 'https://example.com/login',
    taskMeta: { kind: 'agent', conversationId: 'selftest' },
  });
  if (listPendingHumanInterventions().length !== 1) throw new Error('等待人工上报未入列');
  const refreshed = raiseHumanIntervention({
    tabId: 'selftest-tab',
    reason: 'verification_required',
    message: '自测验证页',
  });
  if (refreshed.id !== raised.id) throw new Error('同 tab 重复上报应复用同一请求');
  if (listPendingHumanInterventions().length !== 1) throw new Error('重复上报不应堆卡片');
  if (!resolveHumanIntervention(raised.id, 'user')) throw new Error('用户确认解除失败');
  raiseHumanIntervention({
    tabId: 'selftest-tab-2',
    reason: 'guard_submit',
    message: '自测提交拦截',
  });
  resolveInterventionsForTab('selftest-tab-2');
  if (listPendingHumanInterventions().length !== 0) throw new Error('状态恢复后未自动解除');
  console.log('[embedded-selftest] human_intervention:', JSON.stringify({ ok: true }));
}

/**
 * Step 4 抓取迁移自测：search 成功链路（cn.bing 稳定端点）→ parse_empty 全链失败的结构化返回
 * （serpUrls 均指向 example.com，必然解析为空）→ 失败页保留/promote 断言 → readArticle 冒烟。
 */
async function fetchSmoke(manager: EmbeddedBrowserManager): Promise<void> {
  const SELFTEST_WS = 'embedded-selftest';
  const selfTaskMeta = { kind: 'agent' as const, conversationId: 'selftest' };

  const searchOk = await searchWeb('electron browser testing', {
    engine: 'bing',
    maxResults: 3,
    workspaceId: SELFTEST_WS,
    taskMeta: selfTaskMeta,
  });
  console.log('[embedded-selftest] search:', JSON.stringify({
    ok: searchOk.ok,
    engine: searchOk.ok ? searchOk.engine : searchOk.errorClass,
    results: searchOk.ok ? searchOk.results.length : 0,
    first: searchOk.ok ? searchOk.results[0]?.url : undefined,
  }));
  if (!searchOk.ok || searchOk.results.length === 0) {
    throw new Error(`搜索成功链路自测失败：${searchOk.ok ? '结果为空' : `${searchOk.errorClass} ${searchOk.message}`}`);
  }
  if (manager.getAgentTabId(SELFTEST_WS)) throw new Error('搜索成功后抓取 tab 应已关闭');

  const parseEmpty = await searchWeb('dogear parse empty probe', {
    engine: 'ddg',
    workspaceId: SELFTEST_WS,
    taskMeta: selfTaskMeta,
    serpUrls: {
      ddg: 'https://example.com/?q={q}',
      bing: 'https://example.com/?q={q}',
    },
  });
  console.log('[embedded-selftest] search parse_empty:', JSON.stringify({
    ok: parseEmpty.ok,
    errorClass: parseEmpty.ok ? undefined : parseEmpty.errorClass,
    failure: parseEmpty.ok ? undefined : parseEmpty.failure,
  }));
  if (parseEmpty.ok) throw new Error('example.com 不应解析出搜索结果');
  if (parseEmpty.errorClass !== 'parse_empty') throw new Error(`应归类 parse_empty，实际 ${parseEmpty.errorClass}`);
  const failure = parseEmpty.failure;
  if (!failure?.pageAvailable || !failure.tabId) throw new Error('结构化失败上下文缺失');
  if (!failure.suggestedNextTools.includes('dogear__browser__observe_page')) throw new Error('suggestedNextTools 缺 observe_page');
  if (!failure.url || !failure.url.includes('example.com')) throw new Error(`失败 URL 异常: ${failure.url}`);
  if (!manager.getTabRecord(failure.tabId)) throw new Error('失败页 tab 应保留未关闭');
  if (manager.getAgentTabId(SELFTEST_WS) !== failure.tabId) throw new Error('失败页 tab 应已切为 agent 当前 tab');

  const honest = await searchWeb('dogear honest failure probe', {
    engine: 'ddg',
    workspaceId: SELFTEST_WS,
    taskMeta: selfTaskMeta,
    serpUrls: {
      ddg: 'https://www.iana.org/?q={q}',
      bing: 'https://www.iana.org/?q={q}',
    },
  });
  console.log('[embedded-selftest] search honest_failure:', JSON.stringify({
    ok: honest.ok,
    errorClass: honest.ok ? undefined : honest.errorClass,
    degradations: honest.ok ? [] : honest.degradations,
    failure: honest.ok ? undefined : honest.failure,
  }));
  if (honest.ok) throw new Error('iana.org 不应解析出搜索结果');
  if (honest.errorClass !== 'parse_empty') throw new Error(`应归类 parse_empty，实际 ${honest.errorClass}`);
  if (honest.degradations.length !== 0) throw new Error('页面有结果时不应继续降级');
  const honestFailure = honest.failure;
  if (!honestFailure?.pageAvailable || !honestFailure.tabId) throw new Error('诚实失败应保留页面并给探索上下文');
  if (!honestFailure.hint) throw new Error('诚实失败应带探索 hint');
  if (!manager.getTabRecord(honestFailure.tabId)) throw new Error('诚实失败页 tab 应保留未关闭');
  if (manager.getAgentTabId(SELFTEST_WS) !== honestFailure.tabId) throw new Error('诚实失败页 tab 应已切为 agent 当前 tab');

  const article = await readArticleWithBrowser('https://www.iana.org/help/example-domains', {
    workspaceId: SELFTEST_WS,
    taskMeta: { kind: 'article', conversationId: 'selftest' },
  });
  console.log('[embedded-selftest] readArticle:', JSON.stringify({
    ok: article.ok,
    title: article.ok ? article.meta.title : article.errorClass,
    wordCount: article.ok ? article.meta.wordCount : undefined,
  }));
  if (!article.ok) throw new Error(`读取文章自测失败：${article.errorClass} ${article.message}`);
  if (!article.meta.title || article.meta.wordCount <= 0) throw new Error('文章解析结果不完整');

  manager.closeTab(failure.tabId);
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

  const checkbox = fixtureObserve.elements.find((el) => el.role === 'checkbox' && inputText(el).includes('selftest'));
  if (!checkbox) throw new Error(`未找到注入的 checkbox（interactive=${fixtureObserve.elements.length}）`);
  const firstClick = await clickTab(tab, checkbox.ref);
  const checkedOnce = await tab.view.webContents.executeJavaScript(
    'document.getElementById("selftest-checkbox").checked === true',
  );
  if (!checkedOnce) throw new Error('checkbox 点击一次后未翻转（可能被双触发或点击无效）');
  if (firstClick.method === 'keyboard' && firstClick.statusChanged !== true) {
    throw new Error('keyboard 翻转 checkbox 后应标记 statusChanged 并跳过 synthetic 兜底');
  }
  console.log('[embedded-selftest] click checkbox:', JSON.stringify({
    method: firstClick.method,
    statusChanged: firstClick.statusChanged === true,
    checked: checkedOnce,
  }));
  const secondClick = await clickTab(tab, checkbox.ref);
  const checkedTwice = await tab.view.webContents.executeJavaScript(
    'document.getElementById("selftest-checkbox").checked === true',
  );
  if (checkedTwice) throw new Error('checkbox 第二次点击未翻回（可能被双触发）');
  console.log('[embedded-selftest] click checkbox twice:', JSON.stringify({
    method: secondClick.method,
    statusChanged: secondClick.statusChanged === true,
    checked: checkedTwice,
  }));

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
