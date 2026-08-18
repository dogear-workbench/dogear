/**
 * MemoryTab 内部数据类型（轻量 interface，不镜像到 types/electron-api.ts）
 *
 * 原则：只在设置页记忆管理内部使用；如其他渲染层文件需要 Topic，
 * 再考虑镜像到全局类型文件。
 */
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

export interface CoreProfile {
  content: string;
  updated: string;
}

/** slug 合法字符：小写字母数字连字符。与后端 memory-tools dogear__SaveMemory 的 zod 校验一致 */
export const SLUG_RE = /^[a-z0-9-]+$/;

/** 核心档案建议字符数上限（软限制，超过仅提示不拦截保存） */
export const CORE_PROFILE_SOFT_LIMIT = 2000;
