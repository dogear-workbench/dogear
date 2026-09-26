/**
 * WorkspaceExplorer 内联输入与空态引导组件
 */
import React, { useState, useEffect, useRef } from 'react';
import { Globe, FolderPlus, Loader2 } from 'lucide-react';
import { useArticleStore } from '@/stores/article-store';

interface NewFolderInputProps {
  onConfirm: (name: string) => void;
  onCancel: () => void;
  indent: number;
}

export function NewFolderInput({ onConfirm, onCancel, indent }: NewFolderInputProps) {
  const [value, setValue] = useState('新文件夹');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed) {
        onConfirm(trimmed);
      } else {
        onCancel();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const handleBlur = () => {
    const trimmed = value.trim();
    // 如果用户没有修改默认名称，视为取消
    if (trimmed && trimmed !== '新文件夹') {
      onConfirm(trimmed);
    } else {
      onCancel();
    }
  };

  return (
    <div
      className="flex items-center gap-1 py-1 pr-2"
      style={{ paddingLeft: `${indent}px` }}
    >
      <FolderPlus className="w-4 h-4 shrink-0 text-blue-500" />
      <input
        ref={inputRef}
        className="flex-1 min-w-0 bg-background border border-primary rounded px-1 py-0 text-sm outline-none"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
    </div>
  );
}

export function ArticleUrlInput({ indent }: { indent: number }) {
  const articleUrlInput = useArticleStore(s => s.articleUrlInput);
  const setArticleUrlInput = useArticleStore(s => s.setArticleUrlInput);
  const submitArticleUrl = useArticleStore(s => s.submitArticleUrl);
  const hideUrlInput = useArticleStore(s => s.hideUrlInput);
  const parsingArticle = useArticleStore(s => s.parsingArticle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (articleUrlInput.trim()) void submitArticleUrl();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideUrlInput();
    }
  };

  return (
    <div className="flex items-center gap-1 py-1 pr-2" style={{ paddingLeft: `${indent}px` }}>
      <Globe className="w-4 h-4 shrink-0 text-green-500" />
      <input
        ref={inputRef}
        type="url"
        className="flex-1 min-w-0 bg-background border border-primary rounded px-1 py-0 text-sm outline-none"
        placeholder="粘贴文章 URL，Enter 解析"
        value={articleUrlInput}
        onChange={e => setArticleUrlInput(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={parsingArticle}
      />
      {parsingArticle && <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-muted-foreground" />}
    </div>
  );
}

/** 文章区空态引导：导入第一篇文章 */
export function ImportArticleGuide({ indent }: { indent: number }) {
  const showUrlInput = useArticleStore(s => s.showUrlInput);
  return (
    <div className="py-1 pr-2" style={{ paddingLeft: `${indent}px` }}>
      <button
        className="flex items-center gap-1.5 px-2 py-1 rounded border border-dashed text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
        onClick={() => showUrlInput()}
      >
        <Globe className="w-3.5 h-3.5" />
        导入第一篇文章
      </button>
    </div>
  );
}
