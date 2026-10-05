
import React, { useMemo, useRef, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy } from 'lucide-react';
import '@/src/hljs-theme.css';
import { highlightText, createMatchNumbering, type MatchNumbering } from './agent-chat/highlight';
import {
  GatedPathChip,
  PathChip,
  resolvePathCandidates,
  splitPathSegments,
  useExistenceResolved,
  useWorkspaceIdByPath,
  useWorkspaceRoots,
} from './agent-chat/path-link';
import { useConversationStore } from '@/stores/conversation-store';

export interface MarkdownRendererProps {
  /** Markdown 文本内容 */
  content: string;
  /** 额外的 CSS 类名 */
  className?: string;
  /** 搜索关键词，用于高亮显示 */
  searchQuery?: string;
  /** match id 前缀，格式 `${messageId}-${blockIndex}` */
  matchIdPrefix?: string;
  /** 当前激活的 match id */
  activeMatchId?: string | null;
  /** 渲染前剥掉 HTML 注释（如 `<!-- refs: ... -->`）。仅在报告/摘要等"人不该看到元注释"场景开启 */
  stripHtmlComments?: boolean;
  /** 传入即开启路径链接：正文裸路径与相对路径 md 链接渲染为可点胶囊（浮窗预览）；仅 plan 文档等路径可信场景开启 */
  workspacePath?: string;
  /** 相对链接解析基准目录（如 plan 文档所在目录），缺省用 workspacePath；正文裸路径始终以 workspacePath 为基准 */
  baseDir?: string;
  /** 追加在附加根之后的额外候选根（如组共享区目录），排在最后不抢工作区路径 */
  extraRoots?: string[];
}

/**
 * 对 children 中的 string 类型子节点应用搜索高亮；开启路径链接时改走路径识别（两模式互斥，路径场景无搜索词）
 * numbering 为块级编号器：同一逻辑块的多个 markdown 元素按文档序共用，保证 match id 与搜索端块内编号对齐
 */
function wrapChildren(
  children: React.ReactNode,
  query?: string,
  prefix?: string,
  activeId?: string | null,
  numbering?: MatchNumbering | null,
  renderPathSegments?: (text: string) => React.ReactNode
): React.ReactNode {
  const canHighlight = !!query?.trim() && !!prefix && !!numbering;
  return React.Children.map(children, child =>
    typeof child === 'string' && child
      ? (renderPathSegments
          ? renderPathSegments(child)
          : canHighlight ? <>{highlightText(child, query!, prefix!, activeId ?? null, numbering!)}</> : child)
      : child
  );
}

function CodeBlock({ children, ...props }: React.ComponentPropsWithoutRef<'pre'>) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = preRef.current?.textContent ?? '';
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  return (
    <pre
      ref={preRef}
      className="group/code relative rounded-lg border border-border bg-[var(--code-background)] text-foreground my-3 overflow-x-auto p-3.5 text-sm font-mono"
      {...props}
    >
      <button
        type="button"
        onClick={handleCopy}
        className="absolute top-2 right-2 z-10 rounded-md border border-border bg-background/80 p-1 text-muted-foreground opacity-0 transition-opacity group-hover/code:opacity-100 hover:bg-muted hover:text-foreground cursor-pointer"
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      {children}
    </pre>
  );
}

/**
 * 通用 Markdown 渲染组件
 * 支持 GFM 语法（表格、删除线等）、代码高亮、图片防盗链、链接安全拦截
 * 支持搜索高亮（searchQuery + matchIdPrefix + activeMatchId）
 */
export function MarkdownRenderer({ content, className, searchQuery, matchIdPrefix, activeMatchId, stripHtmlComments, workspacePath, baseDir, extraRoots }: MarkdownRendererProps) {
  const workspaceId = useWorkspaceIdByPath(workspacePath ?? null);
  const roots = useWorkspaceRoots(workspaceId);
  const allRoots = useMemo(() => (roots && extraRoots?.length ? [...roots, ...extraRoots] : roots), [roots, extraRoots]);

  // 每次渲染重置块级编号器；经 ref 中转让 memoized 的 mdComponents 闭包始终读到本轮的计数器
  const numberingRef = useRef<MatchNumbering | null>(null);
  numberingRef.current = searchQuery?.trim() && matchIdPrefix ? createMatchNumbering() : null;

  const processedContent = useMemo(
    () => (stripHtmlComments ? content.replace(/<!--[\s\S]*?-->/g, '') : content),
    [content, stripHtmlComments],
  );

  const openPathCandidates = useMemo(() => {
    if (!workspacePath || !allRoots) return null;
    return (href: string): string[] | null => {
      if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
      return resolvePathCandidates(href, allRoots, baseDir);
    };
  }, [workspacePath, allRoots, baseDir]);

  // 缓存 components 对象，避免每次渲染都生成新字面量导致 react-markdown 全量重渲染
  // 只有搜索/路径链接相关 props 变化时才重新生成（table/th/td/pre/a/img 是静态覆盖，也放进来以保持引用稳定）
  const mdComponents = useMemo(() => {
    const numbering = numberingRef.current;
    const canHighlight = !!searchQuery?.trim() && !!matchIdPrefix && !!numbering;
    const renderText = (text: string): React.ReactNode =>
      canHighlight ? <>{highlightText(text, searchQuery!, matchIdPrefix!, activeMatchId ?? null, numbering!)}</> : text;
    // 路径识别与搜索高亮共存：text 段高亮，path 段进 GatedPathChip 且内部文本也走高亮编号（保证 match id 与搜索端对齐）
    const renderPathSegments = !workspacePath || !allRoots ? undefined : (text: string): React.ReactNode => {
      const segments = splitPathSegments(text, allRoots);
      if (segments.length === 1 && segments[0].type === 'text') return renderText(text);
      return (
        <>
          {segments.map((seg, i) =>
            seg.type === 'path' && workspaceId && seg.candidates?.length ? (
              <GatedPathChip key={i} text={seg.text} candidates={seg.candidates} workspaceId={workspaceId}>
                {renderText(seg.text)}
              </GatedPathChip>
            ) : (
              <span key={i}>{renderText(seg.text)}</span>
            ),
          )}
        </>
      );
    };
    const wrap = (children: React.ReactNode) =>
      wrapChildren(children, searchQuery, matchIdPrefix, activeMatchId, numberingRef.current, renderPathSegments);
    const heading = (Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') =>
      ({ children, ...props }: React.ComponentPropsWithoutRef<typeof Tag>) => (
        <Tag {...props}>{wrap(children)}</Tag>
      );
    return {
    // 段落：对 string 子节点应用搜索高亮或路径识别
    p: ({ children, ...props }: React.ComponentPropsWithoutRef<'p'>) => (
      <p {...props}>{wrap(children)}</p>
    ),
    // 列表项：对 string 子节点应用搜索高亮或路径识别
    li: ({ children, ...props }: React.ComponentPropsWithoutRef<'li'>) => (
      <li {...props}>{wrap(children)}</li>
    ),
    // 标题：对 string 子节点应用搜索高亮或路径识别
    h1: heading('h1'),
    h2: heading('h2'),
    h3: heading('h3'),
    h4: heading('h4'),
    h5: heading('h5'),
    h6: heading('h6'),
    strong: ({ children, ...props }: React.ComponentPropsWithoutRef<'strong'>) => (
      <strong {...props}>{wrap(children)}</strong>
    ),
    em: ({ children, ...props }: React.ComponentPropsWithoutRef<'em'>) => (
      <em {...props}>{wrap(children)}</em>
    ),
    // 表格：添加边框和样式
    table: ({ children, ...props }: React.ComponentPropsWithoutRef<'table'>) => (
      <div className="overflow-x-auto my-4">
        <table className="min-w-full border-collapse border border-gray-300 dark:border-gray-600" {...props}>
          {children}
        </table>
      </div>
    ),
    th: ({ children, ...props }: React.ComponentPropsWithoutRef<'th'>) => (
      <th className="border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 px-3 py-2 text-left text-sm font-semibold" {...props}>
        {wrap(children)}
      </th>
    ),
    td: ({ children, ...props }: React.ComponentPropsWithoutRef<'td'>) => (
      <td className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm" {...props}>
        {wrap(children)}
      </td>
    ),
    pre: CodeBlock,
    // 行内 code：无 language-/hljs class 且无换行的给浅底胶囊；块内 code（含无语言围栏块）不干预，样式由 pre 控制继承
    code: ({ className, children, ...props }: React.ComponentPropsWithoutRef<'code'>) => {
      const isBlock = (className && /language-|hljs/.test(className)) || (typeof children === 'string' && children.includes('\n'));
      if (isBlock) {
        return <code className={className} {...props}>{wrap(children)}</code>;
      }
      if (renderPathSegments && workspaceId && typeof children === 'string') {
        const segments = splitPathSegments(children, allRoots);
        const seg = segments.length === 1 ? segments[0] : null;
        if (seg?.type === 'path' && seg.candidates?.length) {
          return <GatedPathChip text={seg.text} candidates={seg.candidates} workspaceId={workspaceId} />;
        }
      }
      return <code className="rounded bg-muted px-1 py-0.5 text-[0.9em] font-mono" {...props}>{wrap(children)}</code>;
    },
    // 链接：路径链接模式下产出多根候选，存在性通过 → 胶囊开浮窗（点击兜底再校验）；未通过/解析失败回退纯文本；外部 URL 维持浏览器打开
    a: ({ href, children, ...props }: React.ComponentPropsWithoutRef<'a'>) => {
      const candidates = useMemo(
        () => (openPathCandidates && href ? openPathCandidates(href) : null),
        [openPathCandidates, href],
      );
      const resolved = useExistenceResolved(workspaceId, candidates);
      if (candidates) {
        if (typeof resolved === 'string' && workspaceId) {
          return <PathChip text={resolved} resolved={resolved} workspaceId={workspaceId}>{children}</PathChip>;
        }
        return <span className="text-muted-foreground" {...props}>{children}</span>;
      }
      return (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            if (!href) return;
            // 应用内会话跳转链接（dogear://conversation/<id>?ws=<workspaceId>），由 agent 分流回执等场景产出
            if (href.startsWith('dogear://')) {
              void useConversationStore.getState().focusConversationFromLink(href);
              return;
            }
            window.open(href, '_blank');
          }}
          className="text-blue-500 hover:underline"
          {...props}
        >
          {children}
        </a>
      );
    },
    // 图片：限制最大宽度，防盗链处理
    img: ({ src, alt, ...props }: React.ComponentPropsWithoutRef<'img'>) => (
      <img
        src={src}
        alt={alt || ''}
        className="max-w-full h-auto rounded"
        loading="lazy"
        referrerPolicy="no-referrer"
        {...props}
      />
    ),
  };
  }, [searchQuery, matchIdPrefix, activeMatchId, workspacePath, allRoots, workspaceId, openPathCandidates]);

  return (
    <div className={`prose prose-sm dark:prose-invert max-w-none break-words ${className || ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={mdComponents}
        urlTransform={(url) => (url.startsWith('dogear://') ? url : defaultUrlTransform(url))}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}
