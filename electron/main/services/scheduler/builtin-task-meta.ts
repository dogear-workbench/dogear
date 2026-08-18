import type { BuiltinTaskId } from './types.js';

export const BUILTIN_TASK_IDS: readonly BuiltinTaskId[] = [
  'group_digest',
  'review',
  'categorize',
  'categorize_organize',
];

export const BUILTIN_LABELS: Record<BuiltinTaskId, string> = {
  group_digest: '组卡提炼',
  review: '复盘报告',
  categorize: '智能分类',
  categorize_organize: '分类整理',
};
