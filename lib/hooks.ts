'use client';

import { useState, useEffect } from 'react';
import { Book } from './types';
import { electronDB } from './electron';

export function useBooks() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    loadBooks();
  }, []);

  const loadBooks = async () => {
    try {
      setLoading(true);
      const data = await electronDB.getBooks();
      setBooks(data);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  };

  const addBook = async (book: Book) => {
    const id = await electronDB.addBook(book);
    await loadBooks();
    return id;
  };

  const deleteBook = async (id: number) => {
    await electronDB.deleteBook(id);
    await loadBooks();
  };

  return { books, loading, error, addBook, deleteBook, reload: loadBooks };
}

export function useBook(id: number) {
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    loadBook();
  }, [id]);

  const loadBook = async () => {
    try {
      setLoading(true);
      const data = await electronDB.getBookById(id);
      setBook(data);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  };

  const updateBook = async (data: Partial<Book>) => {
    if (book?.id) {
      await electronDB.updateBook(book.id, data);
      await loadBook();
    }
  };

  return { book, loading, error, updateBook };
}
