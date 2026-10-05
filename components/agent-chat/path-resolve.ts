export interface PathSegment {
  type: 'text' | 'path';
  text: string;
  /** 首选候选（兼容旧消费方；实际渲染以存在性校验选出的候选为准） */
  resolved?: string;
  /** 多根补全出的全部绝对路径候选，按优先级排序（主根 → 附加根） */
  candidates?: string[];
  fileName?: string;
}

const PATH_TOKEN_RE = /(?:[A-Za-z]:[\\/]|[\\/])[A-Za-z0-9_.\-~@$()+\\/]*/g;
// 裸相对路径 token：`file.ext` / `seg/seg.ext` 形态，前后必须是路径字符边界；误报由存在性校验兜底为纯文本
const REL_PATH_TOKEN_RE = /(^|[^A-Za-z0-9_.\-~@$+\\/]*)((?:[A-Za-z0-9_.\-~@$+]+[\\/])*[A-Za-z0-9_.\-~@$+]+\.(?:md|markdown|txt|json))(?![A-Za-z0-9_.\-])/gi;
const TRAILING_PUNCT_RE = /[.,;:!?)\]}'"]+$/;
export const ALLOWED_EXT_RE = /\.(md|markdown|txt|json)$/i;

const ABS_PREFIX_RE = /^(?:[A-Za-z]:[\\/]|[\\/])/;

function resolveCandidateAgainstRoot(posixCandidate: string, root: string, allowRelative: boolean): string | null {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalizedRoot) return null;
  const drive = /^([A-Za-z]):\//.exec(posixCandidate);
  let prefix: string;
  let parts: string[];
  if (drive || posixCandidate.startsWith('/')) {
    prefix = drive ? `${drive[1]}:/` : '/';
    parts = posixCandidate.slice(prefix.length).split('/');
  } else {
    if (!allowRelative) return null;
    const rootDrive = /^([A-Za-z]):\//.exec(normalizedRoot);
    if (rootDrive) prefix = `${rootDrive[1]}:/`;
    else if (normalizedRoot.startsWith('/')) prefix = '/';
    else return null;
    parts = [...normalizedRoot.slice(prefix.length).split('/'), ...posixCandidate.split('/')];
  }
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  const resolved = prefix + stack.join('/');
  const lowerResolved = resolved.toLowerCase();
  const lowerRoot = normalizedRoot.toLowerCase();
  if (lowerResolved === lowerRoot || lowerResolved.startsWith(lowerRoot + '/')) return resolved;
  return null;
}

/**
 * 候选路径 → 多根补全候选列表：
 * - 绝对路径：命中任一根内即单候选返回；越界返回空
 * - 相对路径：逐根拼接（agent 语义：相对主工作区根，附加根兜底），全部通过前缀校验的候选按 roots 顺序排列
 * - baseDir 提供（md 链接相对文档目录）时优先按 baseDir 拼接，再逐根
 */
export function resolvePathCandidates(candidate: string, roots: string[], baseDir?: string): string[] {
  const posix = candidate.replace(/\\/g, '/');
  if (!posix || posix === '/' || /^[A-Za-z]:\/?$/i.test(posix)) return [];
  if (baseDir) {
    const viaBase = resolveCandidateAgainstRoot(posix, baseDir, true);
    const viaRoots = roots
      .map((root) => resolveCandidateAgainstRoot(posix, root, true))
      .filter((r): r is string => !!r && r !== viaBase);
    return viaBase ? [viaBase, ...viaRoots] : viaRoots;
  }
  if (ABS_PREFIX_RE.test(posix)) {
    for (const root of roots) {
      const resolved = resolveCandidateAgainstRoot(posix, root, false);
      if (resolved) return [resolved];
    }
    return [];
  }
  return roots
    .map((root) => resolveCandidateAgainstRoot(posix, root, true))
    .filter((r): r is string => !!r);
}

export function resolvePathInWorkspace(candidate: string, workspacePath: string, allowRelative = false): string | null {
  if (!workspacePath) return null;
  return resolveCandidateAgainstRoot(candidate.replace(/\\/g, '/'), workspacePath, allowRelative);
}

/** 双正则 token 化：绝对路径 token（TRAILING_PUNCT 截尾标点）+ 裸相对路径 token（区间与绝对 token 重叠时丢弃） */
function collectPathTokens(text: string): { token: string; index: number; end: number }[] {
  const hits: { token: string; index: number; end: number }[] = [];
  PATH_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PATH_TOKEN_RE.exec(text)) !== null) {
    const token = match[0].replace(TRAILING_PUNCT_RE, '');
    if (!token || !/[\\/]/.test(token) || !ALLOWED_EXT_RE.test(token)) continue;
    // 裸分隔符开头且前一字符是路径段字符时，是相对路径（docs/a.md）的后半段误捕，让位给相对 token
    if (/^[\\/]/.test(token) && match.index > 0 && /[A-Za-z0-9_.\-~@$+]/.test(text[match.index - 1])) continue;
    hits.push({ token, index: match.index, end: match.index + token.length });
  }
  REL_PATH_TOKEN_RE.lastIndex = 0;
  while ((match = REL_PATH_TOKEN_RE.exec(text)) !== null) {
    const token = match[2];
    const start = match.index + match[1].length;
    const end = start + token.length;
    const overlaps = hits.some((h) => start < h.end && end > h.index);
    if (overlaps) continue;
    hits.push({ token, index: start, end });
  }
  hits.sort((a, b) => a.index - b.index);
  return hits;
}

export function splitPathSegments(text: string, roots: string[] | null): PathSegment[] {
  if (!roots?.length || !text) return [{ type: 'text', text }];
  const segments: PathSegment[] = [];
  let cursor = 0;
  const emitText = (end: number) => {
    if (end > cursor) segments.push({ type: 'text', text: text.slice(cursor, end) });
  };
  for (const hit of collectPathTokens(text)) {
    const candidates = resolvePathCandidates(hit.token, roots);
    if (candidates.length === 0) continue;
    emitText(hit.index);
    segments.push({
      type: 'path',
      text: hit.token,
      candidates,
      resolved: candidates[0],
      fileName: candidates[0].split('/').pop() ?? candidates[0],
    });
    cursor = hit.end;
  }
  emitText(text.length);
  if (segments.length === 0) return [{ type: 'text', text }];
  return segments;
}
