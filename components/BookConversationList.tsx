'use client';

import { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, FolderOpen, MessageSquare, Plus, Trash2, GitBranch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Book } from '@/types';

/**
 * 对话接口（前端版本）
 */
export interface Conversation {
  id: string;
  book_id: string;
  title: string;
  model: string;
  sdk_session_id?: string;
  parent_conversation_id?: string;   // 分叉对话的父对话 ID（v4）
  fork_message_sdk_uuid?: string;    // 分叉点的 assistant 消息 UUID（v4）
  created_at: number;
  updated_at: number;
}

/**
 * 图书节点接口（扩展 WorkspaceFileNode）
 */
export interface BookNode {
  book: Book;
  conversations: Conversation[];
  expanded?: boolean;
}

interface BookConversationListProps {
  /** 图书节点列表 */
  books: BookNode[];
  /** 当前选中的对话ID */
  selectedConversationId?: string | null;
  /** 选择对话回调 */
  onConversationSelect?: (conversation: Conversation) => void;
  /** 新增对话回调 */
  onNewConversation?: (bookId: string) => void;
  /** 删除对话回调 */
  onDeleteConversation?: (conversationId: string) => void;
  /** 加载中状态 */
  loading?: boolean;
  /** 切换展开状态回调（v4: 解决新增对话后收缩问题） */
  onToggleExpand?: (bookId: string) => void;
}

interface BookTreeNodeProps {
  bookNode: BookNode;
  selectedConversationId?: string | null;
  onConversationSelect?: (conversation: Conversation) => void;
  onNewConversation?: (bookId: string) => void;
  onDeleteConversation?: (conversationId: string) => void;
  onToggleExpand?: (bookId: string) => void;
  level?: number;
}

/**
 * 图书树节点组件
 * 展示单个图书及其对话列表
 */
function BookTreeNode({
  bookNode,
  selectedConversationId,
  onConversationSelect,
  onNewConversation,
  onDeleteConversation,
  onToggleExpand,
  level = 0
}: BookTreeNodeProps) {
  const { book, conversations, expanded = false } = bookNode;
  const isBookSelected = expanded;

  // 生成对话标题（基于时间或第一条消息）
  const getConversationTitle = (conversation: Conversation) => {
    // 如果有自定义标题则使用
    if (conversation.title && conversation.title !== '新对话') {
      return conversation.title;
    }
    // 否则使用时间
    const date = new Date(conversation.created_at);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return `对话 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    }
    return `对话 ${date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}`;
  };

  const handleBookClick = () => {
    if (onToggleExpand) {
      onToggleExpand(book.id!);
    }
  };

  const handleNewConversation = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onNewConversation) {
      onNewConversation(book.id!);
    }
  };

  const handleConversationClick = (conversation: Conversation) => {
    if (onConversationSelect) {
      onConversationSelect(conversation);
    }
  };

  const handleDeleteConversation = (conversationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDeleteConversation) {
      onDeleteConversation(conversationId);
    }
  };

  return (
    <div className="w-full">
      {/* 图书标题行 */}
      <div
        className={`flex items-center gap-2 py-2 px-3 rounded cursor-pointer transition-colors ${
          isBookSelected ? 'bg-muted/70' : 'hover:bg-muted/30'
        }`}
        style={{ paddingLeft: `${level * 16 + 12}px` }}
        onClick={handleBookClick}
      >
        <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
          {expanded ? (
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3 h-3 text-muted-foreground" />
          )}
        </span>
        {expanded ? (
          <FolderOpen className="w-4 h-4 text-blue-500 flex-shrink-0" />
        ) : (
          <FolderOpen className="w-4 h-4 text-blue-400 flex-shrink-0" />
        )}
        <span className="text-sm font-medium truncate flex-1">{book.title}</span>
        <span className="text-xs text-muted-foreground">
          {conversations.length}
        </span>
      </div>

      {/* 展开内容：新增对话按钮 + 对话列表 */}
      {expanded && (
        <div className="space-y-1">
          {/* 新增对话按钮 */}
          <div
            className="flex items-center gap-2 py-1.5 px-3 hover:bg-muted/20 transition-colors cursor-pointer group"
            style={{ paddingLeft: `${level * 16 + 32}px` }}
            onClick={handleNewConversation}
          >
            <Plus className="w-3.5 h-3.5 text-muted-foreground group-hover:text-blue-500 transition-colors" />
            <span className="text-sm text-muted-foreground group-hover:text-blue-600 transition-colors">
              新增对话
            </span>
          </div>

          {/* 对话列表 */}
          {conversations.length === 0 ? (
            <div
              className="py-2 px-3 text-xs text-muted-foreground"
              style={{ paddingLeft: `${level * 16 + 32}px` }}
            >
              暂无对话，点击上方按钮创建
            </div>
          ) : (
            conversations.map((conversation) => {
              const isSelected = selectedConversationId === conversation.id;
              return (
                <div
                  key={conversation.id}
                  className={`flex items-center gap-2 py-1.5 px-3 rounded cursor-pointer transition-colors group ${
                    isSelected ? 'bg-blue-100 dark:bg-blue-900/30' : 'hover:bg-muted/20'
                  }`}
                  style={{ paddingLeft: `${level * 16 + 32}px` }}
                  onClick={() => handleConversationClick(conversation)}
                >
                  {/* v4: 分叉对话使用 GitBranch 图标 */}
                  {conversation.parent_conversation_id ? (
                    <GitBranch className={`w-3.5 h-3.5 flex-shrink-0 ${
                      isSelected ? 'text-purple-600' : 'text-purple-400'
                    }`} />
                  ) : (
                    <MessageSquare className={`w-3.5 h-3.5 flex-shrink-0 ${
                      isSelected ? 'text-blue-600' : 'text-muted-foreground'
                    }`} />
                  )}
                  <span className={`text-sm flex-1 truncate ${
                    isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-foreground'
                  }`}>
                    {getConversationTitle(conversation)}
                  </span>
                  {/* 删除按钮 */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                    onClick={(e) => handleDeleteConversation(conversation.id, e)}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 图书对话列表组件
 * 以文件夹形式展示图书，每本书下面有新增对话按钮和对话列表
 */
export function BookConversationList({
  books,
  selectedConversationId,
  onConversationSelect,
  onNewConversation,
  onDeleteConversation,
  loading,
  onToggleExpand
}: BookConversationListProps) {
  console.log('📚 BookConversationList 渲染:', { booksLength: books.length, loading });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm">加载中...</p>
      </div>
    );
  }

  if (books.length === 0) {
    console.log('⚠️ 书籍列表为空');
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <FolderOpen className="w-12 h-12 mb-4 opacity-50" />
        <p className="text-sm">暂无书籍</p>
        <p className="text-xs mt-1">导入书籍后开始对话</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {books.map((bookNode) => (
        <BookTreeNode
          key={bookNode.book.id}
          bookNode={bookNode}
          selectedConversationId={selectedConversationId}
          onConversationSelect={onConversationSelect}
          onNewConversation={onNewConversation}
          onDeleteConversation={onDeleteConversation}
          onToggleExpand={onToggleExpand}
        />
      ))}
    </div>
  );
}
