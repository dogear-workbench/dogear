'use client';

import { useBook } from '@/lib/hooks';
import { Reader } from '@/components/reader';
import { notFound } from 'next/navigation';

interface BookPageProps {
  params: { id: string };
}

export default function BookPage({ params }: BookPageProps) {
  const bookId = parseInt(params.id);
  const { book, loading, error } = useBook(bookId);

  if (loading) {
    return <div className="text-center py-8">加载中...</div>;
  }

  if (error || !book) {
    return notFound();
  }

  return <Reader book={book} />;
}
