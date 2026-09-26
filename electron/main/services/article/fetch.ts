/**
 * 网络抓取与平台脚本调用
 */
import fs from 'fs/promises';
import path from 'path';

/**
 * 根据 URL 检测平台名称，用于选择对应的 Python 平台脚本。
 * 返回 null 表示未识别的平台，走 Readability 兜底。
 */
export function detectPlatform(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    if (host === 'mp.weixin.qq.com') return 'wechat';
    if (host.endsWith('.zhihu.com')) return 'zhihu';
    if (host.endsWith('.juejin.cn') || host === 'juejin.cn') return 'juejin';
    if (host.endsWith('.bilibili.com') || host === 'bilibili.com') return 'bilibili';
    return null;
  } catch {
    return null;
  }
}

/** fetch 失败的结构化错误：白名单分流只认 status / code 字段，不解析错误字符串 */
export class FetchError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, fields?: { status?: number; code?: string }) {
    super(message);
    this.name = 'FetchError';
    if (fields?.status !== undefined) this.status = fields.status;
    if (fields?.code !== undefined) this.code = fields.code;
  }
}

/** 命中即可尝试浏览器层救活的 HTTP 状态（轻反爬挑战 / 限流） */
const BROWSER_RETRY_HTTP_STATUS = new Set([403, 429, 503]);

/** 命中即可尝试浏览器层救活的网络错误码（超时类 / 连接重置） */
const BROWSER_RETRY_NET_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNABORTED',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/** 判断 fetch 失败是否应分流进浏览器层重试（只认 FetchError 结构化字段） */
export function isBrowserRetryableFetchError(err: unknown): boolean {
  if (!(err instanceof FetchError)) return false;
  if (err.status !== undefined) return BROWSER_RETRY_HTTP_STATUS.has(err.status);
  if (err.code !== undefined) return BROWSER_RETRY_NET_CODES.has(err.code);
  return false;
}

function toFetchError(err: unknown): FetchError {
  const message = err instanceof Error ? err.message : String(err);
  const cause = (err as { cause?: { code?: string } }).cause;
  return new FetchError(message, {
    code: cause?.code ?? (err as { code?: string }).code,
  });
}

/**
 * 仅抓取 URL 的原始 HTML，不做解析。
 * 供主流程在尝试平台脚本前预取，避免后续 Readability 重复抓取。
 * 失败抛 FetchError（HTTP 非 2xx 带 status，网络异常带 code）。
 */
export async function fetchRawHtml(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
  } catch (err) {
    throw toFetchError(err);
  }
  if (!response.ok) {
    throw new FetchError(`HTTP ${response.status} ${response.statusText}`, {
      status: response.status,
    });
  }
  try {
    return await response.text();
  } catch (err) {
    throw toFetchError(err);
  }
}

/** tryPlatformScript 的返回值类型 */
export interface ScriptParseAttempt {
  ok: boolean;
  title?: string;
  content?: string;
  author?: string | null;
  siteName?: string | null;
  excerpt?: string | null;
  language?: string | null;
  durationMs: number;
  errorType?: string;
  errorMessage?: string;
}

/**
 * 尝试用平台脚本解析文章。
 * 脚本不存在 → ok=false, errorType='NoScript'（不是异常，是正常的"无脚本"情况）
 * 脚本成功 → ok=true 含解析结果
 * 脚本失败 → ok=false 含错误详情
 * 此函数永远不 throw，所有错误包装在返回值里。
 */
export async function tryPlatformScript(params: {
  platform: string;
  url: string;
  html: string;
  timeoutMs?: number;
}): Promise<ScriptParseAttempt> {
  const { getArticleParserSkillsDir } = await import('../article-parser-skills-service.js');
  const { pythonBridge } = await import('../stock/python-bridge.js');
  const scriptPath = path.join(getArticleParserSkillsDir(), 'platforms', `${params.platform}.py`);

  // 脚本不存在 → 静默返回（不报错）
  const exists = await fs.access(scriptPath).then(() => true).catch(() => false);
  if (!exists) {
    return {
      ok: false,
      durationMs: 0,
      errorType: 'NoScript',
      errorMessage: `No platform script for ${params.platform}`,
    };
  }

  try {
    const res = await pythonBridge.call<Record<string, unknown>>('run_article_script', {
      script_path: scriptPath,
      url: params.url,
      html: params.html,
      timeout_ms: params.timeoutMs ?? 5000,
    }, 30_000);

    return {
      ok: !!res.ok,
      title: typeof res.title === 'string' ? res.title : undefined,
      content: typeof res.content === 'string' ? res.content : undefined,
      author: typeof res.author === 'string' ? res.author : null,
      siteName: typeof res.site_name === 'string' ? res.site_name : null,
      excerpt: typeof res.excerpt === 'string' ? res.excerpt : null,
      language: typeof res.language === 'string' ? res.language : null,
      durationMs: typeof res.duration_ms === 'number' ? res.duration_ms : 0,
      errorType: typeof res.error_type === 'string' ? res.error_type : undefined,
      errorMessage: typeof res.error_message === 'string' ? res.error_message : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      durationMs: 0,
      errorType: 'BridgeError',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
