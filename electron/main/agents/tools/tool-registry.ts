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
  category: 'article' | 'book-qa' | 'book-analysis' | 'stock' | 'other';
}

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
 * 获取全部工具（SDK 内置 + 自定义）
 */
export function getAllTools(): { sdk: ToolMeta[]; custom: ToolMeta[] } {
  return {
    sdk: SDK_BUILTIN_TOOLS,
    custom: [...customTools],
  };
}
