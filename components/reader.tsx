'use client';

import { useState } from 'react';
import { Book } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';

interface ReaderProps {
  book: Book;
}

export function Reader({ book }: ReaderProps) {
  const [currentPage, setCurrentPage] = useState(book.current_page || 0);

  const nextPage = () => {
    if (book.total_pages && currentPage < book.total_pages - 1) {
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
          {currentPage + 1} / {book.total_pages || '?'}
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-3xl mx-auto">
          <div className="prose prose-lg dark:prose-invert">
            <p>阅读内容加载中...</p>
            <p>当前页面: {currentPage}</p>
          </div>
        </div>
      </div>

      <footer className="border-t px-4 py-2 flex justify-center gap-4">
        <Button onClick={prevPage} disabled={currentPage === 0}>
          <ChevronLeft className="w-4 h-4 mr-2" />
          上一页
        </Button>
        <Button onClick={nextPage} disabled={!book.total_pages || currentPage >= book.total_pages - 1}>
          下一页
          <ChevronRight className="w-4 h-4 ml-2" />
        </Button>
      </footer>
    </div>
  );
}
