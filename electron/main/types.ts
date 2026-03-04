/**
 * Electron 主进程共享类型定义
 * 与 types/electron-api.ts 中的 WorkspaceFileNode 保持一致
 */

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
