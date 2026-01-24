'use client';

import { useState } from 'react';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen } from 'lucide-react';
import type { WorkspaceFileNode } from '@/types/electron-api';

interface FileTreeProps {
  files: WorkspaceFileNode[];
  onFileSelect?: (file: WorkspaceFileNode) => void;
  selectedFile?: string | null;
}

interface FileTreeNodeProps {
  node: WorkspaceFileNode;
  level?: number;
  onFileSelect?: (file: WorkspaceFileNode) => void;
  selectedFile?: string | null;
}

function FileTreeNode({ node, level = 0, onFileSelect, selectedFile }: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(level === 0);

  const isDirectory = node.type === 'directory';
  const isSelected = selectedFile === node.path;

  const handleClick = () => {
    if (isDirectory) {
      setExpanded(!expanded);
    } else if (onFileSelect) {
      onFileSelect(node);
    }
  };

  const getFileIcon = () => {
    if (isDirectory) {
      return expanded ? (
        <FolderOpen className="w-4 h-4 text-blue-400" />
      ) : (
        <Folder className="w-4 h-4 text-blue-400" />
      );
    }
    return <File className="w-4 h-4 text-muted-foreground" />;
  };

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1 px-2 rounded cursor-pointer transition-colors ${
          isSelected ? 'bg-primary/20' : 'hover:bg-muted/50'
        }`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleClick}
      >
        {isDirectory && (
          <span className="w-4 h-4 flex items-center justify-center">
            {expanded ? (
              <ChevronDown className="w-3 h-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-3 h-3 text-muted-foreground" />
            )}
          </span>
        )}
        {getFileIcon()}
        <span className="text-sm truncate">{node.name}</span>
      </div>
      {isDirectory && expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              level={level + 1}
              onFileSelect={onFileSelect}
              selectedFile={selectedFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({ files, onFileSelect, selectedFile }: FileTreeProps) {
  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Folder className="w-12 h-12 mb-4 opacity-50" />
        <p className="text-sm">暂无书籍</p>
        <p className="text-xs mt-1">点击右上角"导入书籍"添加</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {files.map((file) => (
        <FileTreeNode
          key={file.path}
          node={file}
          onFileSelect={onFileSelect}
          selectedFile={selectedFile}
        />
      ))}
    </div>
  );
}
