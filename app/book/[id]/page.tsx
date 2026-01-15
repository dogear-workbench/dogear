'use client';

import React from 'react';
import { useBook } from '@/lib/hooks';
import { Reader } from '@/components/reader';
import { notFound } from 'next/navigation';

interface BookPageProps {
  params: Promise<{ id: string }>;
}

export default function BookPage({ params }: BookPageProps) {
  const { id } = React.use(params);
  const { book, loading, error } = useBook(id);

  if (loading) {
    return <div className="text-center py-8">加载中...</div>;
  }

  if (error || !book) {
    return notFound();
  }

  return <Reader book={book} />;
}
