/**
 * 书籍预处理服务
 * 负责导入、预处理和管理电子书
 *
 * v3: 使用 JSON 文件存储替代 SQLite
 * - 书籍元数据 → workspace/{bookId}/.dogear/meta.json
 * - 章节数据   → workspace/{bookId}/.dogear/chapters.json
 */
import electron from 'electron';
const { dialog } = electron;
import fs from 'fs';
import path from 'path';
import { safeJsonWrite } from './safe-json.js';
import { v4 as uuidv4 } from 'uuid';
import type { Book, Chapter, ChapterMetadata } from '../types.js';
import { ChapterRecognizer } from './chapter-recognizer.js';
import * as workspaceService from './workspace-service.js';
import * as workspaceJsonService from './workspace-json-service.js';

// 方便外部引用
export type { Book, Chapter, ChapterMetadata };

// ============================================================
// 内部 JSON 文件辅助函数
// ============================================================

/** 保存章节到 chapters.json */
async function saveChapters(workspacePath: string, bookId: string, chapters: Chapter[]): Promise<void> {
  const dogearDir = path.join(workspacePath, bookId, '.dogear');
  const chaptersPath = path.join(dogearDir, 'chapters.json');
  await safeJsonWrite(chaptersPath, { bookId, chapters });
}

/** 更新 meta.json — 读取已有数据，合并新字段，写回 */
async function updateMeta(bookId: string, data: Partial<Book>): Promise<void> {
  const workspace = await workspaceService.getCurrentWorkspace();
  if (!workspace) return;
  const existing = await workspaceService.loadBookMeta(workspace, bookId);
  const merged = { ...existing, ...data, updated_at: new Date().toISOString() };
  await workspaceService.saveBookMeta(workspace, bookId, merged);
}

// ============================================================
// 导出的查询函数
// ============================================================

/**
 * 根据 ID 获取书籍 — 读取 meta.json
 * @param bookId - 书籍 ID (UUID)
 */
export async function getBookById(bookId: string): Promise<Book | undefined> {
  const workspace = await workspaceService.getCurrentWorkspace();
  if (!workspace) return undefined;
  const meta = await workspaceService.loadBookMeta(workspace, bookId);
  return meta ? (meta as Book) : undefined;
}

/**
 * 获取当前（或指定）工作区的所有书籍 — 扫描子目录中的 meta.json
 * @param workspaceId - 工作区 ID（可选，默认当前工作区）
 */
export async function getAllBooks(workspaceId?: string): Promise<Book[]> {
  const workspace = workspaceId
    ? await workspaceJsonService.getById(workspaceId)
    : await workspaceService.getCurrentWorkspace();
  if (!workspace) return [];

  try {
    const entries = await fs.promises.readdir(workspace.path, { withFileTypes: true });
    const books: Book[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const meta = await workspaceService.loadBookMeta(workspace, entry.name);
      if (meta && meta.id) {
        books.push(meta as Book);
      }
    }
    return books.sort((a, b) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bTime - aTime;
    });
  } catch {
    return [];
  }
}

/**
 * 获取章节元数据（不含 content）— 从 chapters.json 读取
 * @param bookId - 书籍 ID (UUID)
 */
export async function getChapterMetadataFromFile(bookId: string): Promise<ChapterMetadata[]> {
  const workspace = await workspaceService.getCurrentWorkspace();
  if (!workspace) return [];
  const dogearDir = workspaceService.getDogearDir(workspace, bookId);
  const chaptersPath = path.join(dogearDir, 'chapters.json');
  try {
    const raw = await fs.promises.readFile(chaptersPath, 'utf-8');
    const data = JSON.parse(raw);
    return (data.chapters || []).map((ch: Chapter) => ({
      id: ch.id,
      book_id: ch.book_id,
      chapter_index: ch.chapter_index,
      title: ch.title,
      character_count: ch.character_count,
      preview_text: ch.preview_text,
    }));
  } catch {
    return [];
  }
}

/**
 * 获取完整章节（含 content）— 从 chapters.json 读取
 * @param chapterId - 章节 ID (UUID)
 * @param bookId - 书籍 ID（可选，提供时更高效）
 */
export async function getChapterFromFile(chapterId: string, bookId?: string): Promise<Chapter | undefined> {
  const workspace = await workspaceService.getCurrentWorkspace();
  if (!workspace) return undefined;

  if (bookId) {
    const dogearDir = workspaceService.getDogearDir(workspace, bookId);
    const chaptersPath = path.join(dogearDir, 'chapters.json');
    try {
      const raw = await fs.promises.readFile(chaptersPath, 'utf-8');
      const data = JSON.parse(raw);
      return (data.chapters || []).find((ch: Chapter) => ch.id === chapterId);
    } catch {
      return undefined;
    }
  }

  // 未提供 bookId 时，扫描所有书籍目录
  try {
    const entries = await fs.promises.readdir(workspace.path, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const dogearDir = workspaceService.getDogearDir(workspace, entry.name);
      const chaptersPath = path.join(dogearDir, 'chapters.json');
      try {
        const raw = await fs.promises.readFile(chaptersPath, 'utf-8');
        const data = JSON.parse(raw);
        const chapter = (data.chapters || []).find((ch: Chapter) => ch.id === chapterId);
        if (chapter) return chapter;
      } catch {
        continue;
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

/**
 * 更新书籍 meta.json 字段（公共接口，供 tipc/db.ts 使用）
 * @param bookId - 书籍 ID (UUID)
 * @param data - 要更新的字段
 */
export async function updateBookMeta(bookId: string, data: Partial<Book>): Promise<void> {
  await updateMeta(bookId, data);
}

/**
 * 删除书籍（移除其目录）
 * @param bookId - 书籍 ID (UUID)
 */
export async function deleteBook(bookId: string): Promise<void> {
  const workspace = await workspaceService.getCurrentWorkspace();
  if (!workspace) return;
  await workspaceService.deleteBookDir(workspace, bookId);
}

// ============================================================
// 文件选择
// ============================================================

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

// ============================================================
// 导入与预处理
// ============================================================

/**
 * 导入电子书文件
 * 创建 meta.json，复制文件到工作区，异步预处理
 * @param filePath - 电子书文件路径
 * @param workspaceId - 工作区 ID（可选，默认为 'default'）
 * @returns 返回导入的书籍信息
 */
export async function importBook(filePath: string, workspaceId?: string): Promise<Book> {
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath, ext);
  const stats = fs.statSync(filePath);

  const bookId = uuidv4();
  const now = new Date().toISOString();

  // 构建书籍对象
  const book: Book = {
    id: bookId,
    title: fileName,
    author: null,
    file_type: ext.slice(1),
    processing_status: 'pending',
    processing_progress: 0,
    total_chapters: 0,
    total_characters: 0,
    current_chapter_id: null,
    original_file_path: filePath,
    file_size: stats.size,
    cover_image: null,
    metadata: null,
    file_path: undefined,
    workspace_id: workspaceId || 'default',
    created_at: now,
    updated_at: now,
  };

  // 立即写入 meta.json（确保目录存在）
  const workspace = await workspaceService.getCurrentWorkspace();
  if (workspace) {
    await workspaceService.getOrCreateBookDir(workspace, bookId);
    await workspaceService.saveBookMeta(workspace, bookId, book);
  }

  // 异步复制文件到工作区
  copyFileToWorkspaceAsync(bookId, filePath).catch(error => {
    console.error(`复制文件到工作区失败: ${book.title}`, error);
  });

  // 异步开始预处理
  preprocessBook(bookId).catch(async error => {
    console.error(`预处理书籍失败: ${book.title}`, error);
    await updateMeta(bookId, {
      processing_status: 'failed',
      processing_progress: 0
    });
  });

  return book;
}

/**
 * 复制文件到工作区目录
 * @param bookId - 书籍 ID
 * @param sourcePath - 源文件路径
 */
async function copyFileToWorkspaceAsync(bookId: string, sourcePath: string): Promise<void> {
  try {
    const workspace = await workspaceService.getCurrentWorkspace();
    if (!workspace) {
      throw new Error('未设置默认工作区，请先选择工作区');
    }

    // 复制文件到工作区
    const relativePath = await workspaceService.copyBookToWorkspace(workspace, bookId, sourcePath);

    // 更新 meta.json 中的文件路径
    await updateMeta(bookId, { file_path: relativePath });
  } catch (error) {
    console.error('复制文件到工作区失败:', error);
    throw error;
  }
}

/**
 * 预处理书籍内容
 * @param bookId - 书籍 ID (UUID)
 */
async function preprocessBook(bookId: string): Promise<void> {
  try {
    const book = await getBookById(bookId);
    if (!book) throw new Error('书籍不存在');

    // 更新状态为处理中
    await updateProgress(bookId, 'processing', 10);

    // 根据文件类型处理
    if (book.file_type === 'txt') {
      await processTxtBook(book);
    } else if (book.file_type === 'epub') {
      await processEpubBook(book);
    } else if (book.file_type === 'pdf') {
      await processPdfBook(book);
    }

    // 标记处理完成
    await updateProgress(bookId, 'completed', 100);

  } catch (error) {
    console.error(`预处理失败:`, error);
    await updateProgress(bookId, 'failed', 0);
    throw error;
  }
}

/**
 * 处理 TXT 文件
 * @param book - 书籍对象
 */
async function processTxtBook(book: Book): Promise<void> {
  const workspace = await workspaceService.getCurrentWorkspace();
  if (!workspace) throw new Error('未设置默认工作区');

  // 读取文件内容
  const content = fs.readFileSync(book.original_file_path!, 'utf-8');
  await updateProgress(book.id!, 'processing', 30);

  // 识别章节
  const chapterRecognizer = new ChapterRecognizer();
  const chapterDataList = chapterRecognizer.recognize(content);
  await updateProgress(book.id!, 'processing', 60);

  // 转换为 Chapter 格式，每章生成 UUID
  const chapters: Chapter[] = chapterDataList.map(ch => ({
    id: uuidv4(),
    book_id: book.id!,
    chapter_index: ch.index,
    title: ch.title,
    content: ch.content,
    character_count: ch.characterCount,
    preview_text: ch.previewText
  }));

  // 保存章节到 chapters.json
  await saveChapters(workspace.path, book.id!, chapters);
  await updateProgress(book.id!, 'processing', 90);

  // 更新书籍统计信息
  const totalCharacters = chapters.reduce((sum, ch) => sum + ch.character_count, 0);
  await updateMeta(book.id!, {
    total_chapters: chapters.length,
    total_characters: totalCharacters,
  });
}

/**
 * 处理 EPUB 文件(暂时简化处理)
 * @param book - 书籍对象
 */
async function processEpubBook(book: Book): Promise<void> {
  const workspace = await workspaceService.getCurrentWorkspace();
  if (!workspace) throw new Error('未设置默认工作区');

  // TODO: 实现 EPUB 解析
  const chapters: Chapter[] = [{
    id: uuidv4(),
    book_id: book.id!,
    chapter_index: 1,
    title: book.title,
    content: 'EPUB解析功能待实现',
    character_count: 0,
    preview_text: ''
  }];

  await saveChapters(workspace.path, book.id!, chapters);

  await updateMeta(book.id!, {
    total_chapters: 1,
    total_characters: 0,
  });
}

/**
 * 处理 PDF 文件(暂时简化处理)
 * @param book - 书籍对象
 */
async function processPdfBook(book: Book): Promise<void> {
  const workspace = await workspaceService.getCurrentWorkspace();
  if (!workspace) throw new Error('未设置默认工作区');

  // TODO: 实现 PDF 解析
  const chapters: Chapter[] = [{
    id: uuidv4(),
    book_id: book.id!,
    chapter_index: 1,
    title: book.title,
    content: 'PDF解析功能待实现',
    character_count: 0,
    preview_text: ''
  }];

  await saveChapters(workspace.path, book.id!, chapters);

  await updateMeta(book.id!, {
    total_chapters: 1,
    total_characters: 0,
  });
}

/**
 * 更新处理进度
 * @param bookId - 书籍 ID (UUID)
 * @param status - 处理状态
 * @param progress - 进度值 0-100
 */
async function updateProgress(
  bookId: string,
  status: Book['processing_status'],
  progress: number
): Promise<void> {
  await updateMeta(bookId, {
    processing_status: status,
    processing_progress: progress
  });

  // TODO: 发送进度更新事件到渲染进程
}

// ============================================================
// 兼容导出（旧接口，现在改为 async）
// ============================================================

/**
 * 获取书籍的章节元数据列表(不含 content,用于目录导航)
 * @param bookId - 书籍 ID (UUID)
 * @returns 返回章节元数据数组
 */
export async function getChapterMetadata(bookId: string): Promise<ChapterMetadata[]> {
  return getChapterMetadataFromFile(bookId);
}

/**
 * 获取指定章节的完整内容(包含 content)
 * @param chapterId - 章节 ID (UUID)
 * @returns 返回完整章节对象
 */
export async function getChapter(chapterId: string): Promise<Chapter | undefined> {
  return getChapterFromFile(chapterId);
}

/**
 * 保存阅读进度
 * @param bookId - 书籍 ID (UUID)
 * @param chapterId - 当前章节 ID (UUID)
 */
export async function saveReadingProgress(bookId: string, chapterId: string): Promise<void> {
  await updateMeta(bookId, { current_chapter_id: chapterId });
}
