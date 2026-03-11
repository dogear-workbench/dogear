import { useParams, Navigate } from 'react-router';
import { useBook } from '@/lib/hooks';
import { Reader } from '@/components/reader';

export default function BookPage() {
  const { id } = useParams<{ id: string }>();
  const { book, loading, error } = useBook(id!);

  if (loading) {
    return <div className="text-center py-8">加载中...</div>;
  }

  if (error || !book) {
    return <Navigate to="/" replace />;
  }

  return <Reader book={book} />;
}
