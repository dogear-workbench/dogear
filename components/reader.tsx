'use client';

import { useState, useEffect } from 'react';
import { Book } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { electronBook } from '@/lib/electron';

interface ReaderProps {
  book: Book;
}

export function Reader({ book }: ReaderProps) {
  const [currentPage, setCurrentPage] = useState(book.current_page || 0);
  const [content, setContent] = useState('');
  const [totalPages, setTotalPages] = useState(book.total_pages || 0);
  const [loading, setLoading] = useState(false);

  // 加载 TXT 文件内容
  useEffect(() => {
    if (book.file_type === 'txt') {
      loadTxtContent();
    }
  }, [currentPage, book]);

  const loadTxtContent = async () => {
    try {
      setLoading(true);
      const result = await electronBook.getTxtPage(book.file_path, currentPage);
      setContent(result.content);
      setTotalPages(result.totalPages);
    } catch (error) {
      console.error('加载 TXT 内容失败:', error);
      setContent('加载失败,请重试');
    } finally {
      setLoading(false);
    }
  };

  const nextPage = () => {
    if (currentPage < totalPages - 1) {
      setCurrentPage(currentPage + 1);
    }
  };

  const prevPage = () => {
    if (currentPage > 0) {
      setCurrentPage(currentPage - 1);
    }
  };

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b px-4 py-2 flex items-center justify-between">
        <Link href="/">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <h1 className="text-lg font-semibold">{book.title}</h1>
        <div className="text-sm text-muted-foreground">
          {currentPage + 1} / {totalPages || '?'}
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-3xl mx-auto">
          {loading ? (
            <div className="text-center py-8">加载中...</div>
          ) : book.file_type === 'txt' ? (
            <div className="prose prose-lg dark:prose-invert whitespace-pre-wrap">
              {content}
            </div>
          ) : (
            <div className="prose prose-lg dark:prose-invert">
              <p>暂不支持 {book.file_type.toUpperCase()} 格式的阅读</p>
              <p className="text-sm text-muted-foreground">当前仅支持 TXT 文件阅读</p>
            </div>
          )}
        </div>
      </div>

      <footer className="border-t px-4 py-2 flex justify-center gap-4">
        <Button onClick={prevPage} disabled={currentPage === 0}>
          <ChevronLeft className="w-4 h-4 mr-2" />
          上一页
        </Button>
        <Button onClick={nextPage} disabled={currentPage >= totalPages - 1}>
          下一页
          <ChevronRight className="w-4 h-4 ml-2" />
        </Button>
      </footer>
    </div>
  );
}
