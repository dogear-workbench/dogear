'use client';

import { MessageSquare, Plus, Trash2, GitBranch } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * 对话接口（v5: 对话直接属于工作区，book_id 可选）
 */
export interface Conversation {
  id: string;
  book_id?: string;                  // 可选：关联的书籍ID
  workspace_id: string;              // 关联的工作区ID
  title: string;
  model: string;
  sdk_session_id?: string;
  parent_conversation_id?: string;   // 分叉对话的父对话 ID（v4）
  fork_message_sdk_uuid?: string;    // 分叉点的 assistant 消息 UUID（v4）
  created_at: number;
  updated_at: number;
}

// 保留 BookNode 导出以兼容可能的外部引用
export interface BookNode {
  book: { id?: string; title: string };
  conversations: Conversation[];
  expanded?: boolean;
}

interface ConversationListProps {
  /** 对话列表（按 updated_at 倒序） */
  conversations: Conversation[];
  /** 当前选中的对话ID */
  selectedConversationId?: string | null;
  /** 选择对话回调 */
  onConversationSelect?: (conversation: Conversation) => void;
  /** 新增对话回调（不再需要 bookId） */
  onNewConversation?: () => void;
  /** 删除对话回调 */
  onDeleteConversation?: (conversationId: string) => void;
  /** 加载中状态 */
  loading?: boolean;
}

/**
 * 获取相对时间文本
 */
function getRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;

  const date = new Date(timestamp);
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

/**
 * 获取对话显示标题
 */
function getConversationTitle(conversation: Conversation): string {
  if (conversation.title && conversation.title !== '新对话') {
    return conversation.title;
  }
  const date = new Date(conversation.created_at);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return `对话 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  }
  return `对话 ${date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}`;
}

/**
 * 对话列表组件（v5: 平铺列表，替代原来的 BookConversationList 树形结构）
 */
export function ConversationList({
  conversations,
  selectedConversationId,
  onConversationSelect,
  onNewConversation,
  onDeleteConversation,
  loading,
}: ConversationListProps) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm">加载中...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* 新建对话按钮 */}
      <div className="px-3 py-2 border-b">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => onNewConversation?.()}
        >
          <Plus className="w-4 h-4" />
          新建对话
        </Button>
      </div>

      {/* 对话列表 */}
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <MessageSquare className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-sm">暂无对话</p>
            <p className="text-xs mt-1">点击上方按钮开始</p>
          </div>
        ) : (
          <div className="py-1">
            {conversations.map((conversation) => {
              const isSelected = selectedConversationId === conversation.id;
              const isFork = !!conversation.parent_conversation_id;

              return (
                <div
                  key={conversation.id}
                  className={`flex items-center gap-2 py-2 px-3 mx-1 rounded cursor-pointer transition-colors group ${
                    isSelected ? 'bg-blue-100 dark:bg-blue-900/30' : 'hover:bg-muted/30'
                  }`}
                  onClick={() => onConversationSelect?.(conversation)}
                >
                  {/* 图标：分叉对话用 GitBranch，普通对话用 MessageSquare */}
                  {isFork ? (
                    <GitBranch className={`w-4 h-4 flex-shrink-0 ${
                      isSelected ? 'text-purple-600' : 'text-purple-400'
                    }`} />
                  ) : (
                    <MessageSquare className={`w-4 h-4 flex-shrink-0 ${
                      isSelected ? 'text-blue-600' : 'text-muted-foreground'
                    }`} />
                  )}

                  {/* 标题和时间 */}
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm truncate ${
                      isSelected ? 'text-blue-700 dark:text-blue-300 font-medium' : 'text-foreground'
                    }`}>
                      {getConversationTitle(conversation)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {getRelativeTime(conversation.updated_at)}
                    </div>
                  </div>

                  {/* 删除按钮 */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteConversation?.(conversation.id);
                    }}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// 保留旧名导出以兼容
export const BookConversationList = ConversationList;
