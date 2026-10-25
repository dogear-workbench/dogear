import { test, expect, mock } from 'bun:test';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

process.env.DOGEAR_CONFIG_DIR = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-data-registry-'));

mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir() }, nativeTheme: {} },
  app: { getPath: () => tmpdir() },
  nativeTheme: {},
}));

const {
  DATA_ITEMS,
  BACKUP_CATEGORY_KEYS,
  BACKUP_CATEGORY_SCOPES,
  EXTERNAL_ANCHOR_PREFIX,
  backupSourcesFor,
  registrySyncItems,
  sensitiveRelPaths,
  toArchiveRelPath,
  resolveArchiveRelPath,
  syncStatusOf,
} = await import('./data-registry.js');
const { SYNC_ITEM_IDS } = await import('./settings-types.js');

const configDir = () => process.env.DOGEAR_CONFIG_DIR!;
const cfgPath = (...segs: string[]) => path.join(configDir(), ...segs);

// ── 数据项全集：结构完整性 ──

test('DATA_ITEMS：id 唯一、paths 非空且为 posix 相对路径、backupCategory 在分类白名单内', () => {
  const ids = DATA_ITEMS.map((i) => i.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const item of DATA_ITEMS) {
    expect(item.paths.length).toBeGreaterThan(0);
    for (const p of item.paths) {
      expect(p).not.toContain('\\');
      expect(p.startsWith('/')).toBe(false);
      expect(p.split('/').every((s) => s !== '')).toBe(true);
    }
    if (item.backupCategory !== undefined) {
      expect(BACKUP_CATEGORY_KEYS).toContain(item.backupCategory);
    }
  }
});

// ── 数据项全集：审计对照表逐行覆盖 ──

test('审计对照表：每个数据行都有对应条目且路径正确', () => {
  const byId = new Map(DATA_ITEMS.map((i) => [i.id, i]));
  const expected: Record<string, { paths: string[]; sync?: string; category?: string }> = {
    'ws-notes': { paths: ['workspaces/{wsid}/notes'], sync: 'workspaces', category: 'notes-groups' },
    'ws-groups': { paths: ['workspaces/{wsid}/groups'], sync: 'workspaces', category: 'notes-groups' },
    'ws-groups-index': { paths: ['workspaces/{wsid}/groups.json'], sync: 'workspaces', category: 'notes-groups' },
    'ws-conversations-index': { paths: ['workspaces/{wsid}/conversations.json'], sync: 'workspaces', category: 'notes-groups' },
    'ws-config': { paths: ['workspaces/{wsid}/config.json'], sync: 'workspaces', category: 'notes-groups' },
    'ws-agent-md': { paths: ['workspaces/{wsid}/agent.md'], sync: 'workspaces', category: 'notes-groups' },
    'ws-memory': { paths: ['workspaces/{wsid}/memory'], sync: 'workspaces', category: 'memory' },
    'ws-sessions': { paths: ['workspaces/{wsid}/sessions'], sync: 'workspaces', category: 'sessions' },
    'ws-tasks': { paths: ['workspaces/{wsid}/tasks.json'], sync: 'tasks', category: 'tasks' },
    memory: { paths: ['memory'], sync: 'memory', category: 'memory' },
    'workspaces-registry': { paths: ['workspaces/workspaces.json'], sync: 'workspaces', category: 'app-config' },
    'agent-md': { paths: ['agent.md'], sync: 'agent.md', category: 'app-config' },
    preferences: { paths: ['preferences.md'], sync: 'preferences.md', category: 'app-config' },
    settings: { paths: ['settings.json'], sync: 'settings.json', category: 'app-config' },
    plans: { paths: ['plans.json'], sync: 'plans.json', category: 'app-config' },
    notifications: { paths: ['notifications.json'], sync: 'notifications.json', category: 'app-config' },
    usage: { paths: ['usage'], sync: 'usage' },
    'article-parser': { paths: ['article-parser'], sync: 'article-parser', category: 'app-config' },
    'site-knowledge': { paths: ['site-knowledge'], sync: 'site-knowledge', category: 'app-config' },
    'run-history': { paths: ['run-history'], sync: 'run-history' },
    stocks: { paths: ['stocks'], sync: 'stocks' },
    feishu: { paths: ['feishu'], sync: 'feishu' },
    'sync-state': { paths: ['sync-state.json'] },
    'window-state': { paths: ['window-state.json'] },
    custom: { paths: ['custom'], sync: 'custom' },
    backups: { paths: ['backups'] },
    logs: { paths: ['logs'] },
    'ws-shadow-git': { paths: ['workspaces/{wsid}/shadow-git'] },
  };
  expect(new Set(DATA_ITEMS.map((i) => i.id))).toEqual(new Set(Object.keys(expected)));
  for (const [id, exp] of Object.entries(expected)) {
    const item = byId.get(id)!;
    expect(item.paths).toEqual(exp.paths);
    expect(item.syncItemId).toBe(exp.sync);
    expect(item.backupCategory).toBe(exp.category);
  }
});

test('数据字典展示字段：每条 name/description 非空，同步项外不标 sensitive', () => {
  for (const item of DATA_ITEMS) {
    expect(item.name.trim()).not.toBe('');
    expect(item.description.trim()).not.toBe('');
    expect(['required', 'optional', 'never']).toContain(syncStatusOf(item));
  }
});

test('审计修洞锁定：groups.json 归 notes-groups（I-2）、tasks 归位工作区子树实路径（I-1）、app-config 含三文件；ws-articles 已退役无条目', () => {
  const byId = new Map(DATA_ITEMS.map((i) => [i.id, i]));
  expect(byId.get('ws-groups-index')!.backupCategory).toBe('notes-groups');
  const tasks = byId.get('ws-tasks')!;
  expect(tasks.paths).toEqual(['workspaces/{wsid}/tasks.json']);
  expect(tasks.external).toBeUndefined();
  expect(tasks.syncItemId).toBe('tasks');
  // 文章库已退役：文章=工作区文件（dogear/articles/），不进应用同步/备份；
  // 习得资产 article-parser/site-knowledge 归 app-config（global scope）
  expect(byId.has('ws-articles')).toBe(false);
  const appConfigItems = DATA_ITEMS.filter((i) => i.backupCategory === 'app-config');
  const appConfigPaths = appConfigItems.flatMap((i) => i.paths);
  for (const f of ['settings.json', 'plans.json', 'notifications.json']) {
    expect(appConfigPaths).toContain(f);
  }
  // login-accounts.json 已从字典退役（遗留死条目），备份源随之摘除，禁运防线由 push-guard 硬编码承接
  expect(appConfigPaths).not.toContain('login-accounts.json');
});

test('已下线遗留文件不进 registry：dashboard.md 无条目', () => {
  expect(DATA_ITEMS.some((i) => i.paths.some((p) => p.includes('dashboard.md')))).toBe(false);
});

// ── 同步项派生：与 settings-types SYNC_ITEM_IDS 现状一致 ──

test('registrySyncItems 派生的同步项 id 集合 == SYNC_ITEM_IDS 的 15 项', () => {
  const registryIds = [...new Set(registrySyncItems().map((i) => i.syncItemId!))].sort();
  const legacyIds = SYNC_ITEM_IDS.map((m) => m.id).sort();
  expect(registryIds).toEqual(legacyIds);
  expect(registryIds).toHaveLength(15);
  expect(registryIds).toContain('tasks');
  expect(registryIds).not.toContain('articles');
  expect(registryIds).toContain('agent.md');
  expect(registryIds).toContain('preferences.md');
  expect(registryIds).toContain('custom');
});

// ── mergePolicy 锁定（对照 sync/apply.ts merge registry 现状）──

test('mergePolicy：settings 用 settings-fields，记录索引文件用 records，其余 file', () => {
  const byId = new Map(DATA_ITEMS.map((i) => [i.id, i]));
  expect(byId.get('settings')!.mergePolicy).toBe('settings-fields');
  for (const id of ['ws-groups-index', 'ws-conversations-index', 'workspaces-registry', 'plans', 'notifications']) {
    expect(byId.get(id)!.mergePolicy).toBe('records');
  }
  expect(byId.get('ws-sessions')!.mergePolicy).toBe('file');
});

// ── sensitiveRelPaths ──

test('sensitiveRelPaths：sync-state.json（配对密钥；login-accounts.json 已退役转硬编码禁运）', () => {
  expect(sensitiveRelPaths()).toEqual(['sync-state.json']);
});

// ── backupSourcesFor：notes-groups（含 I-2 补源，去 dashboard.md）──

test('backupSourcesFor notes-groups×ws：notes/groups/groups.json/conversations.json/config.json/agent.md 六源（ws-articles 已退役摘除），无 dashboard.md', async () => {
  const sources = await backupSourcesFor('notes-groups', 'ws1');
  const rels = sources.map((abs) => abs.slice(configDir().length + 1).split(path.sep).join('/'));
  expect(rels).toEqual([
    'workspaces/ws1/notes',
    'workspaces/ws1/groups',
    'workspaces/ws1/groups.json',
    'workspaces/ws1/conversations.json',
    'workspaces/ws1/config.json',
    'workspaces/ws1/agent.md',
  ]);
  expect(rels.some((r) => r.includes('articles'))).toBe(false);
  expect(rels.some((r) => r.includes('dashboard.md'))).toBe(false);
});

// ── backupSourcesFor：memory 双 scope ──

test('backupSourcesFor memory：ws scope 只含该工作区记忆，global scope 含全局 memory/', async () => {
  expect(await backupSourcesFor('memory', 'ws1')).toEqual([cfgPath('workspaces', 'ws1', 'memory')]);
  expect(await backupSourcesFor('memory', 'global')).toEqual([cfgPath('memory')]);
});

// ── backupSourcesFor：sessions 双 scope（全局 conversations 已退役摘除，global scope 收敛为不支持）──

test('backupSourcesFor sessions：ws scope 只含该工作区会话，global scope 不再支持', async () => {
  expect(await backupSourcesFor('sessions', 'ws1')).toEqual([cfgPath('workspaces', 'ws1', 'sessions')]);
  await expect(backupSourcesFor('sessions', 'global')).rejects.toThrow();
});

// ── backupSourcesFor：app-config 文件与目录（含习得资产 article-parser/site-knowledge）──

test('backupSourcesFor app-config×global：settings/plans/notifications + workspaces.json + agent.md + preferences + article-parser + site-knowledge', async () => {
  const sources = await backupSourcesFor('app-config', 'global');
  const rels = sources.map((abs) => abs.slice(configDir().length + 1).split(path.sep).join('/'));
  expect(rels).toEqual([
    'workspaces/workspaces.json',
    'agent.md',
    'preferences.md',
    'settings.json',
    'plans.json',
    'notifications.json',
    'article-parser',
    'site-knowledge',
  ]);
});

// ── backupSourcesFor：tasks 归位工作区 zip（旧外部锚点生成路径已摘，反解仅存量 zip 兼容）──

test('backupSourcesFor tasks：workspace scope 收该工作区实路径 tasks.json；global scope 不再支持', async () => {
  expect(await backupSourcesFor('tasks', 'ws1')).toEqual([cfgPath('workspaces', 'ws1', 'tasks.json')]);
  await expect(backupSourcesFor('tasks', 'global')).rejects.toThrow();
});

test('resolveArchiveRelPath：外部锚点条目（存量备份 zip 兼容）按 workspaces.json 反解', async () => {
  const wsDir = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-ext-ws-'));
  const wsA = path.join(wsDir, 'projectA');
  const wsB = path.join(wsDir, 'projectB');
  await fsp.mkdir(cfgPath('workspaces'), { recursive: true });
  await fsp.writeFile(
    cfgPath('workspaces', 'workspaces.json'),
    JSON.stringify({
      version: 1,
      workspaces: [
        { id: 'ws-a', name: 'A', path: wsA, additionalPaths: [], isDefault: true, createdAt: '2026-01-01T00:00:00Z' },
        { id: 'ws-b', name: 'B', path: wsB, additionalPaths: [], isDefault: false, createdAt: '2026-01-02T00:00:00Z' },
      ],
    }),
    'utf-8',
  );

  expect(await resolveArchiveRelPath(`${EXTERNAL_ANCHOR_PREFIX}/ws-a/.dogear/tasks.json`)).toBe(path.join(wsA, '.dogear', 'tasks.json'));
  expect(await resolveArchiveRelPath(`${EXTERNAL_ANCHOR_PREFIX}/ws-b/.dogear/tasks.json`)).toBe(path.join(wsB, '.dogear', 'tasks.json'));
  expect(await resolveArchiveRelPath(`${EXTERNAL_ANCHOR_PREFIX}/ws-x/.dogear/tasks.json`)).toBeNull();
  expect(await resolveArchiveRelPath(`${EXTERNAL_ANCHOR_PREFIX}/ws-a/../settings.json`)).toBeNull();
  await fsp.rm(wsDir, { recursive: true, force: true });
});

// ── toArchiveRelPath / resolveArchiveRelPath 往返 ──

test('普通条目：toArchiveRelPath 与 resolveArchiveRelPath 互逆', async () => {
  const source = cfgPath('workspaces', 'ws1', 'notes', 'a.md');
  const rel = toArchiveRelPath(source);
  expect(rel).toBe('workspaces/ws1/notes/a.md');
  expect(await resolveArchiveRelPath(rel)).toBe(source);
});

test('resolveArchiveRelPath 拒绝穿越/绝对/反斜杠/空段', async () => {
  expect(await resolveArchiveRelPath('../../evil.json')).toBeNull();
  expect(await resolveArchiveRelPath('workspaces/../evil.json')).toBeNull();
  expect(await resolveArchiveRelPath('notes/./x.md')).toBeNull();
  expect(await resolveArchiveRelPath('/abs/evil.json')).toBeNull();
  expect(await resolveArchiveRelPath('notes\\evil.json')).toBeNull();
  expect(await resolveArchiveRelPath('')).toBeNull();
});

// ── scope 校验 ──

test('scope 与分类不匹配或非法时抛错', async () => {
  await expect(backupSourcesFor('notes-groups', 'global')).rejects.toThrow();
  await expect(backupSourcesFor('app-config', 'ws1')).rejects.toThrow();
  await expect(backupSourcesFor('tasks', 'global')).rejects.toThrow();
  await expect(backupSourcesFor('memory', '../evil')).rejects.toThrow();
  await expect(backupSourcesFor('no-such-category' as never, 'global')).rejects.toThrow();
});

// ── 分类 scope 元数据与分类 key 完整性 ──

test('BACKUP_CATEGORY_SCOPES 覆盖全部分类 key', () => {
  expect(Object.keys(BACKUP_CATEGORY_SCOPES).sort()).toEqual([...BACKUP_CATEGORY_KEYS].sort());
});
