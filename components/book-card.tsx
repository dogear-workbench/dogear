'use client';

import { Book } from '@/lib/types';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BookOpen, Trash2 } from 'lucide-react';
import Link from 'next/link';

interface BookCardProps {
  book: Book;
  onDelete?: (id: number) => void;
}

export function BookCard({ book, onDelete }: BookCardProps) {
  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <CardTitle className="flex items-start justify-between">
          <span className="line-clamp-2">{book.title}</span>
        </CardTitle>
        {book.author && (
          <p className="text-sm text-muted-foreground">{book.author}</p>
        )}
      </CardHeader>
      <CardContent>
        <div className="aspect-[3/4] bg-muted rounded-md flex items-center justify-center">
          {book.cover_image ? (
            <img
              src={book.cover_image}
              alt={book.title}
              className="w-full h-full object-cover rounded-md"
            />
          ) : (
            <BookOpen className="w-16 h-16 text-muted-foreground" />
          )}
        </div>
      </CardContent>
      <CardFooter className="flex justify-between">
        <Link href={`/book/${book.id}`}>
          <Button variant="default">
            <BookOpen className="w-4 h-4 mr-2" />
            阅读
          </Button>
        </Link>
        {onDelete && (
          <Button
            variant="destructive"
            size="icon"
            onClick={() => book.id && onDelete(book.id)}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
