'use client';

import { useState, useEffect, useRef } from 'react';
import { Book, Chapter, ChapterMetadata } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ChevronLeft, ChevronRight, List, X } from 'lucide-react';
import Link from 'next/link';
import { electronBook } from '@/lib/electron';

interface ReaderProps {
  book: Book;
}

export function Reader({ book }: ReaderProps) {
  // 章节元数据列表(不含 content,数据量小,用于目录导航)
  const [chapterMetadata, setChapterMetadata] = useState<ChapterMetadata[]>([]);
  // 当前章节(包含完整 content)
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSidebar, setShowSidebar] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // 加载书籍的章节元数据列表(不含 content,数据量小)
  useEffect(() => {
    loadChapterMetadata();
  }, [book.id]);

  // 加载当前章节
  useEffect(() => {
    if (chapterMetadata.length > 0) {
      const initialChapterId = book.current_chapter_id || chapterMetadata[0].id;
      if (initialChapterId) {
        loadChapter(initialChapterId);
      }
    }
  }, [chapterMetadata, book.current_chapter_id]);

  // 保存阅读进度
  useEffect(() => {
    if (currentChapter && book.id) {
      electronBook.saveProgress(book.id!, currentChapter.id!);
    }
  }, [currentChapter]);

  // 打开侧边栏时自动定位到当前章节
  useEffect(() => {
    if (showSidebar && sidebarRef.current && currentChapter?.id) {
      // 找到当前章节的按钮元素
      const currentChapterButton = sidebarRef.current.querySelector(
        `[data-chapter-id="${currentChapter.id}"]`
      ) as HTMLElement;

      if (currentChapterButton) {
        // 获取容器高度
        const containerHeight = sidebarRef.current.clientHeight;
        // 获取当前章节按钮距离顶部的偏移量
        const chapterOffset = currentChapterButton.offsetTop;
        // 计算滚动位置,使当前章节显示在容器中间
        const scrollPosition = chapterOffset - containerHeight / 2;

        sidebarRef.current.scrollTop = Math.max(0, scrollPosition);
      }
    }
  }, [showSidebar, currentChapter]);

  /**
   * 加载书籍的章节元数据列表(不含 content)
   */
  const loadChapterMetadata = async () => {
    try {
      setLoading(true);
      const metadataList = await electronBook.getChapterMetadata(book.id!);
      setChapterMetadata(metadataList);
    } catch (error) {
      console.error('加载章节列表失败:', error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * 加载指定章节的完整内容(包含 content)
   */
  const loadChapter = async (chapterId: string) => {
    try {
      setLoading(true);
      const chapter = await electronBook.getChapter(chapterId);
      setCurrentChapter(chapter);
      // 滚动到顶部
      if (contentRef.current) {
        contentRef.current.scrollTop = 0;
      }
      // 关闭侧边栏
      setShowSidebar(false);
    } catch (error) {
      console.error('加载章节失败:', error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * 跳转到下一章(前端直接从元数据数组获取,无需后端查询)
   */
  const nextChapter = async () => {
    if (!currentChapter?.id) return;

    // 在元数据数组中找到当前章节的索引
    const currentIndex = chapterMetadata.findIndex(ch => ch.id === currentChapter.id);
    const nextMetadata = chapterMetadata[currentIndex + 1];

    if (nextMetadata) {
      // 只加载这一章的完整内容
      await loadChapter(nextMetadata.id);
    }
  };

  /**
   * 跳转到上一章(前端直接从元数据数组获取,无需后端查询)
   */
  const prevChapter = async () => {
    if (!currentChapter?.id) return;

    // 在元数据数组中找到当前章节的索引
    const currentIndex = chapterMetadata.findIndex(ch => ch.id === currentChapter.id);
    const prevMetadata = chapterMetadata[currentIndex - 1];

    if (prevMetadata) {
      // 只加载这一章的完整内容
      await loadChapter(prevMetadata.id);
    }
  };

  /**
   * 判断是否为第一/最后一章
   */
  const currentIndex = chapterMetadata.findIndex(ch => ch.id === currentChapter?.id);
  const isFirstChapter = currentIndex <= 0;
  const isLastChapter = currentIndex >= chapterMetadata.length - 1;

  // 显示处理状态
  if (book.processing_status === 'processing') {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="text-lg font-semibold">正在处理书籍...</div>
          <div className="text-sm text-muted-foreground">
            {book.processing_progress || 0}%
          </div>
          <div className="w-64 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${book.processing_progress || 0}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  if (book.processing_status === 'failed') {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="text-lg font-semibold text-destructive">处理失败</div>
          <div className="text-sm text-muted-foreground">
            书籍处理过程中出现错误,请重试
          </div>
          <Link href="/">
            <Button>返回首页</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* 顶部导航栏 */}
      <header className="border-b px-4 py-2 flex items-center justify-between bg-background">
        <div className="flex items-center gap-2">
          <Link href="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowSidebar(!showSidebar)}
          >
            {showSidebar ? <X className="w-5 h-5" /> : <List className="w-5 h-5" />}
          </Button>
        </div>
        <h1 className="text-lg font-semibold truncate flex-1 mx-4">{book.title}</h1>
        <div className="text-sm text-muted-foreground">
          {currentChapter ? (
            <>
              {currentIndex + 1} / {chapterMetadata.length} 章
            </>
          ) : (
            '加载中...'
          )}
        </div>
      </header>

      {/* 主内容区域 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 章节列表侧边栏 */}
        {showSidebar && (
          <aside
            ref={sidebarRef}
            className="w-64 border-r overflow-y-auto bg-muted/30"
          >
            <div className="p-4">
              <h2 className="text-sm font-semibold mb-2">章节目录</h2>
              <div className="space-y-1">
                {chapterMetadata.map((chapter) => (
                  <button
                    key={chapter.id}
                    data-chapter-id={chapter.id}
                    onClick={() => loadChapter(chapter.id)}
                    className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                      currentChapter?.id === chapter.id
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted'
                    }`}
                  >
                    {chapter.title}
                  </button>
                ))}
              </div>
            </div>
          </aside>
        )}

        {/* 阅读内容区域 */}
        <div
          ref={contentRef}
          className="flex-1 overflow-y-auto p-8"
        >
          <div className="max-w-3xl mx-auto">
            {loading ? (
              <div className="text-center py-8">加载中...</div>
            ) : currentChapter ? (
              <div className="prose prose-lg dark:prose-invert max-w-none">
                <div className="whitespace-pre-wrap leading-relaxed">
                  {currentChapter.content}
                </div>
              </div>
            ) : chapterMetadata.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                暂无章节内容
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* 底部导航栏 */}
      <footer className="border-t px-4 py-3 flex justify-center gap-4 bg-background">
        <Button
          onClick={prevChapter}
          disabled={isFirstChapter || !currentChapter}
          variant="outline"
        >
          <ChevronLeft className="w-4 h-4 mr-2" />
          上一章
        </Button>
        <Button
          onClick={nextChapter}
          disabled={isLastChapter || !currentChapter}
          variant="outline"
        >
          下一章
          <ChevronRight className="w-4 h-4 ml-2" />
        </Button>
      </footer>
    </div>
  );
}
