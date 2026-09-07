export interface SitePolicy {
  matchOrigins: string[];
  searchUrlIncludes: string[];
  delayMs: { min: number; max: number };
  searchDelayMs: { min: number; max: number };
  budget: { maxNotes: number; maxSearches: number };
  riskKeywords: string[];
}

const XIAOHONGSHU_POLICY: SitePolicy = {
  matchOrigins: ['https://www.xiaohongshu.com'],
  searchUrlIncludes: ['/search_result'],
  delayMs: { min: 15_000, max: 45_000 },
  searchDelayMs: { min: 30_000, max: 90_000 },
  budget: { maxNotes: 20, maxSearches: 5 },
  riskKeywords: [
    '滑块',
    '滑动验证',
    '验证码',
    '安全验证',
    '访问频次异常',
    '请勿频繁操作',
    '操作过于频繁',
    '检测到AI操作',
    '当前笔记暂时无法浏览',
    '账号异常',
    '风险插件',
    'captcha',
  ],
};

const policies: SitePolicy[] = [XIAOHONGSHU_POLICY];

export function registerSitePolicy(policy: SitePolicy): void {
  policies.push(policy);
}

export function originOf(url: string): string | null {
  try {
    const origin = new URL(url).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

export function getSitePolicy(url: string): SitePolicy | null {
  const origin = originOf(url);
  if (!origin) return null;
  return policies.find((p) => p.matchOrigins.includes(origin)) ?? null;
}

export function isSearchResultUrl(policy: SitePolicy, url: string): boolean {
  return policy.searchUrlIncludes.some((needle) => url.includes(needle));
}

export function randomInRange(range: { min: number; max: number }): number {
  return Math.floor(range.min + Math.random() * (range.max - range.min + 1));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function matchRiskKeywords(policy: SitePolicy, text: string): string[] {
  if (!text) return [];
  return policy.riskKeywords.filter((keyword) => text.includes(keyword));
}

interface SessionBudgetUsage {
  searches: number;
  notes: number;
}

const ADHOC_CONVERSATION_KEY = '__adhoc__';
const usageByConversation = new Map<string, SessionBudgetUsage>();
const riskBlockedOriginsByConversation = new Map<string, Set<string>>();

function conversationKey(conversationId: string | undefined): string {
  return conversationId ?? ADHOC_CONVERSATION_KEY;
}

function usageOf(conversationId: string | undefined): SessionBudgetUsage {
  const key = conversationKey(conversationId);
  let usage = usageByConversation.get(key);
  if (!usage) {
    usage = { searches: 0, notes: 0 };
    usageByConversation.set(key, usage);
  }
  return usage;
}

export function checkSearchBudget(conversationId: string | undefined, policy: SitePolicy): string | null {
  const usage = usageOf(conversationId);
  if (usage.searches < policy.budget.maxSearches) return null;
  return `已达到本会话搜索次数上限（已用 ${usage.searches}/${policy.budget.maxSearches}，剩余额度 0）。本会话不再发起新搜索，可建议用户开启新会话继续`;
}

export function checkNoteBudget(conversationId: string | undefined, policy: SitePolicy): string | null {
  const usage = usageOf(conversationId);
  if (usage.notes < policy.budget.maxNotes) return null;
  return `已达到本会话笔记阅读上限（已用 ${usage.notes}/${policy.budget.maxNotes}，剩余额度 0）。本会话不再读取新笔记，可建议用户开启新会话继续`;
}

export function consumeSearch(conversationId: string | undefined): void {
  usageOf(conversationId).searches += 1;
}

export function consumeNote(conversationId: string | undefined): void {
  usageOf(conversationId).notes += 1;
}

export function isRiskBlocked(conversationId: string | undefined, origin: string | null): boolean {
  if (!origin) return false;
  return riskBlockedOriginsByConversation.get(conversationKey(conversationId))?.has(origin) ?? false;
}

export function markRiskBlocked(conversationId: string | undefined, origin: string | null): void {
  if (!origin) return;
  const key = conversationKey(conversationId);
  let origins = riskBlockedOriginsByConversation.get(key);
  if (!origins) {
    origins = new Set();
    riskBlockedOriginsByConversation.set(key, origins);
  }
  origins.add(origin);
}

export function riskBlockedMessage(): string {
  return '该站点此前已触发风控信号，本会话已停止对它的自动操作，请人工检查浏览器页面后再决定是否继续';
}

export function controlledBrowserBlock(url: string): string | null {
  const policy = getSitePolicy(url);
  if (!policy) return null;
  return (
    `受控浏览器禁止访问该站点（${policy.matchOrigins.join('、')}）。` +
    '此类登录态站点已绑定用户真实浏览器的扩展通道，请改用 dogear__extension__navigate / observe_page / click / fill / read_text / read_state ' +
    '在扩展已连接且授权的标签页上操作'
  );
}
