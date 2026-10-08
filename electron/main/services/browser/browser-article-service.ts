import { parseArticleHtml, type ParsedArticleData } from '../article-service.js';
import {
  clearExpandMarks,
  clearPagerMarks,
  markPagerCandidates,
  mergePagedPages,
  runPagerLoop,
  tryExpand,
} from './article-expand-pager.js';
import { mainTextLength, measureText } from './article-text.js';
import type {
  ArticleEmitFn,
  ReadArticleResult,
  ReadArticleWithBrowserOptions,
} from './browser-article-types.js';
import { getEmbeddedBrowserManager } from './embedded/embedded-browser-manager.js';
import {
  buildFetchFailure,
  closeFetchTab,
  createFetchPageOps,
  DEFAULT_FETCH_WORKSPACE_ID,
  isTimeoutError,
  loadFetchTab,
  promoteFetchTab,
  sleep,
  type FetchFailureContext,
} from './embedded/fetch-page.js';
import { resolvePageState } from './embedded/page-state.js';
import type { EmbeddedTabRecord } from './embedded/types.js';

const TASK_TIMEOUT_MS = 60_000;
const GOTO_TIMEOUT_MS = 25_000;
const CONTENT_WAIT_MS = 15_000;
const EXPAND_BUDGET_MS = 15_000;
const POLL_INTERVAL_MS = 500;
const CONTENT_READY_THRESHOLD = 200;
const EMPTY_TEXT_THRESHOLD = 100;

const LOGIN_HOST_PREFIXES = ['passport.', 'accounts.', 'login.'];
const LOGIN_PATH_RE = /^\/(login|signin|sign-in|auth)(\/|$)/;

function isLoginUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const pathName = parsed.pathname.toLowerCase();
    return LOGIN_HOST_PREFIXES.some((prefix) => host.startsWith(prefix)) || LOGIN_PATH_RE.test(pathName);
  } catch {
    return false;
  }
}

async function waitForContent(ops: ReturnType<typeof createFetchPageOps>, budgetMs: number): Promise<number> {
  const deadline = Date.now() + Math.max(0, budgetMs);
  let last = 0;
  while (Date.now() < deadline) {
    const stats = await measureText(ops);
    if (stats) {
      last = mainTextLength(stats);
      if (last > CONTENT_READY_THRESHOLD && stats.passwords === 0) return last;
    }
    if (Date.now() >= deadline) break;
    await sleep(POLL_INTERVAL_MS);
  }
  return last;
}

/**
 * 浏览器渲染解析文章（内嵌宿主）：openTab → 导航 → 等渲染 → 登录墙检测 → 翻页拼接 / 展开启发式
 * → 渲染后 DOM 走 Readability 管线。不落盘、不 throw，错误归类在返回值里；
 * need_login / 失败时页面保留在 tab（结构化 failure），need_login 会把内嵌窗口挂到主窗口。
 * 任务级超时（含创建 tab 时间）从函数入口起算。
 */
export async function readArticleWithBrowser(
  url: string,
  options?: ReadArticleWithBrowserOptions,
): Promise<ReadArticleResult> {
  const manager = getEmbeddedBrowserManager();
  const workspaceId = options?.workspaceId || DEFAULT_FETCH_WORKSPACE_ID;
  const taskMeta = options?.taskMeta ?? { kind: 'article' as const };
  const conversationId = taskMeta.conversationId;
  const holderId = conversationId ? `article:${conversationId}` : 'article';
  const onAction = options?.onAction;
  const emit: ArticleEmitFn = (event) => {
    const full = { taskMeta, ...event };
    if (onAction) onAction(full);
    else console.debug('[browser-article]', JSON.stringify(full));
  };

  const startAt = Date.now();
  const remaining = () => TASK_TIMEOUT_MS - (Date.now() - startAt);
  const expired = () => remaining() <= 0;
  let tab: EmbeddedTabRecord | null = null;

  const failureOf = (): FetchFailureContext | undefined =>
    tab ? buildFetchFailure(tab, resolvePageState(tab), true) : undefined;
  const timeoutResult = (message: string): ReadArticleResult => ({
    ok: false,
    errorClass: 'timeout',
    message,
    failure: failureOf(),
  });

  try {
    try {
      await manager.ensureWorkspaceProxy(workspaceId, undefined);
    } catch {
      emit({ action: 'wait', url, detail: '代理配置失败，本次直连', result: 'proxy_error' });
    }

    emit({ action: 'navigate', url, detail: '开始导航' });
    const snapshot = manager.openTab({ workspaceId, url, source: 'agent-opened', holderId, skipInitialLoad: true });
    tab = manager.getTabRecord(snapshot.tabId) ?? null;
    if (!tab) throw new Error('内嵌浏览器标签创建失败');
    await loadFetchTab(tab, url, Math.min(GOTO_TIMEOUT_MS, Math.max(1_000, remaining())));
    emit({ action: 'navigate', url: tab.url, detail: '导航完成', result: 'domcontentloaded' });

    if (expired()) return timeoutResult('任务超时');

    const ops = createFetchPageOps(manager, tab);
    const waited = await waitForContent(ops, Math.min(CONTENT_WAIT_MS, remaining()));
    emit({ action: 'wait', url: tab.url, detail: `渲染等待结束，正文字数 ${waited}`, result: String(waited) });

    if (expired()) return timeoutResult('任务超时');

    const stats = await measureText(ops);
    const checkUrl = ops.url();
    const urlWall = isLoginUrl(checkUrl);
    const domWall = !!stats && stats.passwords > 0 && stats.container < EMPTY_TEXT_THRESHOLD;
    if (urlWall || domWall) {
      emit({
        action: 'observe',
        url: checkUrl,
        detail: urlWall ? 'URL 命中登录页特征' : '页面出现密码输入框且无正文容器',
        result: 'need_login',
      });
      ops.presentWindow();
      return {
        ok: false,
        errorClass: 'need_login',
        message: `页面需要登录后才能读取：${checkUrl}。已将浏览器窗口置前，登录后可重试`,
        failure: buildFetchFailure(tab, resolvePageState(tab), true),
      };
    }

    const baseLen = stats ? mainTextLength(stats) : waited;
    let parsed: ParsedArticleData;
    let finalUrl: string;
    let qualityHint: string | undefined;

    if ((await markPagerCandidates(ops)) > 0) {
      emit({ action: 'observe', url: ops.url(), detail: '命中「下一页」按钮，进入翻页拼接', result: 'pager' });
      const outcome = await runPagerLoop(ops, startAt + TASK_TIMEOUT_MS, emit);
      await clearPagerMarks(ops);
      finalUrl = outcome.finalUrl;
      if (outcome.pages.length === 0) {
        emit({
          action: 'parse',
          url: finalUrl,
          detail: '翻页采集未解析出正文',
          result: outcome.incomplete ? 'timeout' : 'parse_empty',
        });
        if (outcome.incomplete) return timeoutResult('任务超时');
        return {
          ok: false,
          errorClass: 'parse_empty',
          message: '浏览器渲染后仍无法解析出正文：翻页首页无可用内容',
          failure: failureOf(),
        };
      }
      parsed = mergePagedPages(outcome.pages);
      if (outcome.incomplete) {
        qualityHint = `翻页未完成（已采集 ${outcome.incomplete.collected}/${outcome.incomplete.attempted} 页）`;
      }
      emit({
        action: 'parse',
        url: finalUrl,
        detail: `翻页拼接完成，共 ${outcome.pages.length} 页`,
        result: `pages=${outcome.pages.length}`,
      });
    } else {
      const { candidates, expanded } = await tryExpand(ops, baseLen, Math.min(EXPAND_BUDGET_MS, remaining()), emit);
      const afterExpand = await measureText(ops);
      const finalLen = afterExpand ? mainTextLength(afterExpand) : baseLen;
      emit({
        action: 'observe',
        url: ops.url(),
        detail: expanded ? `展开成功，正文 ${baseLen} → ${finalLen} 字` : `展开尝试后正文未变长（${finalLen} 字）`,
        result: expanded ? 'expanded' : 'no_change',
      });
      await clearExpandMarks(ops);

      if (expired()) return timeoutResult('任务超时');

      const html = await ops.content();
      finalUrl = ops.url();
      emit({ action: 'parse', url: finalUrl, detail: `渲染后 DOM ${html.length} 字符，开始 Readability 解析` });

      try {
        parsed = parseArticleHtml(html, finalUrl);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit({ action: 'parse', url: finalUrl, detail: message, result: 'parse_empty' });
        return {
          ok: false,
          errorClass: 'parse_empty',
          message: `浏览器渲染后仍无法解析出正文：${message}`,
          failure: failureOf(),
        };
      }
      if (candidates > 0 && !expanded) {
        qualityHint = '未能通过页面按钮展开全文，正文可能不完整';
      }
    }

    emit({ action: 'parse', url: finalUrl, detail: `解析成功：${parsed.title}`, result: `wordCount=${parsed.wordCount}` });
    closeFetchTab(manager, tab.tabId, holderId);
    tab = null;
    return {
      ok: true,
      meta: {
        url: finalUrl,
        title: parsed.title,
        author: parsed.author,
        siteName: parsed.siteName,
        excerpt: qualityHint
          ? parsed.excerpt
            ? `${parsed.excerpt}（提示：${qualityHint}）`
            : `（提示：${qualityHint}）`
          : parsed.excerpt,
        wordCount: parsed.wordCount,
        language: parsed.language,
        content: parsed.content,
        ...(qualityHint ? { qualityHint } : {}),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isTimeoutError(err) || expired()) {
      emit({ action: 'wait', url, detail: message, result: 'timeout' });
      return timeoutResult(`浏览器解析任务超时：${message}`);
    }
    emit({ action: 'observe', url, detail: message, result: 'browser_crash' });
    return {
      ok: false,
      errorClass: 'browser_crash',
      message: `浏览器解析失败：${message}`,
      failure: failureOf(),
    };
  } finally {
    promoteFetchTab(manager, tab?.tabId ?? null, holderId);
  }
}
