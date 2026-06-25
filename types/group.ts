export interface Group {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
}

export interface NativeFileEntry {
  relPath: string;
  size: number;
  mtime: number;
}
