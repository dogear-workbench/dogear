/**
 * 可选工具包注册表
 *
 * 集中声明所有支持「按工作区开关」的工具包元数据，供：
 * - conversation-runtime-service 决定是否注册对应 MCP server + 默认放行
 * - app/settings/ToolPacksTab 渲染开关 UI
 * - tool-pack-guide 注入 systemPromptAppend 的"工具导览"
 *
 * 设计原则：
 * - 一个工具包 = 一个 MCP server + 一组工具，不再做包内单工具权限管理
 * - 开启 = 注册 MCP server + `mcp__<server>__*` 进 allowedTools
 * - 关闭 = 完全不注册，Tool Search 也搜不到
 *
 * 常驻工具（如 memory、article-parse）不在此表，由 conversation-runtime-service 直接注册。
 *
 * extension 工具组不在本表：已并入 browser 能力包（见 ability-registry），注册只受 browser 包总开关 gate，
 * enabledToolPacks 残留 'extension' 一律静默忽略。
 *
 * 详见 docs/plans/2026-05/2026-05-09/skill-tool-search-migration.md
 */

export interface ToolPackMeta {
  /** 工具包名称（唯一标识，workspace config 的 enabledToolPacks 用此值） */
  name: string;
  /** 中文显示名 */
  label: string;
  /** 简短说明，展示在设置页 + 注入 system prompt 工具导览 */
  description: string;
  /** 关联的 MCP Server 名称（如 'dogear-stock-analysis'） */
  mcpServerName: string;
  /** 工具数量（设置页展示用） */
  toolCount: number;
  /** 是否依赖工作区路径（无工作区时不会注册） */
  requiresWorkspace: boolean;
  /** 依赖说明（如需要的外部环境，如 Python） */
  requirements?: string;
}

/**
 * 所有可选工具包
 */
export const OPTIONAL_TOOL_PACKS: ToolPackMeta[] = [
  {
    name: 'article',
    label: '文章管理',
    description: '已抓取文章的读取与列举（读取 Markdown 全文、列出工作区文章）',
    mcpServerName: 'dogear-article',
    toolCount: 2,
    requiresWorkspace: true,
  },
  {
    name: 'stock-quote',
    label: '股票行情',
    description: '实时报价、K 线历史、分时图、自选股管理（搜索股票、获取行情/K线/分时、增删自选股）',
    mcpServerName: 'dogear-stock',
    toolCount: 6,
    requiresWorkspace: false,
  },
  {
    name: 'stock-analysis',
    label: '股票分析',
    description: '技术指标计算、条件筛选、财务数据、信号检测、自定义公式、简单回测（涵盖 MACD/KDJ/RSI/BOLL，支持全市场筛选和 TDX 风格公式）',
    mcpServerName: 'dogear-stock-analysis',
    toolCount: 7,
    requiresWorkspace: false,
    requirements: '需要 Python 3.10+ 和 pandas/numpy/akshare 依赖（首次使用自动检测）',
  },
  {
    name: 'stock-announcement',
    label: '公司公告',
    description: '查询公司公告列表并读取全文（巨潮资讯网数据源，PDF 解析为 markdown，本地懒缓存）',
    mcpServerName: 'dogear-stock-announcement',
    toolCount: 2,
    requiresWorkspace: false,
  },
  {
    name: 'stock-picking',
    label: '候选池预热',
    description: '5 年长期视角候选池预热（dogear__PreheatLongTermPool）+ 综合评分排序（dogear__RankByLongTerm），配合选股 skill 使用',
    mcpServerName: 'dogear-stock-picking',
    toolCount: 2,
    requiresWorkspace: false,
    requirements: '需要 Python 3.10+（复用股票分析计算层）',
  },
  {
    name: 'browser',
    label: '浏览器',
    description: '内嵌浏览器读取网页：一键读文章（readArticle，含展开与登录墙引导）+ 导航/观察/点击/填表等原子探索工具 + present 页面交付',
    mcpServerName: 'dogear-browser',
    toolCount: 15,
    requiresWorkspace: false,
  },
  {
    name: 'web-mcp',
    label: '联网搜索',
    description: 'GLM 联网搜索与网页读取（web_search_prime / webReader，API 直出，适合快速检索与简单页面；复杂渲染页面用浏览器工具）',
    mcpServerName: 'dogear-web-mcp',
    toolCount: 2,
    requiresWorkspace: false,
    requirements: '需要 GLM Coding Plan API Key（个人版套餐概览页创建；消耗套餐专属 MCP 额度）',
  },
];
