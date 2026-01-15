'use client';

import { useBooks } from '@/lib/hooks';
import { BookCard } from './book-card';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';

export function BookList() {
  const { books, loading, error, deleteBook } = useBooks();

  if (loading) {
    return <div className="text-center py-8">加载中...</div>;
  }

  if (error) {
    return <div className="text-center py-8 text-destructive">加载失败: {error.message}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">我的书架</h1>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          导入书籍
        </Button>
      </div>

      {books.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-lg mb-4">还没有书籍</p>
          <p>点击"导入书籍"开始添加</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {books.map((book) => (
            <BookCard key={book.id} book={book} onDelete={deleteBook} />
          ))}
        </div>
      )}
    </div>
  );
}
