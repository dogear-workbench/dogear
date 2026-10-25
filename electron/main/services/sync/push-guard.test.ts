import { test, expect, mock } from 'bun:test';
import { tmpdir } from 'node:os';

mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir() }, nativeTheme: {} },
  app: { getPath: () => tmpdir() },
  nativeTheme: {},
}));

const { checkIncomingPushRelPath } = await import('./push-guard.js');
const { excludesFromSyncOptions } = await import('./manifest.js');

const guard = (
  relPath: string,
  over: Parameters<typeof excludesFromSyncOptions>[0] = undefined,
  workspaceMap?: Record<string, { remoteWsid?: string; enabled: boolean }>,
  extra: { registeredWorkspaceIds?: ReadonlySet<string>; userSyncPaths?: Record<string, string[]> } = {},
) => checkIncomingPushRelPath(relPath, { excludes: excludesFromSyncOptions(over), workspaceMap, ...extra });

// ── 禁写清单：sync/backup 引擎自身状态 + 敏感禁运（registry + 硬编码遗留）+ 外部锚点 ──

test('引擎状态路径禁止推送：sync-state.json 与 backups/ 子树', () => {
  expect(guard('sync-state.json').ok).toBe(false);
  expect(guard('backups/app-config/zip-1.zip').ok).toBe(false);
  expect(guard('sync-state.json.bak').ok).toBe(true);
});

test('login-accounts.json 退役遗留禁运：字典外硬编码防线，自身与子树均拒收', () => {
  const v = guard('login-accounts.json');
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.reason).toContain('敏感数据');
  expect(guard('login-accounts.json/backup.json').ok).toBe(false);
});

test('registry 外部锚点前缀（__ws-external__）禁止推送：非白名单虚拟路径不落数据目录', () => {
  expect(guard('__ws-external__/ws1/docs/p.md').ok).toBe(false);
  expect(guard('__ws-external__').ok).toBe(false);
});

// ── 虚拟路径白名单：注册工作区 × userSyncPaths 勾选子树（旧 tasks/articles 固定声明已退役）──

const registered = new Set(['ws-a']);
const openMap = { 'ws-a': { enabled: true } };

function vguard(
  relPath: string,
  opts: { userSyncPaths?: Record<string, string[]>; map?: typeof openMap; disabled?: string[] } = {},
) {
  return guard(relPath, opts.disabled ? { disabledSyncItems: opts.disabled } : undefined, opts.map ?? openMap, {
    registeredWorkspaceIds: registered,
    userSyncPaths: opts.userSyncPaths,
  });
}

test('白名单放行：注册工作区的勾选子树', () => {
  expect(vguard('__ws-external__/ws-a/docs/deep/p.md', { userSyncPaths: { 'ws-a': ['docs'] } }).ok).toBe(true);
  expect(vguard('__ws-external__/ws-a/README.md', { userSyncPaths: { 'ws-a': ['README.md'] } }).ok).toBe(true);
});

test('退役声明路径（旧 __ws-external__/{wsid}/.dogear/{tasks.json*,articles}）一律拒绝：白名单不再认识', () => {
  const v = vguard('__ws-external__/ws-a/.dogear/tasks.json');
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.reason).toContain('未在本端注册工作区');
  expect(vguard('__ws-external__/ws-a/.dogear/tasks.json.conflict-abcdef-20261004-120000-ab12').ok).toBe(false);
  expect(vguard('__ws-external__/ws-a/.dogear/articles/uuid/meta.json').ok).toBe(false);
  // 勾选 .dogear 子树时声明路径仍被 isExcluded 退役检查兜底拦截（白名单不认识它们）
  expect(vguard('__ws-external__/ws-a/.dogear/tasks.json', { userSyncPaths: { 'ws-a': ['.dogear'] } }).ok).toBe(false);
  expect(vguard('__ws-external__/ws-a/.dogear/other.json', { userSyncPaths: { 'ws-a': ['.dogear'] } }).ok).toBe(true);
});

test('白名单拒绝：未注册 wsid、未启用映射、树外路径、穿越段、畸形形态', () => {
  const v = vguard('__ws-external__/ghost-ws/docs/p.md', { userSyncPaths: { 'ghost-ws': ['docs'] } });
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.reason).toContain('未在本端注册工作区');
  expect(vguard('__ws-external__/ws-a/docs/p.md', { userSyncPaths: { 'ws-a': ['docs'] }, map: {} }).ok).toBe(false);
  expect(vguard('__ws-external__/ws-a/secret.txt', { userSyncPaths: { 'ws-a': ['docs'] } }).ok).toBe(false);
  expect(vguard('__ws-external__/ws-a/docs/../../evil.txt', { userSyncPaths: { 'ws-a': ['docs'] } }).ok).toBe(false);
  expect(vguard('__ws-external__/ws-a').ok).toBe(false);
  // 未传注册表（缺省）一律拒绝
  expect(guard('__ws-external__/ws-a/docs/p.md', undefined, openMap).ok).toBe(false);
});

test('白名单放行后仍受同步范围排除约束：disabledSyncItems 关 tasks 拒收对应工作区子树', () => {
  expect(vguard('workspaces/ws-a/tasks.json', { disabled: ['tasks'] }).ok).toBe(false);
  expect(vguard('workspaces/ws-a/notes/a.md', { disabled: ['tasks'] }).ok).toBe(true);
  expect(vguard('__ws-external__/ws-a/docs/p.md', { userSyncPaths: { 'ws-a': ['docs'] }, disabled: ['tasks'] }).ok).toBe(true);
});

// ── 退役实路径（文章迁工作区后的 configDir 旧位置）：拒收旧版本对端推回 ──

test('退役实路径 workspaces/{wsid}/articles 拒收：与开关无关（存量残值也不放行），非完整段不误伤', () => {
  const v = vguard('workspaces/ws-a/articles/u/m.json');
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.reason).toContain('本端同步范围已排除');
  expect(vguard('workspaces/ws-a/articles').ok).toBe(false);
  expect(vguard('workspaces/ws-a/articles/u/m.json', { disabled: ['articles'] }).ok).toBe(false);
  expect(vguard('workspaces/ws-a/articles.json').ok).toBe(true);
  expect(vguard('workspaces/ws-a/articles-backup/x').ok).toBe(true);
});

// ── 本端同步范围排除（isExcluded 对称过滤，含 F1 optionalDirs） ──

test('默认排除项：shadow-git 与 .conflict-* 副本拒收', () => {
  expect(guard('workspaces/ws1/shadow-git/HEAD').ok).toBe(false);
  expect(guard('plans.json.conflict-4cc497-20261001-120000-ab12').ok).toBe(false);
});

test('disabledSyncItems 关闭的项拒收', () => {
  expect(guard('memory/a.md', { disabledSyncItems: ['memory'] }).ok).toBe(false);
  expect(guard('memory/a.md', { disabledSyncItems: ['memory'] }).ok).toBe(false);
});

test('stocks/feishu 按 optionalDirs 开关拒收/放行（F1）', () => {
  expect(guard('stocks/quote.json').ok).toBe(false);
  expect(guard('feishu/doc.json').ok).toBe(false);
  expect(guard('stocks/quote.json', { syncStocksData: true }).ok).toBe(true);
  expect(guard('feishu/doc.json', { syncFeishu: true }).ok).toBe(true);
});

// ── 工作区映射 enabled 检查 ──

const map = {
  'ws-open': { enabled: true },
  'ws-paused': { enabled: false },
  'ws-linked': { remoteWsid: 'peer-wsid', enabled: true },
};

test('enabled 映射的工作区放行', () => {
  expect(guard('workspaces/ws-open/notes/a.md', undefined, map).ok).toBe(true);
  expect(guard('workspaces/ws-linked/sessions/x.jsonl', undefined, map).ok).toBe(true);
});

test('未建映射的工作区拒收（待映射/对端伪造路径）', () => {
  expect(guard('workspaces/ws-unknown/notes/a.md', undefined, map).ok).toBe(false);
  expect(guard('workspaces/ws-unknown/notes/a.md').ok).toBe(false);
});

test('暂停（enabled=false）的工作区拒收', () => {
  const v = guard('workspaces/ws-paused/notes/a.md', undefined, map);
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.reason).toContain('未启用同步');
});

// ── 全局数据正常放行 ──

test('全局数据放行：顶层文件、常同步目录、workspaces/ 下两段文件', () => {
  expect(guard('plans.json').ok).toBe(true);
  expect(guard('memory/a.md').ok).toBe(true);
  expect(guard('workspaces/workspaces.json').ok).toBe(true);
  expect(guard('settings.json').ok).toBe(true);
});

// ── 已退役目录：拒收（防旧版本对端推回复活） ──

test('退役目录 conversations/ 拒收：目录内任意深度、目录自身条目', () => {
  const v = guard('conversations/sessions/17344.json');
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.reason).toContain('本端同步范围已排除');
  expect(guard('conversations').ok).toBe(false);
});
