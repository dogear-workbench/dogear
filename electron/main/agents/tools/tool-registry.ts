/**
 * 工具注册中心
 *
 * 所有自定义 MCP 工具在创建时将元数据注册到此处，
 * 设置页通过 IPC 接口动态获取已注册的工具列表，无需硬编码。
 */

export interface ToolMeta {
  /** 工具名称（与 SDK tool() 的第一个参数一致） */
  name: string;
  /** 简短描述（用于设置页展示，取 description 第一行） */
  description: string;
  /** 所属 MCP Server 名称 */
  server: string;
  /** 分类标签 */
  category: 'article' | 'stock' | 'memory' | 'other';
}

/** 按 MCP Server 分组后的工具列表 */
export interface ToolGroup {
  /** MCP Server 名称（如 'sdk', 'dogear-stock'） */
  server: string;
  /** 中文分组标签（如 '股票行情'） */
  label: string;
  /** 组内工具列表 */
  tools: ToolMeta[];
}

/** Server 名称 → 中文分组标签 */
const SERVER_LABELS: Record<string, string> = {
  'sdk':                    'SDK 内置工具',
  'dogear-memory':          '记忆大脑',
  'dogear-stock':           '股票行情',
  'dogear-stock-analysis':  '股票分析',
  'dogear-article':         '文章阅读',
  'dogear-article-parse':   '文章解析',
  'dogear-smart-category':  '智能分类',
};

/** SDK 内置工具（无法从 SDK 运行时获取元数据，故保留静态定义） */
export const SDK_BUILTIN_TOOLS: ToolMeta[] = [
  { name: 'Read', description: '读取文件内容', server: 'sdk', category: 'other' },
  { name: 'Glob', description: '按模式搜索文件', server: 'sdk', category: 'other' },
  { name: 'Grep', description: '搜索文件内容', server: 'sdk', category: 'other' },
  { name: 'Bash', description: '执行终端命令', server: 'sdk', category: 'other' },
  { name: 'Write', description: '创建或覆盖文件', server: 'sdk', category: 'other' },
  { name: 'Edit', description: '编辑文件片段', server: 'sdk', category: 'other' },
  { name: 'WebFetch', description: '抓取网页内容', server: 'sdk', category: 'other' },
  { name: 'WebSearch', description: '搜索互联网', server: 'sdk', category: 'other' },
];

/** 已注册的自定义工具 */
const customTools: ToolMeta[] = [];

/**
 * 注册自定义工具元数据（在各工具文件的 create*Tools 函数中调用）
 */
export function registerTools(tools: ToolMeta[]) {
  for (const tool of tools) {
    // 防止重复注册（同名工具只保留第一个）
    if (!customTools.some(t => t.name === tool.name && t.server === tool.server)) {
      customTools.push(tool);
    }
  }
}

/**
 * 获取所有已注册的自定义工具
 */
export function getCustomTools(): ToolMeta[] {
  return [...customTools];
}

/**
 * 获取全部工具，按 MCP Server 分组返回
 *
 * SDK 内置工具作为第一组，自定义工具按 server 分组排列。
 * 分组顺序固定：sdk → stock → stock-analysis → article → 其他
 */
export function getAllTools(): ToolGroup[] {
  // 按 server 聚合自定义工具
  const serverMap = new Map<string, ToolMeta[]>();
  for (const tool of customTools) {
    const list = serverMap.get(tool.server) || [];
    list.push(tool);
    serverMap.set(tool.server, list);
  }

  // 固定排序
  const serverOrder = [
    'sdk',
    'dogear-memory',
    'dogear-stock',
    'dogear-stock-analysis',
    'dogear-article',
    'dogear-article-parse',
  ];

  const groups: ToolGroup[] = [];

  // SDK 内置工具组
  groups.push({
    server: 'sdk',
    label: SERVER_LABELS['sdk'] || 'SDK 内置工具',
    tools: [...SDK_BUILTIN_TOOLS],
  });

  // 按固定顺序添加已注册的 server 分组
  for (const server of serverOrder) {
    if (server === 'sdk') continue;
    const tools = serverMap.get(server);
    if (tools && tools.length > 0) {
      groups.push({
        server,
        label: SERVER_LABELS[server] || server,
        tools: [...tools],
      });
      serverMap.delete(server);
    }
  }

  // 添加未在固定顺序中的 server（未来新增的 server 自动兜底）
  for (const [server, tools] of serverMap) {
    groups.push({
      server,
      label: SERVER_LABELS[server] || server,
      tools: [...tools],
    });
  }

  return groups;
}
