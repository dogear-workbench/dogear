
import React from 'react';
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
  /** match id 前缀，格式 `${messageIndex}-${blockIndex}` */
  matchIdPrefix?: string;
  /** 当前激活的 match id */
  activeMatchId?: string | null;
}

/**
 * 对 children 中的 string 类型子节点应用高亮
 */
function wrapChildren(
  children: React.ReactNode,
  query?: string,
  prefix?: string,
  activeId?: string | null
): React.ReactNode {
  if (!query?.trim() || !prefix) return children;
  return React.Children.map(children, child =>
    typeof child === 'string' ? highlightText(child, query, prefix, activeId ?? null) : child
  );
}

/**
 * 通用 Markdown 渲染组件
 * 支持 GFM 语法（表格、删除线等）、代码高亮、图片防盗链、链接安全拦截
 * 支持搜索高亮（searchQuery + matchIdPrefix + activeMatchId）
 */
export function MarkdownRenderer({ content, className, searchQuery, matchIdPrefix, activeMatchId }: MarkdownRendererProps) {
  return (
    <div className={`prose prose-sm dark:prose-invert max-w-none break-words ${className || ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // 段落：对 string 子节点应用搜索高亮
          p: ({ children, ...props }) => (
            <p {...props}>{wrapChildren(children, searchQuery, matchIdPrefix, activeMatchId)}</p>
          ),
          // 列表项：对 string 子节点应用搜索高亮
          li: ({ children, ...props }) => (
            <li {...props}>{wrapChildren(children, searchQuery, matchIdPrefix, activeMatchId)}</li>
          ),
          // 表格：添加边框和样式
          table: ({ children, ...props }) => (
            <div className="overflow-x-auto my-4">
              <table className="min-w-full border-collapse border border-gray-300 dark:border-gray-600" {...props}>
                {children}
              </table>
            </div>
          ),
          th: ({ children, ...props }) => (
            <th className="border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 px-3 py-2 text-left text-sm font-semibold" {...props}>
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm" {...props}>
              {children}
            </td>
          ),
          // 代码块：添加圆角和溢出滚动
          pre: ({ children, ...props }) => (
            <pre className="rounded-lg overflow-x-auto p-4 my-3 bg-gray-900 text-gray-100" {...props}>
              {children}
            </pre>
          ),
          // 链接：拦截默认导航，改为外部浏览器打开
          a: ({ href, children, ...props }) => (
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
          img: ({ src, alt, ...props }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={alt || ''}
              className="max-w-full h-auto rounded"
              loading="lazy"
              referrerPolicy="no-referrer"
              {...props}
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
