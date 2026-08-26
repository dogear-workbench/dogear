// stores/tool-registry-store.ts
import { create } from 'zustand';
import { client } from '@/lib/client';

interface ToolGroup {
  server: string;
  label: string;
  tools: Array<{ name: string; description: string; server: string; category: string }>;
}

interface ToolRegistryState {
  /** 工具名 → server 名 */
  toolNameToServer: Map<string, string>;
  /** server 名 → 中文标签 */
  serverLabels: Record<string, string>;
  /** 是否已加载过 */
  loaded: boolean;
  /** 正在加载中的 promise（防止并发请求） */
  loadingPromise: Promise<void> | null;

  ensureLoaded: () => Promise<void>;
  /**
   * 根据工具名返回中文大类
   * - 精确匹配优先（toolNameToServer）
   * - 失败时尝试解析 mcp__{server}__xxx 前缀
   * - 全部失败返回 "其他工具"
   */
  getCategoryLabel: (toolName: string) => string;
}

// pi-agent-core 基础工具不在注册中心（那里只有业务工具组），内置分类兜底；大小写两套兼容新旧会话历史
const BASIC_TOOL_LABEL = '基础工具';
const BASIC_TOOL_NAMES = new Set([
  'read', 'write', 'edit', 'bash', 'Read', 'Write', 'Edit', 'Bash',
  'Glob', 'Grep', 'Skill',
]);

export const useToolRegistryStore = create<ToolRegistryState>((set, get) => ({
  toolNameToServer: new Map(),
  serverLabels: {},
  loaded: false,
  loadingPromise: null,

  ensureLoaded: async () => {
    const state = get();
    if (state.loaded) return;
    if (state.loadingPromise) return state.loadingPromise;

    const promise = (async () => {
      try {
        const result = await client.getRegisteredTools();
        const groups: ToolGroup[] = Array.isArray(result) ? result : [];
        const nameToServer = new Map<string, string>();
        const labels: Record<string, string> = {};
        for (const g of groups) {
          labels[g.server] = g.label;
          for (const t of g.tools || []) {
            nameToServer.set(t.name, g.server);
          }
        }
        set({ toolNameToServer: nameToServer, serverLabels: labels, loaded: true });
      } catch (err) {
        console.warn('[tool-registry-store] failed to load tools:', err);
        // 失败不阻塞 UI，仅 loaded=false，下次触发时重试
      } finally {
        set({ loadingPromise: null });
      }
    })();
    set({ loadingPromise: promise });
    return promise;
  },

  getCategoryLabel: (toolName: string): string => {
    const { toolNameToServer, serverLabels } = get();
    // 1. 精确匹配
    const direct = toolNameToServer.get(toolName);
    if (direct) return serverLabels[direct] || direct;
    // 2. 基础工具内置分类（注册中心只有业务工具组，查不到 read/bash/Glob 等）
    if (BASIC_TOOL_NAMES.has(toolName)) return BASIC_TOOL_LABEL;
    // 3. 兜底
    return '其他工具';
  },
}));
