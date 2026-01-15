/**
 * 书籍预处理服务
 * 负责导入、预处理和管理电子书
 */
import { dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import { dbBooks, dbChapters, Book, Chapter, ChapterMetadata } from '../database/index.js';
import { ChapterRecognizer } from './chapter-recognizer.js';

/**
 * 打开文件选择对话框,让用户选择电子书文件
 * @returns 返回选中的文件路径,如果取消则返回 null
 */
export async function selectBookFile(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: '电子书', extensions: ['epub', 'txt', 'pdf'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
}

/**
 * 导入电子书文件到数据库
 * 根据文件类型调用不同的解析器提取元数据
 * @param filePath - 电子书文件路径
 * @returns 返回导入的书籍信息
 */
export async function importBook(filePath: string): Promise<Book> {
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath, ext);
  const stats = fs.statSync(filePath);

  // 创建书籍记录
  const bookData: Omit<Book, 'id'> = {
    title: fileName,
    author: null,  // 作者信息（目前为空）
    file_type: ext.slice(1), // 去掉扩展名的点号
    processing_status: 'pending',
    processing_progress: 0,
    total_chapters: 0,
    total_characters: 0,
    current_chapter_id: null,  // 明确使用 null 而不是 undefined
    original_file_path: filePath,
    file_size: stats.size,
    cover_image: null,  // 明确使用 null 而不是 undefined
    metadata: null  // 明确使用 null 而不是 undefined
    // 注意：created_at 和 updated_at 由数据库自动生成，不需要手动设置
  };

  const bookId = dbBooks.add(bookData as Book);
  const book = dbBooks.getById(bookId)!;

  // 异步开始预处理
  preprocessBook(bookId).catch(error => {
    console.error(`预处理书籍失败: ${book.title}`, error);
    dbBooks.update(bookId, {
      processing_status: 'failed',
      processing_progress: 0
    });
  });

  return book;
}

/**
 * 预处理书籍内容
 * @param bookId - 书籍ID (UUID)
 */
async function preprocessBook(bookId: string): Promise<void> {
  try {
    const book = dbBooks.getById(bookId);
    if (!book) throw new Error('书籍不存在');

    // 更新状态为处理中
    updateProgress(bookId, 'processing', 10);

    // 根据文件类型处理
    if (book.file_type === 'txt') {
      await processTxtBook(book);
    } else if (book.file_type === 'epub') {
      await processEpubBook(book);
    } else if (book.file_type === 'pdf') {
      await processPdfBook(book);
    }

    // 标记处理完成
    updateProgress(bookId, 'completed', 100);

  } catch (error) {
    console.error(`预处理失败:`, error);
    updateProgress(bookId, 'failed', 0);
    throw error;
  }
}

/**
 * 处理TXT文件
 * @param book - 书籍对象
 */
async function processTxtBook(book: Book): Promise<void> {
  // 读取文件内容
  const content = fs.readFileSync(book.original_file_path!, 'utf-8');
  updateProgress(book.id!, 'processing', 30);

  // 识别章节
  const chapterRecognizer = new ChapterRecognizer();
  const chapterDataList = chapterRecognizer.recognize(content);
  updateProgress(book.id!, 'processing', 60);

  // 转换为数据库格式
  const chapters: Omit<Chapter, 'id' | 'created_at'>[] = chapterDataList.map(ch => ({
    book_id: book.id!,
    chapter_index: ch.index,
    title: ch.title,
    content: ch.content,
    character_count: ch.characterCount,
    preview_text: ch.previewText
  }));

  // 批量插入章节
  dbChapters.bulkInsert(chapters);
  updateProgress(book.id!, 'processing', 90);

  // 更新书籍统计信息
  const totalCharacters = chapters.reduce((sum, ch) => sum + ch.character_count, 0)
  dbBooks.update(book.id!, {
    total_chapters: chapters.length,
    total_characters: totalCharacters,
  });
}

/**
 * 处理EPUB文件(暂时简化处理)
 * @param book - 书籍对象
 */
async function processEpubBook(book: Book): Promise<void> {
  // TODO: 实现EPUB解析
  // 目前先作为单章节处理
  const chapters: Omit<Chapter, 'id' | 'created_at'>[] = [{
    book_id: book.id!,
    chapter_index: 1,
    title: book.title,
    content: 'EPUB解析功能待实现',
    character_count: 0,
    preview_text: ''
  }];

  dbChapters.bulkInsert(chapters);

  dbBooks.update(book.id!, {
    total_chapters: 1,
    total_characters: 0,
  });
}

/**
 * 处理PDF文件(暂时简化处理)
 * @param book - 书籍对象
 */
async function processPdfBook(book: Book): Promise<void> {
  // TODO: 实现PDF解析
  const chapters: Omit<Chapter, 'id' | 'created_at'>[] = [{
    book_id: book.id!,
    chapter_index: 1,
    title: book.title,
    content: 'PDF解析功能待实现',
    character_count: 0,
    preview_text: ''
  }];

  dbChapters.bulkInsert(chapters);

  dbBooks.update(book.id!, {
    total_chapters: 1,
    total_characters: 0,
  });
}

/**
 * 更新处理进度
 * @param bookId - 书籍ID (UUID)
 * @param status - 处理状态
 * @param progress - 进度值 0-100
 */
function updateProgress(
  bookId: string,
  status: Book['processing_status'],
  progress: number
): void {
  dbBooks.update(bookId, {
    processing_status: status,
    processing_progress: progress
  });

  // TODO: 发送进度更新事件到渲染进程
  // 需要在main.ts中注册IPC通信后实现
}

/**
 * 获取书籍的章节元数据列表(不含 content,用于目录导航)
 * @param bookId - 书籍ID (UUID)
 * @returns 返回章节元数据数组
 */
export function getChapterMetadata(bookId: string): ChapterMetadata[] {
  return dbChapters.getChapterMetadata(bookId);
}

/**
 * 获取指定章节的完整内容(包含 content)
 * @param chapterId - 章节ID (UUID)
 * @returns 返回完整章节对象
 */
export function getChapter(chapterId: string): Chapter | undefined {
  return dbChapters.getById(chapterId);
}

/**
 * 保存阅读进度
 * @param bookId - 书籍ID (UUID)
 * @param chapterId - 当前章节ID (UUID)
 */
export function saveReadingProgress(bookId: string, chapterId: string): void {
  dbBooks.update(bookId, { current_chapter_id: chapterId });
}
