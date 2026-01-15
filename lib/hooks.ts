'use client';

import { useState, useEffect } from 'react';
import { Book } from './types';
import { electronDB } from './electron';

/**
 * 书籍列表 Hook
 * 管理书籍列表的数据加载、添加和删除操作
 * @returns 返回书籍列表状态、加载状态、错误信息和操作方法
 */
export function useBooks() {
  // 书籍列表状态
  const [books, setBooks] = useState<Book[]>([]);
  // 加载状态
  const [loading, setLoading] = useState(true);
  // 错误状态
  const [error, setError] = useState<Error | null>(null);

  // 组件挂载时加载书籍列表
  useEffect(() => {
    loadBooks();
  }, []);

  /**
   * 加载书籍列表
   * 从 Electron 数据库获取所有书籍并更新状态
   */
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

  /**
   * 添加新书籍
   * @param book - 要添加的书籍对象
   * @returns 返回新创建书籍的 ID (UUID)
   */
  const addBook = async (book: Book) => {
    const id = await electronDB.addBook(book);
    // 添加成功后重新加载列表
    await loadBooks();
    return id;
  };

  /**
   * 删除书籍
   * @param id - 要删除的书籍 ID (UUID)
   */
  const deleteBook = async (id: string) => {
    await electronDB.deleteBook(id);
    // 删除成功后重新加载列表
    await loadBooks();
  };

  // 返回状态和操作方法
  return { books, loading, error, addBook, deleteBook, reload: loadBooks };
}

/**
 * 单本书籍 Hook
 * 管理单本书籍的数据加载和更新操作
 * @param id - 书籍 ID (UUID)
 * @returns 返回书籍数据、加载状态、错误信息和更新方法
 */
export function useBook(id: string) {
  // 书籍数据状态
  const [book, setBook] = useState<Book | null>(null);
  // 加载状态
  const [loading, setLoading] = useState(true);
  // 错误状态
  const [error, setError] = useState<Error | null>(null);

  // 当 id 变化时重新加载书籍数据
  useEffect(() => {
    loadBook();
  }, [id]);

  /**
   * 加载书籍数据
   * 从 Electron 数据库获取指定 ID 的书籍信息
   */
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

  /**
   * 更新书籍信息
   * @param data - 包含更新字段的对象
   */
  const updateBook = async (data: Partial<Book>) => {
    if (book?.id) {
      await electronDB.updateBook(book.id, data);
      // 更新成功后重新加载数据
      await loadBook();
    }
  };

  // 返回状态和更新方法
  return { book, loading, error, updateBook };
}
