import { test, expect } from 'bun:test';

const {
  DATA_ITEMS,
  registrySyncItems,
  sensitiveRelPaths,
  syncStatusOf,
  syncItemMetas,
} = await import('./data-items.js');
const { SYNC_ITEM_IDS } = await import('./settings-types.js');

// ── 同步状态派生 ──

test('syncStatusOf：settings 必选、usage 可选、无 syncItemId 不同步', () => {
  const byId = new Map(DATA_ITEMS.map((i) => [i.id, i]));
  expect(syncStatusOf(byId.get('settings')!)).toBe('required');
  expect(syncStatusOf(byId.get('usage')!)).toBe('optional');
  expect(syncStatusOf(byId.get('sync-state')!)).toBe('never');
  expect(syncStatusOf(byId.get('ws-shadow-git')!)).toBe('never');
  expect(byId.get('ws-shadow-git')!.localListHidden).toBe(true);
});

// ── 字典完整性 ──

test('DATA_ITEMS：全量 28 条，字段完整且关键条目状态正确', () => {
  expect(DATA_ITEMS).toHaveLength(28);
  for (const item of DATA_ITEMS) {
    expect(item.name.trim()).not.toBe('');
    expect(item.description.trim()).not.toBe('');
    expect(item.paths.length).toBeGreaterThan(0);
    expect(['required', 'optional', 'never', 'always']).toContain(syncStatusOf(item));
  }
  const byId = new Map(DATA_ITEMS.map((i) => [i.id, i]));
  expect(syncStatusOf(byId.get('settings')!)).toBe('required');
  expect(syncStatusOf(byId.get('custom')!)).toBe('optional');
  expect(byId.get('sync-state')!.sensitive).toBe(true);
  expect(byId.get('ws-notes')!.sensitive).toBeUndefined();
});

// ── 同步项元数据派生（settings-types SYNC_ITEM_IDS 的数据源）──

test('syncItemMetas：15 项去重、id 集合与 registrySyncItems 一致、settings.json 必选', () => {
  const metas = syncItemMetas();
  expect(metas).toHaveLength(15);
  const ids = metas.map((m) => m.id);
  expect(new Set(ids).size).toBe(15);
  const registryIds = [...new Set(registrySyncItems().map((i) => i.syncItemId!))].sort();
  expect([...ids].sort()).toEqual(registryIds);
  expect(metas.find((m) => m.id === 'settings.json')?.required).toBe(true);
  expect(metas.find((m) => m.id === 'custom')).toMatchObject({ name: '自定义资源', description: '自定义技能、提示词模板与扩展脚本副本' });
  for (const m of metas) {
    expect(m.name.trim()).not.toBe('');
    expect(m.description.trim()).not.toBe('');
  }
});

test('syncItemMetas：共享组首条目的 syncName/syncDescription 覆盖生效（workspaces/memory）', () => {
  const metas = syncItemMetas();
  expect(metas.find((m) => m.id === 'workspaces')).toMatchObject({ name: '工作区数据' });
  expect(metas.find((m) => m.id === 'memory')).toMatchObject({ name: '记忆库' });
  expect(metas.find((m) => m.id === 'tasks')).toMatchObject({ name: '任务' });
  // ws-articles 已退役（文章=工作区文件，跨设备走用户 git/勾选子树）：字典无条目、无 articles 同步项
  expect(metas.find((m) => m.id === 'articles')).toBeUndefined();
});

test('SYNC_ITEM_IDS 与派生函数同源同值（cast 护栏）', () => {
  expect(JSON.stringify(SYNC_ITEM_IDS)).toEqual(JSON.stringify(syncItemMetas()));
});

test('敏感路径白名单：配对密钥（sync push-guard 消费；login-accounts.json 已退役转硬编码禁运）', () => {
  expect(sensitiveRelPaths()).toEqual(['sync-state.json']);
});
