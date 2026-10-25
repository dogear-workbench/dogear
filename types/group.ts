export interface Group {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  /** 后台活动时钟（子会话创建/交付、会话完成等）：只喂养 auto-archive 保鲜，不参与列表排序 */
  lastBackgroundActivityAt?: number;
  archivedAt?: number;
  /** 承载话题（任务运行等后台会话）：活跃态但不在话题列表显示，归档页也不过滤 */
  hidden?: boolean;
}

export interface NativeFileEntry {
  relPath: string;
  size: number;
  mtime: number;
}
