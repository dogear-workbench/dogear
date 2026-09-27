import { test, expect } from 'bun:test';
import {
  mergeArrayFile,
  mergeRecordMapFile,
  mergeWorkspacesFile,
  pickNewerEntry,
  timeOf,
} from './merge-records.js';

// ── 验收点 1：双端各自新增条目 → 并集，无丢失 ──

test('conversations.json Record 型：双端各自新增 → 并集', () => {
  const local = {
    version: 2,
    conversations: {
      a: { id: 'a', title: 'A', updatedAt: '2026-09-27T10:00:00.000Z' },
    },
  };
  const remote = {
    version: 2,
    conversations: {
      b: { id: 'b', title: 'B', updatedAt: '2026-09-27T11:00:00.000Z' },
    },
  };
  const merged = mergeRecordMapFile(local, remote, 'conversations') as {
    conversations: Record<string, unknown>;
  };
  expect(Object.keys(merged.conversations).sort()).toEqual(['a', 'b']);
});

test('plans.json / groups.json / notifications.json 数组型：双端各自新增 → 并集', () => {
  const local = { version: 2, tasks: [{ id: 't1', title: '1', updatedAt: '2026-09-27T10:00:00.000Z' }] };
  const remote = { version: 2, tasks: [{ id: 't2', title: '2', updatedAt: '2026-09-27T11:00:00.000Z' }] };
  const merged = mergeArrayFile(local, remote, 'tasks', 'id') as { tasks: Array<{ id: string }> };
  expect(merged.tasks.map((t) => t.id).sort()).toEqual(['t1', 't2']);

  const gl = { version: 2, groups: [{ id: 'g1', createdAt: 1000, updatedAt: 1000 }] };
  const gr = { version: 2, groups: [{ id: 'g2', createdAt: 2000, updatedAt: 2000 }] };
  const gm = mergeArrayFile(gl, gr, 'groups', 'id') as { groups: Array<{ id: string }> };
  expect(gm.groups.map((g) => g.id).sort()).toEqual(['g1', 'g2']);

  const nl = { version: 1, entries: [{ id: 'n1', createdAt: '2026-09-27T10:00:00.000Z' }] };
  const nr = { version: 1, entries: [{ id: 'n2', createdAt: '2026-09-27T11:00:00.000Z' }] };
  const nm = mergeArrayFile(nl, nr, 'entries', 'id') as { entries: Array<{ id: string }> };
  expect(nm.entries.map((n) => n.id).sort()).toEqual(['n1', 'n2']);
});

// ── 验收点 2：同 id 不同内容 → updatedAt 新者胜 ──

test('同 id 取 updatedAt 新者（ISO 字符串与毫秒数两种时间形态）', () => {
  const local = {
    version: 2,
    conversations: { a: { id: 'a', title: 'local-old', updatedAt: '2026-09-27T08:00:00.000Z' } },
  };
  const remote = {
    version: 2,
    conversations: { a: { id: 'a', title: 'remote-new', updatedAt: '2026-09-27T09:00:00.000Z' } },
  };
  const m1 = mergeRecordMapFile(local, remote, 'conversations') as { conversations: Record<string, { title: string }> };
  expect(m1.conversations.a.title).toBe('remote-new');
  // 交换方向：对端旧 → 仍取新者（不随同步方向漂移）
  const m2 = mergeRecordMapFile(remote, local, 'conversations') as { conversations: Record<string, { title: string }> };
  expect(m2.conversations.a.title).toBe('remote-new');

  const gl = { version: 2, groups: [{ id: 'g', createdAt: 1000, updatedAt: 5000 }] };
  const gr = { version: 2, groups: [{ id: 'g', createdAt: 1000, updatedAt: 3000 }] };
  const gm = mergeArrayFile(gl, gr, 'groups', 'id') as { groups: Array<{ updatedAt: number }> };
  expect(gm.groups[0].updatedAt).toBe(5000);
});

test('updatedAt 缺失 fallback createdAt（notifications 无 updatedAt）；两者皆无 → 保本端', () => {
  // notifications：同 id，对端 createdAt 更新 → 取对端
  const nl = { version: 1, entries: [{ id: 'n', createdAt: '2026-09-27T08:00:00.000Z' }] };
  const nr = { version: 1, entries: [{ id: 'n', createdAt: '2026-09-27T09:00:00.000Z' }] };
  const nm = mergeArrayFile(nl, nr, 'entries', 'id') as { entries: Array<{ createdAt: string }> };
  expect(nm.entries[0].createdAt).toBe('2026-09-27T09:00:00.000Z');

  const m = pickNewerEntry({ id: 'x' }, { id: 'x', extra: 1 });
  expect(m).toEqual({ id: 'x' });
});

test('无效时间值视为最旧；结构异常返回 null（降级信号）', () => {
  expect(timeOf('not-a-date')).toBe(-Infinity);
  expect(timeOf(undefined)).toBe(-Infinity);

  const bad = { version: 2, tasks: 'not-an-array' };
  expect(mergeArrayFile(bad, { version: 2, tasks: [] }, 'tasks', 'id')).toBeNull();
  expect(mergeArrayFile({ version: 2, tasks: [] }, bad, 'tasks', 'id')).toBeNull();
  expect(mergeRecordMapFile(null, { conversations: {} }, 'conversations')).toBeNull();
  expect(mergeRecordMapFile({ conversations: {} }, [1, 2], 'conversations')).toBeNull();
});

// ── 验收点 3：workspaces.json 并集 + 机器亲和字段 ──

test('workspaces.json：本端注册新工作区、对端注册另一工作区 → 两端条目并集', () => {
  const local = {
    version: 1,
    workspaces: [
      { id: 'ws-local', name: '本端项目', path: 'C:\\dogear', additionalPaths: [], isDefault: true, createdAt: '2026-09-01T00:00:00.000Z' },
    ],
  };
  const remote = {
    version: 1,
    workspaces: [
      { id: 'ws-remote', name: '对端项目', path: '/Users/mac/dogear', additionalPaths: [], isDefault: true, createdAt: '2026-09-02T00:00:00.000Z' },
    ],
  };
  const merged = mergeWorkspacesFile(local, remote) as { workspaces: Array<{ id: string; path: string; isDefault: boolean }> };
  expect(merged.workspaces.map((w) => w.id).sort()).toEqual(['ws-local', 'ws-remote']);
  // 各自 path/isDefault 不被对端覆盖（并集下互不冲突，均保留原值）
  const byId = new Map(merged.workspaces.map((w) => [w.id, w]));
  expect(byId.get('ws-local').path).toBe('C:\\dogear');
  expect(byId.get('ws-remote').path).toBe('/Users/mac/dogear');
});

test('workspaces.json 同 id：path/additionalPaths/isDefault 保本端，name/createdAt 取更早一侧', () => {
  const local = {
    version: 1,
    workspaces: [
      {
        id: 'ws1',
        name: '后来的名字',
        path: 'C:\\dogear',
        additionalPaths: [{ path: 'C:\\extra', enabled: true }],
        isDefault: true,
        createdAt: '2026-09-10T00:00:00.000Z',
      },
    ],
  };
  const remote = {
    version: 1,
    workspaces: [
      {
        id: 'ws1',
        name: '最初的名字',
        path: '/Users/mac/dogear',
        additionalPaths: [],
        isDefault: false,
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ],
  };
  const merged = mergeWorkspacesFile(local, remote) as { workspaces: Array<Record<string, unknown>> };
  expect(merged.workspaces).toHaveLength(1);
  const ws = merged.workspaces[0];
  expect(ws.path).toBe('C:\\dogear'); // 机器亲和：保本端
  expect(ws.additionalPaths).toEqual([{ path: 'C:\\extra', enabled: true }]);
  expect(ws.isDefault).toBe(true);
  expect(ws.name).toBe('最初的名字'); // createdAt 更早一侧的名字
  expect(ws.createdAt).toBe('2026-09-01T00:00:00.000Z');
  // 交换本端/对端后机器亲和字段仍保「当时的本端」
  const merged2 = mergeWorkspacesFile(remote, local) as { workspaces: Array<Record<string, unknown>> };
  expect(merged2.workspaces[0].path).toBe('/Users/mac/dogear');
  expect(merged2.workspaces[0].isDefault).toBe(false);
  expect(merged2.workspaces[0].name).toBe('最初的名字'); // name/createdAt 取更早，与方向无关 → 收敛一致
});

// ── 验收点 4：合并幂等 ──

test('合并幂等：merge(merge(a,b),b) 深度等于 merge(a,b)', () => {
  const a = {
    version: 2,
    conversations: {
      a: { id: 'a', title: 'A1', updatedAt: '2026-09-27T10:00:00.000Z' },
      b: { id: 'b', title: 'B', updatedAt: '2026-09-27T10:00:00.000Z' },
    },
  };
  const b = {
    version: 2,
    conversations: {
      b: { id: 'b', title: 'B', updatedAt: '2026-09-27T10:00:00.000Z' },
      c: { id: 'c', title: 'C', updatedAt: '2026-09-27T11:00:00.000Z' },
    },
  };
  const once = mergeRecordMapFile(a, b, 'conversations');
  const twice = mergeRecordMapFile(once, b, 'conversations');
  expect(twice).toEqual(once);
});

test('version 字段取两侧较大者', () => {
  const m = mergeArrayFile(
    { version: 1, tasks: [] },
    { version: 2, tasks: [] },
    'tasks',
    'id',
  ) as { version: number };
  expect(m.version).toBe(2);
});
