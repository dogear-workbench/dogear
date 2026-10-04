import { test, expect, mock } from 'bun:test';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { AppSettings, SyncOptions } from '../settings-types.js';

// 隔离配置目录：防止意外触发 loadSettings/saveSettings 时读写真实项目 .dogear/settings.json
process.env.DOGEAR_CONFIG_DIR = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-sync-opts-'));

// apply.ts / settings-service.ts 静态 import 链（→ settings-service / sync-state / device）顶层拉进
// electron 的命名导入，bun test 下 CJS interop 无 'app' 命名导出会炸；先 mock 再动态加载（同 exclude.test.ts）
mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir() }, nativeTheme: {} },
  app: { getPath: () => tmpdir() },
  nativeTheme: {},
}));

const { computeMergedSettings } = await import('./apply.js');
const { excludesFromSyncOptions } = await import('./manifest.js');
const { getOrCreateDeviceId } = await import('./device.js');
const { applySyncOptionsPatch } = await import('../settings-service.js');
const {
  normalizeSyncOptions,
  normalizeDisabledSyncItems,
  SYNC_ITEM_IDS,
  SETTINGS_SYNC_FIELDS,
  DEFAULT_SETTINGS,
} = await import('../settings-types.js');

function syncOpts(over: Partial<SyncOptions> = {}): SyncOptions {
  return {
    deviceName: 'local-device',
    syncStocksData: false,
    syncFeishu: false,
    pairedDevices: [{ deviceId: 'dev-a', secret: 'a'.repeat(64), pairedAt: 1 }],
    disabledSyncItems: [],
    syncConflictCopies: false,
    syncShadowGit: false,
    syncOptionsRev: 0,
    ...over,
  };
}

function settingsOf(sync: SyncOptions): AppSettings {
  return { ...structuredClone(DEFAULT_SETTINGS), syncOptions: sync };
}

/** computeMergedSettings 便捷调用：incoming 用原始 JSON 形态（对端不可信输入），local 注入不走磁盘；返回合并后 syncOptions 节 */
async function merge(incomingSync: unknown, localSync: SyncOptions): Promise<SyncOptions> {
  const m = await computeMergedSettings({ syncOptions: incomingSync }, { localSyncOptions: localSync });
  return m.syncOptions!;
}

// ── computeMergedSettings：范围字段整组取 rev 大的一端 ──

test('对端 rev 大 → 范围字段整组取对端（原子替换，deviceName 仍保本端）', async () => {
  const local = syncOpts({ syncOptionsRev: 1 });
  const incoming = syncOpts({
    deviceName: 'remote-device',
    syncStocksData: true,
    syncFeishu: true,
    disabledSyncItems: ['memory'],
    syncConflictCopies: true,
    syncShadowGit: true,
    syncOptionsRev: 2,
  });
  const m = await merge(incoming, local);
  expect(m.syncStocksData).toBe(true);
  expect(m.syncFeishu).toBe(true);
  expect(m.disabledSyncItems).toEqual(['memory']);
  expect(m.syncConflictCopies).toBe(true);
  expect(m.syncShadowGit).toBe(true);
  expect(m.syncOptionsRev).toBe(2);
  // deviceName 不参与 rev 组：对端 rev 更大也保本端
  expect(m.deviceName).toBe('local-device');
});

test('本端 rev 大 → 范围字段保本端（对端旧配置不夺权）', async () => {
  const local = syncOpts({ syncStocksData: true, disabledSyncItems: ['usage'], syncOptionsRev: 5 });
  const incoming = syncOpts({ syncStocksData: false, disabledSyncItems: ['memory'], syncOptionsRev: 2 });
  const m = await merge(incoming, local);
  expect(m.syncStocksData).toBe(true);
  expect(m.syncFeishu).toBe(false);
  expect(m.disabledSyncItems).toEqual(['usage']);
  expect(m.syncConflictCopies).toBe(false);
  expect(m.syncShadowGit).toBe(false);
  expect(m.syncOptionsRev).toBe(5);
});

test('rev 相同但内容不同 → 保本端（离线竞态降级，不产生副本）', async () => {
  const local = syncOpts({ syncStocksData: true, syncShadowGit: true, syncOptionsRev: 3 });
  const incoming = syncOpts({ syncStocksData: false, syncShadowGit: false, syncOptionsRev: 3 });
  const m = await merge(incoming, local);
  expect(m.syncStocksData).toBe(true);
  expect(m.syncShadowGit).toBe(true);
  expect(m.syncOptionsRev).toBe(3);
});

test('rev 缺省（旧数据）按 0 处理：双向', async () => {
  // 对端旧数据无 rev 键（按 0），本端 rev=1 → 保本端
  const local = syncOpts({ syncConflictCopies: true, syncOptionsRev: 1 });
  const oldRemote = {
    deviceName: 'remote-device',
    syncStocksData: true,
    syncFeishu: false,
    pairedDevices: [],
    disabledSyncItems: ['memory'],
    syncConflictCopies: false,
    syncShadowGit: false,
  };
  const m1 = await merge(oldRemote, local);
  expect(m1.syncConflictCopies).toBe(true);
  expect(m1.syncOptionsRev).toBe(1);

  // 本端旧数据无 rev（按 0），对端 rev=1 → 对端整组胜
  const localNoRev = syncOpts();
  delete (localNoRev as Record<string, unknown>).syncOptionsRev;
  const newerRemote = { ...oldRemote, syncOptionsRev: 1, disabledSyncItems: ['plans.json'] };
  const m2 = await merge(newerRemote, localNoRev);
  expect(m2.disabledSyncItems).toEqual(['plans.json']);
  expect(m2.syncOptionsRev).toBe(1);
  expect(m2.syncStocksData).toBe(true);
});

test('采纳对端范围后以合并结果再同步 → 稳定收敛不拉扯', async () => {
  const local = syncOpts({ syncOptionsRev: 0 });
  const incoming = syncOpts({ deviceName: 'remote-device', syncStocksData: true, syncOptionsRev: 3 });
  const m = await merge(incoming, local);
  expect(m.syncStocksData).toBe(true);
  const m2 = await merge(incoming, m);
  expect(m2.syncStocksData).toBe(true);
  expect(m2.syncOptionsRev).toBe(3);
});

// ── computeMergedSettings：deviceName / pairedDevices 不受 rev 影响 ──

test('deviceName 恒保本端、pairedDevices 并集照旧（rev 差距再大也不变）', async () => {
  const local = syncOpts({
    deviceName: 'LocalDev',
    syncOptionsRev: 0,
    pairedDevices: [{ deviceId: 'dev-a', secret: 'a'.repeat(64), pairedAt: 1 }],
  });
  const incoming = syncOpts({
    deviceName: 'RemoteDev',
    syncOptionsRev: 99,
    pairedDevices: [{ deviceId: 'dev-b', secret: 'b'.repeat(64), pairedAt: 2 }],
  });
  const m = await merge(incoming, local);
  expect(m.deviceName).toBe('LocalDev');
  expect(m.pairedDevices.map((d) => d.deviceId).sort()).toEqual(['dev-a', 'dev-b']);
});

test('pairedDevices：secret 冲突取本端、剔除自身条目（现状行为保持）', async () => {
  const selfId = await getOrCreateDeviceId();
  const local = syncOpts({
    pairedDevices: [{ deviceId: 'dev-a', secret: 'a'.repeat(64), pairedAt: 1 }],
  });
  const incoming = syncOpts({
    pairedDevices: [
      { deviceId: 'dev-a', secret: 'f'.repeat(64), pairedAt: 99 }, // secret 冲突
      { deviceId: selfId, secret: 'e'.repeat(64), pairedAt: 98 }, // 自身条目
    ],
  });
  const m = await merge(incoming, local);
  const byId = new Map(m.pairedDevices.map((d) => [d.deviceId, d]));
  expect(byId.get('dev-a')?.secret).toBe('a'.repeat(64));
  expect(byId.has(selfId)).toBe(false);
});

// ── normalizeSyncOptions / normalizeDisabledSyncItems ──

test('normalizeSyncOptions：范围字段缺省默认值（[]/false/false/{}/0）', () => {
  const n = normalizeSyncOptions({});
  expect(n.deviceName).toBe('');
  expect(n.syncStocksData).toBe(false);
  expect(n.syncFeishu).toBe(false);
  expect(n.pairedDevices).toEqual([]);
  expect(n.disabledSyncItems).toEqual([]);
  expect(n.syncConflictCopies).toBe(false);
  expect(n.syncShadowGit).toBe(false);
  expect(n.userSyncPaths).toEqual({});
  expect(n.syncOptionsRev).toBe(0);
});

test('normalizeSyncOptions：非法 id 滤除（含路径穿越形态）+ 去重，required 必选项（settings.json）强制滤除（U6）', () => {
  const n = normalizeSyncOptions({
    disabledSyncItems: ['memory', 'memory', '../evil', 'stocks/../x', 42, null, 'usage', 'settings.json'],
  });
  expect(n.disabledSyncItems).toEqual(['memory', 'usage']);
  // rev 大的对端不得经 disabledSyncItems 关闭本端必选同步项
  const onlyRequired = normalizeSyncOptions({ disabledSyncItems: ['settings.json'] });
  expect(onlyRequired.disabledSyncItems).toEqual([]);
});

test('normalizeSyncOptions：rev 仅接受非负整数，非法归 0', () => {
  expect(normalizeSyncOptions({ syncOptionsRev: 7 }).syncOptionsRev).toBe(7);
  expect(normalizeSyncOptions({ syncOptionsRev: -1 }).syncOptionsRev).toBe(0);
  expect(normalizeSyncOptions({ syncOptionsRev: 1.5 }).syncOptionsRev).toBe(0);
  expect(normalizeSyncOptions({ syncOptionsRev: '3' }).syncOptionsRev).toBe(0);
  expect(normalizeSyncOptions({ syncOptionsRev: Number.NaN }).syncOptionsRev).toBe(0);
});

test('normalizeSyncOptions：非对象输入 / syncOptions 非对象 → 全默认', () => {
  expect(normalizeSyncOptions(null).disabledSyncItems).toEqual([]);
  expect(normalizeSyncOptions('x').syncConflictCopies).toBe(false);
  expect(normalizeSyncOptions([]).pairedDevices).toEqual([]);
});

test('normalizeDisabledSyncItems：非数组输入返回空数组', () => {
  expect(normalizeDisabledSyncItems('memory')).toEqual([]);
  expect(normalizeDisabledSyncItems({ 0: 'memory' })).toEqual([]);
});

test('normalizeSyncOptions：userSyncPaths 值非数组的键丢弃，条目反斜杠/./ 前缀/首尾斜杠归一、去重、空串丢弃', () => {
  const n = normalizeSyncOptions({
    userSyncPaths: {
      'ws-a': ['docs\\plans', './notes/', 'docs/plans', 'docs/plans/', '', 42, null, 'src'],
      'ws-b': 'not-an-array',
      '': ['x'],
    },
  });
  expect(n.userSyncPaths).toEqual({ 'ws-a': ['docs/plans', 'notes', 'src'] });
});

test('normalizeSyncOptions：userSyncPaths 非对象输入返回空对象，合法空数组键保留', () => {
  expect(normalizeSyncOptions(null).userSyncPaths).toEqual({});
  expect(normalizeSyncOptions('x').userSyncPaths).toEqual({});
  expect(normalizeSyncOptions([]).userSyncPaths).toEqual({});
  expect(normalizeSyncOptions({ userSyncPaths: { 'ws-a': [] } }).userSyncPaths).toEqual({ 'ws-a': [] });
});

// ── applySyncOptionsPatch：rev 自增维护 ──

test('范围字段实际变化 → rev 自增（五个 rev 组字段逐一触发）', () => {
  let cur = syncOpts({ syncOptionsRev: 4 });
  cur = applySyncOptionsPatch(cur, { disabledSyncItems: ['usage'] });
  expect(cur.syncOptionsRev).toBe(5);
  cur = applySyncOptionsPatch(cur, { syncConflictCopies: true });
  expect(cur.syncOptionsRev).toBe(6);
  cur = applySyncOptionsPatch(cur, { syncShadowGit: true });
  expect(cur.syncOptionsRev).toBe(7);
  cur = applySyncOptionsPatch(cur, { syncStocksData: true });
  expect(cur.syncOptionsRev).toBe(8);
  cur = applySyncOptionsPatch(cur, { syncFeishu: true });
  expect(cur.syncOptionsRev).toBe(9);
  expect(cur.syncFeishu).toBe(true);
});

test('仅 deviceName / removeDeviceId → rev 不动', () => {
  const cur = syncOpts({ syncOptionsRev: 7 });
  const n = applySyncOptionsPatch(cur, { deviceName: 'new-name', removeDeviceId: 'dev-a' });
  expect(n.syncOptionsRev).toBe(7);
  expect(n.deviceName).toBe('new-name');
  expect(n.pairedDevices).toEqual([]);
});

test('传相同值（幂等保存）→ rev 不动', () => {
  const cur = syncOpts({ disabledSyncItems: ['usage'], syncConflictCopies: true, syncOptionsRev: 2 });
  const n = applySyncOptionsPatch(cur, { disabledSyncItems: ['usage'], syncConflictCopies: true });
  expect(n.syncOptionsRev).toBe(2);
  expect(n.syncConflictCopies).toBe(true);
});

test('disabledSyncItems 集合相等但顺序不同 → rev 不动（语义是集合）', () => {
  const cur = syncOpts({ disabledSyncItems: ['usage', 'memory'], syncOptionsRev: 2 });
  const n = applySyncOptionsPatch(cur, { disabledSyncItems: ['memory', 'usage'] });
  expect(n.syncOptionsRev).toBe(2);
  expect(n.disabledSyncItems).toEqual(['memory', 'usage']);
});

test('patch 含非法 id：清洗后与旧值相同 → rev 不动；清洗后有实际变化 → rev 动', () => {
  const cur = syncOpts({ disabledSyncItems: ['usage', 'memory'], syncOptionsRev: 2 });
  const same = applySyncOptionsPatch(cur, { disabledSyncItems: ['memory', 'usage', '../evil'] });
  expect(same.syncOptionsRev).toBe(2);
  const changed = applySyncOptionsPatch(cur, { disabledSyncItems: ['memory', 'plans.json', '../evil'] });
  expect(changed.syncOptionsRev).toBe(3);
  expect(changed.disabledSyncItems).toEqual(['memory', 'plans.json']);
});

test('rev 缺省（旧数据）从 0 起增', () => {
  const cur = syncOpts();
  delete (cur as Record<string, unknown>).syncOptionsRev;
  const n = applySyncOptionsPatch(cur, { syncShadowGit: true });
  expect(n.syncOptionsRev).toBe(1);
  expect(n.syncShadowGit).toBe(true);
});

// ── excludesFromSyncOptions：settings → ManifestExcludes 语义转换 ──

test('excludesFromSyncOptions：true=同步 直传（无翻转），disabledItems 转 Set，optionalDirs 同向，缺省=全排除', () => {
  const ex = excludesFromSyncOptions(
    syncOpts({ syncConflictCopies: true, syncShadowGit: true, disabledSyncItems: ['usage', 'plans.json'], syncStocksData: true }),
  );
  expect(ex.conflictCopies).toBe(true);
  expect(ex.shadowGit).toBe(true);
  expect([...ex.disabledItems].sort()).toEqual(['plans.json', 'usage']);
  expect(ex.optionalDirs).toEqual({ stocks: true, feishu: false });

  // 缺省（三开关 false）：shadow-git 与 .conflict-* 与 stocks/feishu 均被排除（设计默认不同步）
  const dflt = excludesFromSyncOptions(undefined);
  expect(dflt.conflictCopies).toBe(false);
  expect(dflt.shadowGit).toBe(false);
  expect(dflt.disabledItems.size).toBe(0);
  expect(dflt.optionalDirs).toEqual({ stocks: false, feishu: false });
});

// ── SYNC_ITEM_IDS 白名单常量 ──

test('SYNC_ITEM_IDS：14 项、id 唯一、settings.json 标必选、含 stocks/feishu/tasks/articles', () => {
  expect(SYNC_ITEM_IDS).toHaveLength(14);
  const ids = SYNC_ITEM_IDS.map((m) => m.id);
  expect(new Set(ids).size).toBe(14);
  for (const expected of [
    'workspaces', 'conversations', 'memory', 'usage', 'article-parser', 'site-knowledge', 'run-history',
    'tasks', 'articles', 'settings.json', 'plans.json', 'notifications.json', 'stocks', 'feishu',
  ]) {
    expect(ids).toContain(expected);
  }
  expect(SYNC_ITEM_IDS.find((m) => m.id === 'settings.json')?.required).toBe(true);
});

// ── SETTINGS_SYNC_FIELDS 传播白名单常量（Step 5 逐字段核对定稿，17 顶层字段全覆盖） ──

test('SETTINGS_SYNC_FIELDS 定稿：9 项通用偏好，不含保本端字段', () => {
  expect([...SETTINGS_SYNC_FIELDS].sort()).toEqual([
    'ai',
    'appearance',
    'basicToolPermissions',
    'browserSearchEngine',
    'failover',
    'paymentBlockedHosts',
    'subAgent',
    'update',
    'webAiSites',
  ]);
  for (const localOnly of ['snapshot', 'backup', 'ui', 'profiles', 'browserProxyServer', 'webMcpApiKey', 'migrated', 'syncOptions']) {
    expect(SETTINGS_SYNC_FIELDS).not.toContain(localOnly);
  }
});
