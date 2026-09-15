
import React, { useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy } from 'lucide-react';
import '@/src/hljs-theme.css';
import { highlightText, createMatchNumbering, type MatchNumbering } from './agent-chat/highlight';
import {
  ALLOWED_EXT_RE,
  PathChip,
  resolvePathInWorkspace,
  splitPathSegments,
  useWorkspaceIdByPath,
} from './agent-chat/path-link';
import { useMarkdownPreviewStore } from '@/stores/markdown-preview-store';

interface MarkdownRendererProps {
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
export function MarkdownRenderer({ content, className, searchQuery, matchIdPrefix, activeMatchId, stripHtmlComments, workspacePath, baseDir }: MarkdownRendererProps) {
  const workspaceId = useWorkspaceIdByPath(workspacePath ?? null);

  // 每次渲染重置块级编号器；经 ref 中转让 memoized 的 mdComponents 闭包始终读到本轮的计数器
  const numberingRef = useRef<MatchNumbering | null>(null);
  numberingRef.current = searchQuery?.trim() && matchIdPrefix ? createMatchNumbering() : null;

  const processedContent = useMemo(
    () => (stripHtmlComments ? content.replace(/<!--[\s\S]*?-->/g, '') : content),
    [content, stripHtmlComments],
  );

  const renderPathSegments = useMemo(() => {
    if (!workspacePath) return undefined;
    return (text: string): React.ReactNode => {
      const segments = splitPathSegments(text, workspacePath);
      if (segments.length === 1 && segments[0].type === 'text') return text;
      return (
        <>
          {segments.map((seg, i) =>
            seg.type === 'path' && workspaceId && seg.resolved ? (
              <PathChip key={i} text={seg.text} resolved={seg.resolved} fileName={seg.fileName} workspaceId={workspaceId} />
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )}
        </>
      );
    };
  }, [workspacePath, workspaceId]);

  const openPathPreview = useMemo(() => {
    if (!workspacePath) return null;
    const base = baseDir ?? workspacePath;
    return (href: string): string | null => {
      const resolved = resolvePathInWorkspace(href, base, true);
      if (!resolved || !ALLOWED_EXT_RE.test(resolved)) return null;
      return resolved;
    };
  }, [workspacePath, baseDir]);

  // 缓存 components 对象，避免每次渲染都生成新字面量导致 react-markdown 全量重渲染
  // 只有搜索/路径链接相关 props 变化时才重新生成（table/th/td/pre/a/img 是静态覆盖，也放进来以保持引用稳定）
  const mdComponents = useMemo(() => {
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
      return <code className="rounded bg-muted px-1 py-0.5 text-[0.9em] font-mono" {...props}>{wrap(children)}</code>;
    },
    // 链接：路径链接模式下相对路径解析成功且白名单内 → 胶囊开浮窗；失败回退纯文本；外部 URL 维持浏览器打开
    a: ({ href, children, ...props }: React.ComponentPropsWithoutRef<'a'>) => {
      if (openPathPreview && href && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
        const resolved = openPathPreview(href);
        if (resolved && workspaceId) {
          return (
            <button
              type="button"
              onClick={() =>
                useMarkdownPreviewStore.getState().open(workspaceId, resolved, resolved.split('/').pop() ?? resolved)
              }
              className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 align-baseline max-w-[280px] rounded-full border border-teal-200 bg-teal-50 text-xs text-teal-700 hover:bg-teal-100 hover:border-teal-300 transition-colors"
              title={resolved}
            >
              {children}
            </button>
          );
        }
        return <span className="text-muted-foreground" {...props}>{children}</span>;
      }
      return (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            if (href) window.open(href, '_blank');
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
  }, [searchQuery, matchIdPrefix, activeMatchId, renderPathSegments, openPathPreview, workspaceId]);

  return (
    <div className={`prose prose-sm dark:prose-invert max-w-none break-words ${className || ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={mdComponents}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}
