/**
 * Electron 主进程共享类型定义
 * 与 types/ 目录下的类型保持一致
 */

// ============================================================
// 书籍类型（镜像自 types/books.ts，因 rootDir 限制无法跨目录导入）
// ============================================================

/** 书籍数据接口 */
export interface Book {
  id?: string;
  title: string;
  author: string | null;
  file_type: string;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
  processing_progress: number;
  current_chapter_id: string | null;
  total_chapters: number;
  total_characters: number;
  original_file_path: string | null;
  file_size: number | null;
  workspace_id?: string;
  file_path?: string;
  analysis_status?: 'none' | 'analyzing' | 'analyzed' | 'failed';
  analyzed_at?: number | null;
  cover_image: string | null;
  metadata: string | null;
  created_at?: string;
  updated_at?: string;
}

/** 章节数据接口 */
export interface Chapter {
  id?: string;
  book_id: string;
  chapter_index: number;
  title: string;
  content: string;
  character_count: number;
  preview_text: string;
  created_at?: string;
}

/** 章节元数据接口(不含 content) */
export interface ChapterMetadata {
  id: string;
  book_id: string;
  chapter_index: number;
  title: string;
  character_count: number;
  preview_text: string;
}

/**
 * 工作区文件节点
 */
export interface WorkspaceFileNode {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'article';
  ext?: string;
  children?: WorkspaceFileNode[];
  /** 书籍 ID（type='file' 且为已导入书籍时存在） */
  bookId?: string;
  /** 文章专属字段（type='article' 时存在） */
  articleMeta?: {
    id: string;
    url: string;
    siteName: string | null;
    fetchedAt: number;
    wordCount: number;
  };
}
