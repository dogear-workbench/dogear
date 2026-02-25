'use client';

import { client } from '@/lib/client';
import { useBooks } from '@/lib/hooks';
import { BookCard } from './book-card';
import { Button } from '@/components/ui/button';
import { Plus, Activity } from 'lucide-react';
import { useState } from 'react';

export function BookList() {
  const { books, loading, error, deleteBook, reload } = useBooks();
  const [importing, setImporting] = useState(false);

  const handleImport = async () => {
    try {
      setImporting(true);
      const filePath = await client.selectFile();
      if (filePath) {
        await client.importBook({ filePath });
        reload();
      }
    } catch (error) {
      console.error('Import failed:', error);
      alert(`导入失败: ${(error as Error).message}`);
    } finally {
      setImporting(false);
    }
  };

  // 打开 Agent 监控窗口
  const handleOpenMonitor = async () => {
    try {
      await client.openMonitorWindow();
    } catch (error) {
      console.error('打开监控窗口失败:', error);
    }
  };

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
        <div className="flex gap-2">
          <Button onClick={handleOpenMonitor} variant="outline">
            <Activity className="w-4 h-4 mr-2" />
            Agent 监控
          </Button>
          <Button onClick={handleImport} disabled={importing}>
            <Plus className="w-4 h-4 mr-2" />
            {importing ? '导入中...' : '导入书籍'}
          </Button>
        </div>
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
