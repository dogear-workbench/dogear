/**
 * 记忆模块私有类型定义。
 *
 * 命名约定：内部一律 camelCase，markdown frontmatter 也用 camelCase
 * （与项目整体"内部 camelCase"约定对齐）。
 */

/** 主题记忆（对应 topics/<slug>.md 一个文件） */
export interface Topic {
  slug: string;
  title: string;
  keywords: string[];
  /** markdown 正文（不含 frontmatter） */
  content: string;
  /** ISO 8601 */
  created: string;
  /** ISO 8601 */
  updated: string;
  /** 里程碑 3 用，本阶段可空 */
  relatedTopics?: string[];
  /** 里程碑 2 用，本阶段可空 */
  sourceConversations?: string[];
}

/** index.json 中的单条主题元数据（不含正文） */
export interface TopicIndexEntry {
  slug: string;
  title: string;
  keywords: string[];
  updated: string;
}

/** index.json 完整结构 */
export interface MemoryIndex {
  version: 1;
  updated: string;
  topics: TopicIndexEntry[];
}

/** 核心档案 */
export interface CoreProfile {
  /** markdown 正文（不含 frontmatter） */
  content: string;
  updated: string;
}
