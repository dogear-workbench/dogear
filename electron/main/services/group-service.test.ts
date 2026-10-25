import { describe, expect, mock, test } from 'bun:test';
import fsp from 'node:fs/promises';
import path from 'path';
import { tmpdir } from 'node:os';

process.env.DOGEAR_CONFIG_DIR = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-group-service-'));

mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir(), on: () => {} }, nativeTheme: {} },
  app: { getPath: () => tmpdir(), on: () => {} },
  nativeTheme: {},
  ipcMain: { handle: () => {}, on: () => {} },
}));

const { createGroup, updateGroup, getGroup, listGroups } = await import('./group-service.js');

const WS = 'ws-group-test';

function localMinuteTitle(now: number): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

describe('createGroup 默认标题', () => {
  test('无 title 时默认创建时刻本地时区 YYYY-MM-DD HH:mm', async () => {
    const before = Date.now();
    const group = await createGroup(WS);
    const after = Date.now();
    expect(group.title).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(group.title).toBe(localMinuteTitle(group.createdAt));
    expect(group.createdAt).toBeGreaterThanOrEqual(before);
    expect(group.createdAt).toBeLessThanOrEqual(after);
  });

  test('空白 title 同样走默认时间戳', async () => {
    const group = await createGroup(WS, { title: '   ' });
    expect(group.title).toBe(localMinuteTitle(group.createdAt));
  });

  test('传具体 title 时用传入值（shunt new-topic 路径语义）', async () => {
    const group = await createGroup(WS, { title: '调研话题' });
    expect(group.title).toBe('调研话题');
  });

  test('传 title 首尾空白被裁剪', async () => {
    const group = await createGroup(WS, { title: '  调研话题  ' });
    expect(group.title).toBe('调研话题');
  });
});

describe('autoTitle 字段退役后的旧数据兼容', () => {
  test('存量 groups.json 带 autoTitle 字段可正常读取，改名写盘后字段丢弃', async () => {
    const legacy = await createGroup(WS, { title: '旧占坑名' });
    const groupsPath = path.join(process.env.DOGEAR_CONFIG_DIR!, 'workspaces', WS, 'groups.json');
    const raw = JSON.parse(await fsp.readFile(groupsPath, 'utf-8'));
    const entry = raw.groups.find((g: { id: string }) => g.id === legacy.id);
    entry.autoTitle = true;
    await fsp.writeFile(groupsPath, JSON.stringify(raw));

    const reloaded = await getGroup(WS, legacy.id);
    expect(reloaded?.title).toBe('旧占坑名');
    expect((reloaded as unknown as Record<string, unknown>).autoTitle).toBeUndefined();

    await updateGroup(WS, legacy.id, { title: '用户改名' });
    const saved = JSON.parse(await fsp.readFile(groupsPath, 'utf-8'));
    const savedEntry = saved.groups.find((g: { id: string }) => g.id === legacy.id);
    expect(savedEntry.title).toBe('用户改名');
    expect(savedEntry.autoTitle).toBeUndefined();
    expect((await listGroups(WS)).some((g) => g.id === legacy.id)).toBe(true);
  });
});
