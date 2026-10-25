import { create } from 'zustand';
import type { LucideIcon } from 'lucide-react';
import { useSessionStore } from './session-store';

export interface SearchHit {
  id: string;
  title: string;
  subtitle?: string;
  /** 命中说明第二行（如正文片段），由渲染层做关键词高亮 */
  description?: string;
  icon?: LucideIcon;
  onSelect: () => void;
}

export interface SearchProvider {
  id: string;
  placeholder: string;
  isActive: () => boolean;
  search: (query: string) => SearchHit[] | Promise<SearchHit[]>;
  // conversation: 顶栏不弹命中下拉，经 conversation-search-store 桥接当前会话内容搜索
  mode?: 'conversation';
}

interface SearchState {
  providers: SearchProvider[];
}

export const useSearchStore = create<SearchState>(() => ({
  providers: [],
}));

export function registerProvider(provider: SearchProvider): void {
  useSearchStore.setState((state) => ({
    providers: [...state.providers.filter((p) => p.id !== provider.id), provider],
  }));
}

export function unregisterProvider(id: string): void {
  useSearchStore.setState((state) => ({
    providers: state.providers.filter((p) => p.id !== id),
  }));
}

export function useActiveProvider(): SearchProvider | null {
  // isActive() 内部走 getState 读 activeTabId，这里订阅以在 tab 切换时触发重算
  useSessionStore((s) => s.activeTabId);
  const providers = useSearchStore((s) => s.providers);
  let active: SearchProvider | null = null;
  for (const p of providers) {
    if (p.isActive()) active = p;
  }
  return active;
}
