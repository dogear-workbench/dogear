/**
 * 市场插件桥接服务
 *
 * 背景：
 * - SDK 在 CLAUDE_CONFIG_DIR 覆盖下，会从 `<CLAUDE_CONFIG_DIR>/plugins/installed_plugins.json`
 *   和 `<CLAUDE_CONFIG_DIR>/settings.json` 读插件元数据。
 * - dogear 把 CLAUDE_CONFIG_DIR 重定向到自己的会话目录，所以 SDK 看不到用户在
 *   `~/.claude/` 下装的市场插件。
 *
 * 桥接做的事：会话启动前，把用户 `~/.claude/plugins/installed_plugins.json` 和
 * `enabledPlugins` 字段（来自 `~/.claude/settings.json` 与 workspace 的
 * `.claude/settings.local.json`）按 scope 过滤后写入 dogear 的 CLAUDE_CONFIG_DIR，
 * 让 SDK 走"自动加载"路径而不破坏 dogear 的会话隔离。
 */

import path from 'path';
import os from 'os';
import fs from 'fs/promises';

interface InstalledPluginEntry {
  scope: 'user' | 'local';
  installPath: string;
  projectPath?: string;
  version?: string;
  installedAt?: string;
  lastUpdated?: string;
  gitCommitSha?: string;
}

interface InstalledPluginsFile {
  version?: number;
  plugins?: Record<string, InstalledPluginEntry[]>;
}

type EnabledPluginsMap = Record<string, string[] | boolean | Record<string, unknown>>;

async function readJsonSafe<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

function filterPluginsByScope(
  source: InstalledPluginsFile,
  workspacePath: string | null | undefined,
): InstalledPluginsFile {
  const out: InstalledPluginsFile = { version: source.version ?? 2, plugins: {} };
  const plugins = source.plugins;
  if (!plugins) return out;

  const normalizedWorkspace = workspacePath ? path.normalize(workspacePath) : null;

  for (const [key, entries] of Object.entries(plugins)) {
    if (!Array.isArray(entries)) continue;
    const filtered = entries.filter((e) => {
      if (e.scope === 'user') return true;
      if (e.scope === 'local' && normalizedWorkspace && e.projectPath) {
        return path.normalize(e.projectPath) === normalizedWorkspace;
      }
      return false;
    });
    if (filtered.length > 0) {
      // SDK 在 CLAUDE_CONFIG_DIR 环境下不理解 scope=local（它会尝试用 ~/.claude 作为基准再校验），
      // 而 dogear 已经在 filterPluginsByScope 做了 projectPath 过滤，写入桥接文件时统一升级为 user，
      // 让 SDK 直接信任这些 entry。
      out.plugins![key] = filtered.map((e) =>
        e.scope === 'local' ? { ...e, scope: 'user' as const } : e,
      );
    }
  }
  return out;
}

/**
 * 把用户 ~/.claude 下的市场插件元数据桥接到 dogear 的 CLAUDE_CONFIG_DIR。
 *
 * 关键事实：
 * - `installed_plugins.json` 由 SDK 从 `CLAUDE_CONFIG_DIR` 字面读取 → 必须桥接
 * - `enabledPlugins` 由 SDK 按 settingSources 从字面路径读取
 *   `~/.claude/settings.json` / `<cwd>/.claude/settings.json` / `<cwd>/.claude/settings.local.json`
 *   → 调用方负责把 settingSources 配成 ['user','project','local']，SDK 会自己拉
 *
 * 返回的 enabledPlugins 仅作日志诊断（确认哪些键被识别），不参与实际注入：
 * 实测 sdk.mjs:255661 inline settings 对象不会被 JSON 序列化，会被 spawn 转成 `[object Object]`。
 *
 * @param claudeConfigDir dogear 重定向后的 CLAUDE_CONFIG_DIR 绝对路径
 * @param workspacePath 当前会话的工作区路径（过滤 scope=local 插件、读取项目级 settings）
 */
export async function syncMarketplacePluginsToConfigDir(
  claudeConfigDir: string,
  workspacePath: string | null | undefined,
): Promise<{ pluginCount: number; enabledPlugins: EnabledPluginsMap }> {
  const userClaudeDir = path.join(os.homedir(), '.claude');
  const userInstalledPath = path.join(userClaudeDir, 'plugins', 'installed_plugins.json');
  const userSettingsPath = path.join(userClaudeDir, 'settings.json');
  const projectSettingsPath = workspacePath
    ? path.join(workspacePath, '.claude', 'settings.json')
    : null;
  const projectLocalSettingsPath = workspacePath
    ? path.join(workspacePath, '.claude', 'settings.local.json')
    : null;

  const targetPluginsDir = path.join(claudeConfigDir, 'plugins');
  const targetInstalledPath = path.join(targetPluginsDir, 'installed_plugins.json');
  const targetKnownMarketplacesPath = path.join(targetPluginsDir, 'known_marketplaces.json');

  await fs.mkdir(targetPluginsDir, { recursive: true });

  // 1. 桥接 installed_plugins.json（按 scope 过滤，scope=local 升级为 user 让 SDK 不再二次校验 projectPath）
  const sourceInstalled = (await readJsonSafe<InstalledPluginsFile>(userInstalledPath)) ?? {
    version: 2,
    plugins: {},
  };
  const filteredInstalled = filterPluginsByScope(sourceInstalled, workspacePath);
  await fs.writeFile(
    targetInstalledPath,
    JSON.stringify(filteredInstalled, null, 2),
    'utf-8',
  );
  const pluginCount = Object.keys(filteredInstalled.plugins ?? {}).length;

  // 1b. 桥接 known_marketplaces.json（CLI 用 CLAUDE_CONFIG_DIR/plugins/known_marketplaces.json
  //     解析 marketplace 名称到 installLocation；不复制则 superpowers-marketplace 等三方市场找不到）
  const userKnownMarketplacesPath = path.join(userClaudeDir, 'plugins', 'known_marketplaces.json');
  const knownMarketplacesRaw = await readJsonSafe<Record<string, unknown>>(userKnownMarketplacesPath);
  if (knownMarketplacesRaw) {
    await fs.writeFile(
      targetKnownMarketplacesPath,
      JSON.stringify(knownMarketplacesRaw, null, 2),
      'utf-8',
    );
  }

  // 2. 收集所有作用域的 enabledPlugins，仅用于日志诊断（确认桥接表里有的键被启用了）
  //    实际加载靠 SDK 的 settingSources=['user','project','local']
  const userSettings = (await readJsonSafe<{ enabledPlugins?: EnabledPluginsMap }>(
    userSettingsPath,
  )) ?? {};
  const projectSettings = projectSettingsPath
    ? (await readJsonSafe<{ enabledPlugins?: EnabledPluginsMap }>(projectSettingsPath)) ?? {}
    : {};
  const projectLocalSettings = projectLocalSettingsPath
    ? (await readJsonSafe<{ enabledPlugins?: EnabledPluginsMap }>(projectLocalSettingsPath)) ?? {}
    : {};

  const validKeys = new Set(Object.keys(filteredInstalled.plugins ?? {}));
  const mergedEnabled: EnabledPluginsMap = {};
  for (const map of [
    userSettings.enabledPlugins ?? {},
    projectSettings.enabledPlugins ?? {},
    projectLocalSettings.enabledPlugins ?? {},
  ]) {
    for (const [key, value] of Object.entries(map)) {
      // 只透传桥接表里有对应 installPath 的插件键，避免无效条目污染
      if (validKeys.has(key)) {
        mergedEnabled[key] = value;
      }
    }
  }

  return {
    pluginCount,
    enabledPlugins: mergedEnabled,
  };
}
