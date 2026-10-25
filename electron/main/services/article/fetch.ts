/**
 * 网络抓取与平台脚本调用
 */
import fs from 'fs/promises';
import path from 'path';

/**
 * 根据 URL 检测平台名称，用于选择对应的 Python 平台脚本。
 * 只认实际存在脚本的平台（当前仅 wechat，脚本缺失由 tryPlatformScript 前置检查兜底）；
 * 新平台不在 TS 预登记，由 AI 兜底任务按 SKILL.md 流程自产脚本。
 * 返回 null 表示未识别的平台，走 Readability 兜底。
 */
export function detectPlatform(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    if (host === 'mp.weixin.qq.com') return 'wechat';
    return null;
  } catch {
    return null;
  }
}

/** 桌面端抓取统一 UA（搜索快档与文章抓取共用，避免多处漂移） */
export const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** fetch 失败的结构化错误：status / code 字段供调用方归类与展示 */
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

function toFetchError(err: unknown): FetchError {
  const message = err instanceof Error ? err.message : String(err);
  const cause = (err as { cause?: { code?: string } }).cause;
  return new FetchError(message, {
    code: cause?.code ?? (err as { code?: string }).code,
  });
}

/** 非网页资源错误码（FetchError.code），调用方据此给出精确文案 */
export const NON_HTML_RESOURCE_CODE = 'NON_HTML_RESOURCE';

const NON_HTML_EXTENSIONS = [
  'js', 'mjs', 'css', 'json', 'map',
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp',
  'woff', 'woff2', 'ttf', 'ico',
  'zip', 'gz', 'mp4', 'mp3', 'pdf',
];

function hasNonHtmlExtension(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    const lastSegment = pathname.split('/').pop() ?? '';
    const dot = lastSegment.lastIndexOf('.');
    if (dot <= 0) return false;
    return NON_HTML_EXTENSIONS.includes(lastSegment.slice(dot + 1).toLowerCase());
  } catch {
    return false;
  }
}

/**
 * 仅抓取 URL 的原始 HTML，不做解析。
 * 供主流程在尝试平台脚本前预取，避免后续 Readability 重复抓取。
 * 资源防线：扩展名黑名单直接拒绝；响应体不含 <html / <!doctype 判定非 HTML。
 * 失败抛 FetchError（HTTP 非 2xx 带 status，网络异常带 code，非网页资源带 NON_HTML_RESOURCE_CODE）。
 */
export async function fetchRawHtml(url: string): Promise<string> {
  if (hasNonHtmlExtension(url)) {
    throw new FetchError('非网页资源，不入库', { code: NON_HTML_RESOURCE_CODE });
  }
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': DESKTOP_USER_AGENT,
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
  let text: string;
  try {
    text = await response.text();
  } catch (err) {
    throw toFetchError(err);
  }
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lower = withoutBom.toLowerCase();
  if (!lower.includes('<html') && !lower.includes('<!doctype')) {
    throw new FetchError('非网页资源，不入库', { code: NON_HTML_RESOURCE_CODE });
  }
  return text;
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
