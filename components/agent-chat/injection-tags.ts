import type { InjectionTag } from './types';

/**
 * 注入 tag → 卡片配色（左竖线/底色/徽标），agent 通讯类卡片共用。
 * 底色统一中性，类型色只保留在竖线与徽标。
 */
export const INJECTION_TAG_STYLES: Record<InjectionTag, { bar: string; card: string; badge: string; label: string }> = {
  delivery: {
    bar: 'bg-green-500',
    card: 'bg-secondary/60',
    badge: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    label: '交付',
  },
  reply: {
    bar: 'bg-blue-500',
    card: 'bg-secondary/60',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    label: '回复',
  },
  terminal: {
    bar: 'bg-red-500',
    card: 'bg-secondary/60',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    label: '终态',
  },
  resume: {
    bar: 'bg-blue-500',
    card: 'bg-secondary/60',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    label: '恢复',
  },
  'task-execution': {
    bar: 'bg-amber-500',
    card: 'bg-secondary/60',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    label: '任务执行',
  },
  failover: {
    bar: 'bg-blue-400',
    card: 'bg-secondary/60',
    badge: 'bg-secondary text-secondary-foreground',
    label: '切换',
  },
  dispatch: {
    bar: 'bg-amber-500',
    card: 'bg-secondary/60',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    label: '派出',
  },
};
