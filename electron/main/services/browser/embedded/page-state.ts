import type { EmbeddedPageState, EmbeddedTabRecord } from './types.js';

const VERIFICATION_URL_PATTERNS = [
  /google\.[a-z.]+\/sorry/i,
  /\/captcha/i,
  /recaptcha/i,
  /hcaptcha/i,
  /\/challenge\/?(\?|$|\/)/i,
  /cdn-cgi\/challenge/i,
];

const RATE_LIMIT_URL_PATTERNS = [/rate-?limit/i, /too-many-requests/i, /\/429(\b|\/|\.)/];

const LOGIN_URL_PATTERNS = [
  /\/log-?in(\b|\/|\?|#|$)/i,
  /\/sign-?in(\b|\/|\?|#|$)/i,
  /\/logon(\b|\/|\?|#|$)/i,
  /\/session\/new/i,
  /\/accounts\/(?:login|signin)/i,
  /\/oauth\/(?:authorize|login)/i,
  /\/passport\/(?:login|api)/i,
];

const VERIFICATION_TEXT_KEYWORDS = [
  '验证码',
  '滑动验证',
  '滑块',
  '安全验证',
  '人机验证',
  '异常流量',
  '访问异常',
  'captcha',
  'are you a human',
  'verify you are human',
  'confirm you are human',
  'unusual traffic',
];

const RATE_LIMIT_TEXT_KEYWORDS = ['访问频次异常', '请勿频繁操作', '操作过于频繁', '请求过于频繁', 'rate limit', 'too many requests'];

const LOGIN_TEXT_KEYWORDS = ['请先登录', '请登录后', '登录后才能', '需要登录', 'sign in to continue', 'log in to continue', 'please sign in', 'please log in'];

function matchesUrl(patterns: RegExp[], url: string): boolean {
  return patterns.some((pattern) => pattern.test(url));
}

function matchesText(keywords: string[], text: string): boolean {
  if (!text) return false;
  const lowered = text.toLowerCase();
  return keywords.some((keyword) => lowered.includes(keyword));
}

/**
 * pageState 判定统一入口：tab-events 维护 loading/ready/crashed 基础流转，
 * 本函数在其上叠加 URL 模式与页面特征关键词判定（规则集中此处，不散落各服务）。
 * pageText 传入观察到的页面文本（正文/AX 摘要）可提高判定准确度；无法取得时仅按 URL + 标题判定。
 * awaiting_human 为任务级状态（Step 6 产品化），不由本函数产出。
 */
export function resolvePageState(tab: EmbeddedTabRecord, pageText?: string): EmbeddedPageState {
  if (tab.state === 'crashed') return 'crashed';
  if (tab.state === 'loading') return 'loading';
  if (matchesUrl(VERIFICATION_URL_PATTERNS, tab.url)) return 'verification_required';
  if (matchesUrl(RATE_LIMIT_URL_PATTERNS, tab.url)) return 'rate_limited';
  if (matchesUrl(LOGIN_URL_PATTERNS, tab.url)) return 'login_required';
  const text = `${tab.title}\n${pageText ?? ''}`;
  if (matchesText(VERIFICATION_TEXT_KEYWORDS, text)) return 'verification_required';
  if (matchesText(RATE_LIMIT_TEXT_KEYWORDS, text)) return 'rate_limited';
  if (matchesText(LOGIN_TEXT_KEYWORDS, text)) return 'login_required';
  return 'ready';
}

/** 非常规状态给 agent 的下一步引导 */
export function pageStateHint(state: EmbeddedPageState): string | null {
  switch (state) {
    case 'login_required':
      return '页面疑似处于登录墙，自动操作无法继续；已产生等待人工状态，请告知用户在浏览器面板完成登录后点「完成后继续」';
    case 'verification_required':
      return '页面疑似处于人机验证/挑战页，自动操作已受限；已产生等待人工状态，请告知用户在浏览器面板人工完成验证后点「完成后继续」';
    case 'rate_limited':
      return '页面疑似触发访问频率限制，请停止自动操作并等待，或告知用户人工处理';
    case 'crashed':
      return '页面渲染进程已退出，请重新导航后操作';
    default:
      return null;
  }
}
