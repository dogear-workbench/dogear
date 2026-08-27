
import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { highlightText } from './agent-chat/highlight';

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
}

/**
 * 对 children 中的 string 类型子节点应用搜索高亮（不再做正文路径识别：工具块外路径存在性与否不可信）
 */
function wrapChildren(
  children: React.ReactNode,
  query?: string,
  prefix?: string,
  activeId?: string | null
): React.ReactNode {
  const canHighlight = !!query?.trim() && !!prefix;
  return React.Children.map(children, child =>
    typeof child === 'string' && child
      ? (canHighlight ? <>{highlightText(child, query!, prefix!, activeId ?? null)}</> : child)
      : child
  );
}

/**
 * 通用 Markdown 渲染组件
 * 支持 GFM 语法（表格、删除线等）、代码高亮、图片防盗链、链接安全拦截
 * 支持搜索高亮（searchQuery + matchIdPrefix + activeMatchId）
 */
export function MarkdownRenderer({ content, className, searchQuery, matchIdPrefix, activeMatchId, stripHtmlComments }: MarkdownRendererProps) {
  const processedContent = useMemo(
    () => (stripHtmlComments ? content.replace(/<!--[\s\S]*?-->/g, '') : content),
    [content, stripHtmlComments],
  );
  // 缓存 components 对象，避免每次渲染都生成新字面量导致 react-markdown 全量重渲染
  // 只有搜索相关 props 变化时才重新生成（table/th/td/pre/a/img 是静态覆盖，也放进来以保持引用稳定）
  const mdComponents = useMemo(() => ({
    // 段落：对 string 子节点应用搜索高亮
    p: ({ children, ...props }: React.ComponentPropsWithoutRef<'p'>) => (
      <p {...props}>{wrapChildren(children, searchQuery, matchIdPrefix, activeMatchId)}</p>
    ),
    // 列表项：对 string 子节点应用搜索高亮
    li: ({ children, ...props }: React.ComponentPropsWithoutRef<'li'>) => (
      <li {...props}>{wrapChildren(children, searchQuery, matchIdPrefix, activeMatchId)}</li>
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
        {children}
      </th>
    ),
    td: ({ children, ...props }: React.ComponentPropsWithoutRef<'td'>) => (
      <td className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm" {...props}>
        {children}
      </td>
    ),
    // 代码块：添加圆角和溢出滚动
    pre: ({ children, ...props }: React.ComponentPropsWithoutRef<'pre'>) => (
      <pre className="rounded-lg overflow-x-auto p-4 my-3 bg-gray-900 text-gray-100" {...props}>
        {children}
      </pre>
    ),
    // 链接：拦截默认导航，改为外部浏览器打开
    a: ({ href, children, ...props }: React.ComponentPropsWithoutRef<'a'>) => (
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
    ),
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
  }), [searchQuery, matchIdPrefix, activeMatchId]);

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
