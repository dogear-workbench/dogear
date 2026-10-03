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
    'ws-tasks': { paths: [`${EXTERNAL_ANCHOR_PREFIX}/{wsid}/.dogear/tasks.json`], category: 'tasks' },
    memory: { paths: ['memory'], sync: 'memory', category: 'memory' },
    conversations: { paths: ['conversations'], sync: 'conversations', category: 'sessions' },
    'workspaces-registry': { paths: ['workspaces/workspaces.json'], sync: 'workspaces', category: 'app-config' },
    'agent-md': { paths: ['agent.md'], category: 'app-config' },
    settings: { paths: ['settings.json'], sync: 'settings.json', category: 'app-config' },
    plans: { paths: ['plans.json'], sync: 'plans.json', category: 'app-config' },
    notifications: { paths: ['notifications.json'], sync: 'notifications.json', category: 'app-config' },
    'login-accounts': { paths: ['login-accounts.json'], category: 'app-config' },
    usage: { paths: ['usage'], sync: 'usage' },
    'article-parser': { paths: ['article-parser'], sync: 'article-parser' },
    'site-knowledge': { paths: ['site-knowledge'], sync: 'site-knowledge' },
    'run-history': { paths: ['run-history'], sync: 'run-history' },
    stocks: { paths: ['stocks'], sync: 'stocks' },
    feishu: { paths: ['feishu'], sync: 'feishu' },
  };
  expect(new Set(DATA_ITEMS.map((i) => i.id))).toEqual(new Set(Object.keys(expected)));
  for (const [id, exp] of Object.entries(expected)) {
    const item = byId.get(id)!;
    expect(item.paths).toEqual(exp.paths);
    expect(item.syncItemId).toBe(exp.sync);
    expect(item.backupCategory).toBe(exp.category);
  }
});

test('审计修洞锁定：groups.json 归 notes-groups（I-2）、tasks 走外部锚点（I-1）、app-config 含四文件', () => {
  const byId = new Map(DATA_ITEMS.map((i) => [i.id, i]));
  expect(byId.get('ws-groups-index')!.backupCategory).toBe('notes-groups');
  const tasks = byId.get('ws-tasks')!;
  expect(tasks.external).toBe('workspace-tasks');
  expect(tasks.syncItemId).toBeUndefined();
  const appConfigItems = DATA_ITEMS.filter((i) => i.backupCategory === 'app-config');
  const appConfigPaths = appConfigItems.flatMap((i) => i.paths);
  for (const f of ['settings.json', 'plans.json', 'notifications.json', 'login-accounts.json']) {
    expect(appConfigPaths).toContain(f);
  }
  expect(appConfigItems.find((i) => i.id === 'login-accounts')!.sensitive).toBe(true);
});

test('已下线遗留文件不进 registry：dashboard.md 无条目', () => {
  expect(DATA_ITEMS.some((i) => i.paths.some((p) => p.includes('dashboard.md')))).toBe(false);
});

// ── 同步项派生：与 settings-types SYNC_ITEM_IDS 现状一致 ──

test('registrySyncItems 派生的同步项 id 集合 == SYNC_ITEM_IDS 的 12 项', () => {
  const registryIds = [...new Set(registrySyncItems().map((i) => i.syncItemId!))].sort();
  const legacyIds = SYNC_ITEM_IDS.map((m) => m.id).sort();
  expect(registryIds).toEqual(legacyIds);
  expect(registryIds).toHaveLength(12);
});

// ── mergePolicy 锁定（对照 sync/apply.ts merge registry 现状）──

test('mergePolicy：settings 用 settings-fields，记录索引文件用 records，其余 file', () => {
  const byId = new Map(DATA_ITEMS.map((i) => [i.id, i]));
  expect(byId.get('settings')!.mergePolicy).toBe('settings-fields');
  for (const id of ['ws-groups-index', 'ws-conversations-index', 'workspaces-registry', 'plans', 'notifications']) {
    expect(byId.get(id)!.mergePolicy).toBe('records');
  }
  expect(byId.get('login-accounts')!.mergePolicy).toBe('file');
  expect(byId.get('ws-sessions')!.mergePolicy).toBe('file');
});

// ── sensitiveRelPaths ──

test('sensitiveRelPaths：login-accounts.json', () => {
  expect(sensitiveRelPaths()).toEqual(['login-accounts.json']);
});

// ── backupSourcesFor：notes-groups（含 I-2 补源，去 dashboard.md）──

test('backupSourcesFor notes-groups×ws：notes/groups/groups.json/conversations.json/config.json/agent.md 六源，无 dashboard.md', async () => {
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
  expect(rels.some((r) => r.includes('dashboard.md'))).toBe(false);
});

// ── backupSourcesFor：memory 双 scope ──

test('backupSourcesFor memory：ws scope 只含该工作区记忆，global scope 含全局 memory/', async () => {
  expect(await backupSourcesFor('memory', 'ws1')).toEqual([cfgPath('workspaces', 'ws1', 'memory')]);
  expect(await backupSourcesFor('memory', 'global')).toEqual([cfgPath('memory')]);
});

// ── backupSourcesFor：sessions 双 scope（step6 拆分：全局 conversations 单独归 global）──

test('backupSourcesFor sessions：ws scope 只含该工作区会话，global scope 含全局 conversations/', async () => {
  expect(await backupSourcesFor('sessions', 'ws1')).toEqual([cfgPath('workspaces', 'ws1', 'sessions')]);
  expect(await backupSourcesFor('sessions', 'global')).toEqual([cfgPath('conversations')]);
});

// ── backupSourcesFor：app-config 四文件 + 注册表 + agent.md ──

test('backupSourcesFor app-config×global：settings/plans/notifications/login-accounts + workspaces.json + agent.md', async () => {
  const sources = await backupSourcesFor('app-config', 'global');
  const rels = sources.map((abs) => abs.slice(configDir().length + 1).split(path.sep).join('/'));
  expect(rels).toEqual([
    'workspaces/workspaces.json',
    'agent.md',
    'settings.json',
    'plans.json',
    'notifications.json',
    'login-accounts.json',
  ]);
});

// ── backupSourcesFor：tasks 外部锚点（I-1 修复核心）──

test('backupSourcesFor tasks×global：读 workspaces.json 展开各工作区外部 tasks.json 虚拟路径', async () => {
  expect(await backupSourcesFor('tasks', 'global')).toEqual([]);

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

  const sources = await backupSourcesFor('tasks', 'global');
  expect(sources).toEqual([
    cfgPath(EXTERNAL_ANCHOR_PREFIX, 'ws-a', '.dogear', 'tasks.json'),
    cfgPath(EXTERNAL_ANCHOR_PREFIX, 'ws-b', '.dogear', 'tasks.json'),
  ]);

  expect(await resolveArchiveRelPath(`${EXTERNAL_ANCHOR_PREFIX}/ws-a/.dogear/tasks.json`)).toBe(path.join(wsA, '.dogear', 'tasks.json'));
  expect(await resolveArchiveRelPath(`${EXTERNAL_ANCHOR_PREFIX}/ws-b/.dogear/tasks.json`)).toBe(path.join(wsB, '.dogear', 'tasks.json'));
  expect(await resolveArchiveRelPath(`${EXTERNAL_ANCHOR_PREFIX}/ws-x/.dogear/tasks.json`)).toBeNull();
  expect(await resolveArchiveRelPath(`${EXTERNAL_ANCHOR_PREFIX}/ws-a/../settings.json`)).toBeNull();
});

test('workspaces.json 损坏/为空时外部锚点退化为空列表', async () => {
  await fsp.writeFile(cfgPath('workspaces', 'workspaces.json'), 'not-json{{', 'utf-8');
  expect(await backupSourcesFor('tasks', 'global')).toEqual([]);
  await fsp.writeFile(cfgPath('workspaces', 'workspaces.json'), JSON.stringify({ version: 1, workspaces: [] }), 'utf-8');
  expect(await backupSourcesFor('tasks', 'global')).toEqual([]);
  await fsp.rm(cfgPath('workspaces', 'workspaces.json'));
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
  await expect(backupSourcesFor('tasks', 'ws1')).rejects.toThrow();
  await expect(backupSourcesFor('memory', '../evil')).rejects.toThrow();
  await expect(backupSourcesFor('no-such-category' as never, 'global')).rejects.toThrow();
});

// ── 分类 scope 元数据与分类 key 完整性 ──

test('BACKUP_CATEGORY_SCOPES 覆盖全部分类 key', () => {
  expect(Object.keys(BACKUP_CATEGORY_SCOPES).sort()).toEqual([...BACKUP_CATEGORY_KEYS].sort());
});
