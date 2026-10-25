/**
 * 数据中心记忆面板内部数据类型（轻量 interface，不镜像到 types/electron-api.ts）
 *
 * 原则：只在数据中心记忆面板内部使用；如其他渲染层文件需要 Topic，
 * 再考虑镜像到全局类型文件。
 */
/** 记忆作用域：workspace = 工作区级；global = 跨工作区共享（config/memory） */
export type MemoryScope = 'workspace' | 'global';

export interface TopicIndexEntry {
  slug: string;
  title: string;
  keywords: string[];
  updated: string;
}

export interface Topic extends TopicIndexEntry {
  content: string;
  created: string;
  relatedTopics?: string[];
  sourceConversations?: string[];
}

/** slug 合法字符：小写字母数字连字符。与后端 memory-tools dogear__SaveMemory 的 zod 校验一致 */
export const SLUG_RE = /^[a-z0-9-]+$/;
