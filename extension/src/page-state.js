// 判定规则同步自 electron/main/services/browser/embedded/page-state.ts（两通道协议数据，改动需双侧同步）
const VERIFICATION_URL_PATTERNS = [
  /google\.[a-z.]+\/sorry/i,
  /\/captcha/i,
  /recaptcha/i,
  /hcaptcha/i,
  /\/challenge\/?(\?|$|\/)/i,
  /cdn-cgi\/challenge/i
]

const RATE_LIMIT_URL_PATTERNS = [/rate-?limit/i, /too-many-requests/i, /\/429(\b|\/|\.)/]

const LOGIN_URL_PATTERNS = [
  /\/log-?in(\b|\/|\?|#|$)/i,
  /\/sign-?in(\b|\/|\?|#|$)/i,
  /\/logon(\b|\/|\?|#|$)/i,
  /\/session\/new/i,
  /\/accounts\/(?:login|signin)/i,
  /\/oauth\/(?:authorize|login)/i,
  /\/passport\/(?:login|api)/i
]

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
  'unusual traffic'
]

const RATE_LIMIT_TEXT_KEYWORDS = ['访问频次异常', '请勿频繁操作', '操作过于频繁', '请求过于频繁', 'rate limit', 'too many requests']

const LOGIN_TEXT_KEYWORDS = ['请先登录', '请登录后', '登录后才能', '需要登录', 'sign in to continue', 'log in to continue', 'please sign in', 'please log in']

function matchesUrl(patterns, url) {
  if (!url) return false
  return patterns.some((pattern) => pattern.test(url))
}

function matchesText(keywords, text) {
  if (!text) return false
  const lowered = text.toLowerCase()
  return keywords.some((keyword) => lowered.includes(keyword))
}

export function resolvePageState(url, title, pageText) {
  if (matchesUrl(VERIFICATION_URL_PATTERNS, url)) return 'verification_required'
  if (matchesUrl(RATE_LIMIT_URL_PATTERNS, url)) return 'rate_limited'
  if (matchesUrl(LOGIN_URL_PATTERNS, url)) return 'login_required'
  const text = `${title ?? ''}\n${pageText ?? ''}`
  if (matchesText(VERIFICATION_TEXT_KEYWORDS, text)) return 'verification_required'
  if (matchesText(RATE_LIMIT_TEXT_KEYWORDS, text)) return 'rate_limited'
  if (matchesText(LOGIN_TEXT_KEYWORDS, text)) return 'login_required'
  return 'ready'
}
