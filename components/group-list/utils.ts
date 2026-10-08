import type { Group } from '@/types/group';

export function deriveGroupTitle(group: Group): string {
  if (group.title && group.title.trim() && group.title !== '新对话') return group.title;
  return '未命名话题';
}
