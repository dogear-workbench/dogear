/**
 * Memory 模块 barrel export
 *
 * 公开面：service（CRUD）、indexer（索引维护）、recall（关键词召回）、
 * similarity（相似度）、preferences（偏好层）、usage（使用统计）、
 * maintenance（对账修复）、checkup（体检）。
 * memory-fs 是内部 IO 工具，不导出。
 */
export * from './memory-service.js';
export * from './memory-indexer.js';
export * from './memory-recall.js';
export * from './memory-similarity.js';
export * from './preferences-service.js';
export * from './memory-usage.js';
export * from './memory-maintenance.js';
export * from './memory-checkup.js';
export type {
  Topic,
  TopicIndexEntry,
  MemoryIndex,
} from './memory-types.js';
