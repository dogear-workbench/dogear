export interface Group {
  id: string;
  title?: string;
  autoTitle?: boolean;
  createdAt: number;
  updatedAt: number;
  /** 后台活动时钟（子会话创建/交付、会话完成等）：只喂养 auto-archive 保鲜，不参与列表排序 */
  lastBackgroundActivityAt?: number;
  archivedAt?: number;
}

export interface NativeFileEntry {
  relPath: string;
  size: number;
  mtime: number;
}
