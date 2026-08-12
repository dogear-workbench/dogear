import type { Group } from '../types.js';

export function deriveGroupTitle(group: Group): string {
  return group.title?.trim() ? group.title! : '未命名组';
}
