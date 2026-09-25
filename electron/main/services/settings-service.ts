/**
 * 全局设置读写服务
 * 从 .dogear/settings.json 读写 AI 设置
 * - 开发阶段：<项目根目录>/.dogear/settings.json
 * - 打包发布后：<app.asar 同级目录>/.dogear/settings.json
 */
import path from 'path';
import electron from 'electron';
import { safeJsonWrite, safeJsonRead } from './safe-json.js';
import {
  DEFAULT_SETTINGS,
  deepMerge,
  createDefaultBasicToolPermissions,
  createDefaultSubAgentProfile,
  createBrowserParseSubAgentProfile,
  BROWSER_PARSE_SUB_AGENT_PROFILE_ID,
  normalizeFailoverChain,
  normalizeBackupSettings,
  BASIC_TOOL_NAMES,
  normalizeWebAiSites,
  type AppSettings,
  type PiPermissionMode,
  type BasicToolPermissions,
  type BasicToolPermission,
  type ModelPricing,
} from './settings-types.js';

const { app, nativeTheme } = electron;

const LEGACY_BROWSER_PARSE_DESCRIPTIONS = new Set([
  '挂载浏览器工具包执行网页抓取与解析，建议选择便宜档模型以节省成本',
  '挂载扩展工具包在用户真实浏览器（登录态站点如小红书）执行只读调研，或用受控浏览器读取公开网页',
  '挂载扩展工具包在用户真实浏览器（登录态站点如小红书）执行只读调研，或用受控浏览器读取公开网页；扩展通道同一时间仅一个会话可用，并行调研请改串行派遣或使用受控浏览器',
  '挂载扩展工具包在用户真实浏览器（登录态站点如小红书）执行只读调研，或用受控浏览器读取公开网页；扩展通道同一时间仅一个会话可用，并行调研请改串行派遣或使用受控浏览器。派单只写目标与产出要求，勿写逐步操作剧本，由其自主探索。探索循环：行动前确认世界状态（observe_page/read_state 概要），每次下钻带明确假设；页面与预期不符先 navigate 恢复再继续，不把偏离当失败上报；navigate 提示有站点档案时先调 dogear__extension__site_knowledge 取地图（可能漂移，用时概要验证），发现新结构用 dogear__extension__site_finding 沉淀；同一页面连续 3 次探索失败即停并报告已发现内容；滑块/验证码即停，不规避随机延迟。',
  '浏览器与扩展双通道调研：公开网页用内嵌浏览器（dogear__browser__*）——readArticle 读文章 / search 搜索为快档首选，失败返回页面位置（tabId+URL+状态）后直接用 observe_page / find / read_text / click / fill 原子工具继续探索，不要重新导航；登录态站点（如小红书）用扩展通道（dogear__extension__*，用户真实浏览器，同一时间仅一个会话可用，并行请串行派遣）。探索循环：行动前确认世界状态（observe_page/read_state 概要），每次下钻带明确假设；页面与预期不符先 navigate 恢复再继续，不把偏离当失败上报；navigate 提示有站点档案时先调 dogear__extension__site_knowledge 取地图（可能漂移，用时概要验证），发现新结构用 dogear__extension__site_finding 沉淀。登录墙/人机验证（awaiting_human）或密码/提交类 guard 拦截即停：页面已呈现在浏览器面板，等用户完成后点「完成后继续」再继续任务。任务交付用 dogear__browser__present 把关键页面呈现给用户（页面即产物）。同一页面连续 3 次探索失败即停并报告已发现内容；滑块/验证码即停，不规避随机延迟。',
  '浏览器与扩展双通道调研：公开网页用内嵌浏览器（dogear__browser__*）——readArticle 读文章 / search 搜索为快档首选，失败返回页面位置（tabId+URL+状态）后直接用 observe_page / find / read_text / click / fill 原子工具继续探索，不要重新导航；登录态站点（如小红书）用扩展通道（dogear__extension__*，用户真实浏览器，同一时间仅一个会话可用，并行请串行派遣）。探索循环：行动前确认世界状态（observe_page/read_state 概要），每次下钻带明确假设；页面与预期不符先 navigate 恢复再继续，不把偏离当失败上报；navigate 提示有站点档案时先调 dogear__extension__site_knowledge 取地图（可能漂移，用时概要验证），发现新结构用 dogear__extension__site_finding 沉淀。登录墙/人机验证（awaiting_human）或密码/提交类 guard 拦截即停：页面已呈现在浏览器面板，等用户完成后点「完成后继续」再继续任务。页面被用户接管时写操作会被拒绝，收到 user_takeover 后应停下等待，交还后会收到继续提示。任务交付用 dogear__browser__present 把关键页面呈现给用户（页面即产物）。同一页面连续 3 次探索失败即停并报告已发现内容；滑块/验证码即停，不规避随机延迟。',
  '浏览器与扩展双通道调研：公开网页用内嵌浏览器（dogear__browser__*），登录态站点（如小红书）用扩展通道（dogear__extension__*，用户真实浏览器）；扩展通道同一时间仅一个会话可用，并行调研请改串行派遣。探索方法论见 browser-exploration skill，子会话启用 browser 能力时自动挂载。',
  '浏览器与扩展双通道调研 + 工作区文章读取与解析：公开网页用内嵌浏览器（dogear__browser__*），登录态站点（如小红书）用扩展通道（dogear__extension__*，用户真实浏览器）；扩展通道同一时间仅一个会话可用，并行调研请改串行派遣。文章解析随 article 能力启用，article-parser skill 直通无需单独配置。探索方法论见 browser-exploration skill，子会话启用 browser 能力时自动挂载。',
  '网页与文章调研：公开网页用内嵌浏览器；登录态站点（如小红书）走用户浏览器扩展通道（全局独占，并行串行派遣）；也用于解析工作区文章库的文章。',
]);

const LEGACY_DEFAULT_DESCRIPTIONS = new Set([
  '标准派遣会话，具备全部基础工具和交付通信能力',
  '实施类任务：改代码、写文件、跑命令，需要动工作区时用这个。实施完成后交付通知与摘要走共享区或正文。',
]);

// 重新导出所有纯类型和纯函数，保持现有导入路径兼容
export * from './settings-types.js';

// ============================================================
// 路径函数
// ============================================================

/**
 * 获取 .dogear 配置目录
 * 开发阶段：项目根目录/.dogear
 * 打包后：AppData/Roaming/Dogear/.dogear
 */
export function getConfigDir(): string {
  // Worker 线程无 electron app，优先读注入的 DOGEAR_CONFIG_DIR
  if (process.env.DOGEAR_CONFIG_DIR) return process.env.DOGEAR_CONFIG_DIR;
  if (app?.isPackaged) {
    return path.join(app.getPath('userData'), '.dogear');
  }
  return path.join(process.cwd(), '.dogear');
}

function getSettingsPath(): string {
  return path.join(getConfigDir(), 'settings.json');
}

// ============================================================
// 公开接口
// ============================================================

/**
 * 读取设置
 * 文件不存在时返回默认值，已存在时与默认值深度合并（保证新增字段有默认值）
 */
export async function loadSettings(): Promise<AppSettings> {
  const saved = await safeJsonRead<AppSettings | null>(getSettingsPath(), null);
  if (saved === null) {
    // 文件不存在或解析失败，返回默认值
    return structuredClone(DEFAULT_SETTINGS);
  }
  const merged = deepMerge(saved, DEFAULT_SETTINGS);
  const dirty = normalizeSettings(merged);
  const piMigrated = migratePiProfiles(merged);
  if (dirty || piMigrated) {
    await safeJsonWrite(getSettingsPath(), merged);
  }
  return merged;
}

/**
 * 把任意 piModels 原始值归一化为 { id, label?, contextWindow?, pricing? } 对象数组：
 * string 元素转 { id }；对象元素仅保留非空 string 的 id、非空 string 的 label、正整数的 contextWindow
 * 与三字段均为有限非负数的 pricing（整体保留或整体丢弃）；
 * 按 id 去重保首现顺序；非法元素丢弃；非数组输入返回空数组。
 */
export function normalizePiModels(raw: unknown): Array<{ id: string; label?: string; contextWindow?: number; pricing?: ModelPricing }> {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: Array<{ id: string; label?: string; contextWindow?: number; pricing?: ModelPricing }> = [];
  for (const item of raw) {
    let id: string;
    let label: string | undefined;
    let contextWindow: number | undefined;
    let pricing: ModelPricing | undefined;
    if (typeof item === 'string') {
      id = item;
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      if (typeof obj.id !== 'string' || obj.id === '') continue;
      id = obj.id;
      if (typeof obj.label === 'string' && obj.label !== '') label = obj.label;
      if (typeof obj.contextWindow === 'number' && Number.isInteger(obj.contextWindow) && obj.contextWindow > 0) {
        contextWindow = obj.contextWindow;
      }
      if (obj.pricing && typeof obj.pricing === 'object') {
        const p = obj.pricing as Record<string, unknown>;
        const fields = ['input', 'output', 'cacheRead'] as const;
        if (fields.every(f => typeof p[f] === 'number' && Number.isFinite(p[f]) && p[f] >= 0)) {
          pricing = { input: p.input as number, output: p.output as number, cacheRead: p.cacheRead as number };
        }
      }
    } else {
      continue;
    }
    if (id === '') continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const entry: { id: string; label?: string; contextWindow?: number; pricing?: ModelPricing } = { id };
    if (label !== undefined) entry.label = label;
    if (contextWindow !== undefined) entry.contextWindow = contextWindow;
    if (pricing !== undefined) entry.pricing = pricing;
    result.push(entry);
  }
  return result;
}

export const LEGACY_MODEL_TIERS = new Set(['haiku', 'sonnet', 'opus']);

/**
 * 遍历 profiles，无条件 pi 化：piModels 非数组或为空时用 haikuModel/sonnetModel/opusModel
 * 过滤空值后填入，再统一迁移为 { id, label? } 对象数组，然后删除旧 SDK 字段
 * （apiFormat/三档模型/disableNonessentialTraffic/autoCompactWindow）；
 * 随后把 settings 内所有 ModelSelection 残留的旧三档 tier（haiku/sonnet/opus）映射为
 * piModels 里的真实模型 id（子串匹配），无匹配时置 null 回退默认选择。
 * 返回 true 表示发生了变化（需要落盘），false 表示无事可做。
 */
export function migratePiProfiles(settings: AppSettings): boolean {
  let changed = false;
  for (const profile of Object.values(settings.profiles)) {
    const p = profile as unknown as Record<string, unknown>;
    if (!Array.isArray(p.piModels) || p.piModels.length === 0) {
      const seeds = [p.haikuModel, p.sonnetModel, p.opusModel]
        .filter((m): m is string => !!m && typeof m === 'string');
      // 种子全空且 piModels 本就是合法空数组时不写入，避免每次启动都无意义落盘
      if (seeds.length > 0 || !Array.isArray(p.piModels)) {
        p.piModels = seeds;
        changed = true;
      }
    }
    const normalized = normalizePiModels(p.piModels);
    if (JSON.stringify(normalized) !== JSON.stringify(p.piModels)) {
      p.piModels = normalized;
      changed = true;
    }
    for (const field of ['apiFormat', 'haikuModel', 'sonnetModel', 'opusModel', 'disableNonessentialTraffic', 'autoCompactWindow']) {
      if (field in p) {
        delete p[field];
        changed = true;
      }
    }
  }

  for (const key of ['defaultModelSelection', 'parseModelSelection', 'stateModelSelection'] as const) {
    const sel = settings.ai[key];
    if (!sel || !LEGACY_MODEL_TIERS.has(sel.tier)) continue;
    const models = settings.profiles[sel.profileId]?.piModels ?? [];
    const matched = models.find(m => m.id.toLowerCase().includes(sel.tier));
    settings.ai[key] = matched ? { ...sel, tier: matched.id } : null;
    changed = true;
  }
  for (const subProfile of settings.subAgent?.profiles ?? []) {
    const sel = subProfile.modelSelection;
    if (!sel || !LEGACY_MODEL_TIERS.has(sel.tier)) continue;
    const models = settings.profiles[sel.profileId]?.piModels ?? [];
    const matched = models.find(m => m.id.toLowerCase().includes(sel.tier));
    subProfile.modelSelection = matched ? { ...sel, tier: matched.id } : null;
    changed = true;
  }
  return changed;
}


const OLD_AUTO_MODES = new Set(['bypassPermissions', 'dontAsk', 'auto', 'acceptEdits']);

function normalizePermissionMode(raw: unknown): PiPermissionMode {
  if (raw === 'default' || raw === 'autoExecute') return raw;
  if (typeof raw === 'string' && OLD_AUTO_MODES.has(raw)) return 'autoExecute';
  return 'default';
}

function normalizeBasicToolPermissions(raw: unknown): BasicToolPermissions {
  const result = createDefaultBasicToolPermissions();
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    for (const key of BASIC_TOOL_NAMES) {
      const val = obj[key];
      if (val === 'ask' || val === 'allow') {
        result[key] = val;
      }
    }
  }
  return result;
}

export function normalizeSettings(settings: AppSettings): boolean {
  let changed = false;
  const obj = settings as unknown as Record<string, unknown>;

  if (!settings.ai || typeof settings.ai !== 'object' || Array.isArray(settings.ai)) {
    obj.ai = structuredClone(DEFAULT_SETTINGS.ai);
    changed = true;
  } else {
    const ai = settings.ai as unknown as Record<string, unknown>;
    const newMode = normalizePermissionMode(ai.permissionMode);
    if (ai.permissionMode !== newMode) {
      ai.permissionMode = newMode;
      changed = true;
    }
  }

  const newPerms = normalizeBasicToolPermissions(obj.basicToolPermissions);
  const currentPerms = obj.basicToolPermissions;
  if (
    !currentPerms ||
    typeof currentPerms !== 'object' ||
    Array.isArray(currentPerms) ||
    JSON.stringify(currentPerms) !== JSON.stringify(newPerms)
  ) {
    obj.basicToolPermissions = newPerms;
    changed = true;
  }

  if ('permissionRules' in settings) {
    delete obj.permissionRules;
    changed = true;
  }

  if (obj.appearance !== undefined && (typeof obj.appearance !== 'object' || Array.isArray(obj.appearance))) {
    obj.appearance = { theme: 'light' };
    changed = true;
  } else if (obj.appearance && typeof obj.appearance === 'object') {
    const ap = obj.appearance as Record<string, unknown>;
    if (ap.theme !== 'light' && ap.theme !== 'dark' && ap.theme !== 'system') {
      ap.theme = 'light';
      changed = true;
    }
  }

  if (obj.browserSearchEngine !== 'auto' && obj.browserSearchEngine !== 'google' && obj.browserSearchEngine !== 'bing') {
    obj.browserSearchEngine = 'auto';
    changed = true;
  }
  if (obj.browserProxyServer !== undefined && typeof obj.browserProxyServer !== 'string') {
    delete obj.browserProxyServer;
    changed = true;
  }
  if (obj.webMcpApiKey !== undefined && typeof obj.webMcpApiKey !== 'string') {
    delete obj.webMcpApiKey;
    changed = true;
  }

  const staleAiFields = ['maxTurns', 'defaultSystemPrompt', 'subagentModelTier', 'excludeDynamicSections', 'promptSuggestionsEnabled', 'thinkingType', 'thinkingBudgetTokens', 'thinkingDisplay'];
  const aiObj = settings.ai as unknown as Record<string, unknown>;
  for (const field of staleAiFields) {
    if (field in aiObj) {
      delete aiObj[field];
      changed = true;
    }
  }

  const subAgent = settings.subAgent as unknown as Record<string, unknown> | undefined;
  if (subAgent && typeof subAgent === 'object' && !Array.isArray(subAgent)) {
    if ('permissionMode' in subAgent) {
      delete subAgent.permissionMode;
      changed = true;
    }
    for (const staleField of ['cachePolicy', 'loadCoreProfile', 'loadSkills', 'loadArticleParse']) {
      if (staleField in subAgent) {
        delete subAgent[staleField];
        changed = true;
      }
    }
    if (Array.isArray(subAgent.profiles)) {
      for (const profile of subAgent.profiles) {
        if (!profile || typeof profile !== 'object' || Array.isArray(profile)) continue;
        const p = profile as Record<string, unknown>;
        if (!Array.isArray(p.enabledBasicTools)) {
          p.enabledBasicTools = ['read', 'write', 'edit', 'bash', 'Glob', 'Grep'];
          changed = true;
        }
        if (!p.enabledAbilities || typeof p.enabledAbilities !== 'object' || Array.isArray(p.enabledAbilities)) {
          p.enabledAbilities = {};
          changed = true;
        }
        if (p.enabledAbilities && typeof p.enabledAbilities === 'object' && !Array.isArray(p.enabledAbilities)) {
          const ab = p.enabledAbilities as Record<string, unknown>;
          if ('groupFiles' in ab) {
            delete ab.groupFiles;
            changed = true;
          }
          if ('browser' in ab && typeof ab.browser !== 'boolean') {
            delete ab.browser;
            changed = true;
          }
          if ('extension' in ab && typeof ab.extension !== 'boolean') {
            delete ab.extension;
            changed = true;
          }
          if ('web' in ab && typeof ab.web !== 'boolean') {
            delete ab.web;
            changed = true;
          }
          // 内置 Profile 升级新增能力键时，旧数据只补缺失键；显式 false 是用户关闭，不覆盖
          if (p.id === BROWSER_PARSE_SUB_AGENT_PROFILE_ID) {
            // 内置描述变更只迁移已知旧值，用户自定义描述不动
            if (typeof p.description === 'string' && LEGACY_BROWSER_PARSE_DESCRIPTIONS.has(p.description)) {
              p.description = createBrowserParseSubAgentProfile().description;
              changed = true;
            }
            const builtinAb = createBrowserParseSubAgentProfile().enabledAbilities as Record<string, unknown>;
            for (const key of Object.keys(builtinAb)) {
              if (!(key in ab)) {
                ab[key] = builtinAb[key];
                changed = true;
              }
            }
          }
          if (p.id === 'default') {
            if (typeof p.description === 'string' && LEGACY_DEFAULT_DESCRIPTIONS.has(p.description)) {
              p.description = createDefaultSubAgentProfile().description;
              changed = true;
            }
            const builtinAb = createDefaultSubAgentProfile().enabledAbilities as Record<string, unknown>;
            for (const key of Object.keys(builtinAb)) {
              if (!(key in ab)) {
                ab[key] = builtinAb[key];
                changed = true;
              }
            }
          }
        }
      }
      if (subAgent.profiles.length === 0) {
        subAgent.profiles = [createDefaultSubAgentProfile(), createBrowserParseSubAgentProfile()];
        changed = true;
      }
      const existingProfiles = subAgent.profiles as unknown[];
      if (!existingProfiles.some((p) => p !== null && typeof p === 'object' && (p as { id?: unknown }).id === BROWSER_PARSE_SUB_AGENT_PROFILE_ID)) {
        existingProfiles.push(createBrowserParseSubAgentProfile());
        changed = true;
      }
    } else {
      subAgent.profiles = [createDefaultSubAgentProfile(), createBrowserParseSubAgentProfile()];
      changed = true;
    }
  } else {
    obj.subAgent = { profiles: [createDefaultSubAgentProfile(), createBrowserParseSubAgentProfile()] };
    changed = true;
  }

  const normalizedSites = normalizeWebAiSites(obj.webAiSites);
  if (JSON.stringify(normalizedSites) !== JSON.stringify(obj.webAiSites)) {
    obj.webAiSites = normalizedSites;
    changed = true;
  }

  const newBackup = normalizeBackupSettings(obj.backup);
  if (JSON.stringify(newBackup) !== JSON.stringify(settings.backup)) {
    obj.backup = newBackup;
    changed = true;
  }

  const newFailover = normalizeFailoverChain(settings.profiles, settings.failover);
  if (JSON.stringify(newFailover) !== JSON.stringify(settings.failover)) {
    obj.failover = newFailover;
    changed = true;
  }

  return changed;
}

/**
 * 把外观主题同步到 Electron nativeTheme（跟随系统 + 原生标题栏深浅）
 * themeSource 可在 app ready 前设置
 */
export function applyThemeSource(theme: unknown): void {
  const t = theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'light';
  if (nativeTheme.themeSource !== t) nativeTheme.themeSource = t;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await safeJsonWrite(getSettingsPath(), settings);
  applyThemeSource(settings.appearance?.theme);
}
