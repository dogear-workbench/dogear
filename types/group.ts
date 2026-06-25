export interface SharedReferenceBase {
  id: string;
  addedAt: number;
  label?: string;
}

export type SharedReference =
  | (SharedReferenceBase & { type: 'file'; path: string })
  | (SharedReferenceBase & { type: 'conversation'; conversationId: string })
  | (SharedReferenceBase & { type: 'article'; articleId: string });

export interface Group {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  sharedReferences: SharedReference[];
}

export interface NativeFileEntry {
  relPath: string;
  size: number;
  mtime: number;
}
