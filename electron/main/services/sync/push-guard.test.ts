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
) => checkIncomingPushRelPath(relPath, { excludes: excludesFromSyncOptions(over), workspaceMap });

// ── 禁写清单：sync/backup 引擎自身状态 + registry 敏感路径 + 外部锚点 ──

test('引擎状态路径禁止推送：sync-state.json 与 backups/ 子树', () => {
  expect(guard('sync-state.json').ok).toBe(false);
  expect(guard('backups/app-config/zip-1.zip').ok).toBe(false);
  expect(guard('sync-state.json.bak').ok).toBe(true);
});

test('registry 敏感路径（sensitiveRelPaths → login-accounts.json）禁止推送', () => {
  const v = guard('login-accounts.json');
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.reason).toContain('敏感数据');
});

test('registry 外部锚点前缀（__ws-external__）禁止推送：虚拟路径不落数据目录', () => {
  expect(guard('__ws-external__/ws1/.dogear/tasks.json').ok).toBe(false);
  expect(guard('__ws-external__').ok).toBe(false);
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
  expect(guard('conversations/c/x.jsonl').ok).toBe(true);
  expect(guard('workspaces/workspaces.json').ok).toBe(true);
  expect(guard('settings.json').ok).toBe(true);
});
