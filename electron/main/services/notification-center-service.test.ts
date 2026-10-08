import { test, expect, beforeEach } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getNotificationCenterService, type AddNotificationInput } from './notification-center-service.js';

let storageDir: string;

beforeEach(async () => {
  storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dogear-notification-test-'));
  getNotificationCenterService().setStoragePathForTest(path.join(storageDir, 'notifications.json'));
});

function taskInput(taskId: string, overrides?: Partial<AddNotificationInput>): AddNotificationInput {
  return {
    type: 'task',
    dedupeKey: `task:${taskId}:review`,
    title: `任务待审核：${taskId}`,
    summary: '做了关键改动',
    owner: { kind: 'system' },
    taskId,
    workspaceId: 'ws-1',
    ownerLabel: '系统',
    ...overrides,
  };
}

function convInput(childId: string, overrides?: Partial<AddNotificationInput>): AddNotificationInput {
  return {
    type: 'conversation',
    dedupeKey: `conversation:${childId}:delivery`,
    title: `子会话「${childId}」已交付`,
    owner: { kind: 'conversation', conversationId: 'parent-1' },
    workspaceId: 'ws-1',
    ownerLabel: '父会话',
    ...overrides,
  };
}

test('add 新条目落盘且未读计数正确', async () => {
  const svc = getNotificationCenterService();
  await svc.add(taskInput('t1'));
  await svc.add(convInput('c1'));
  const list = await svc.list();
  expect(list).toHaveLength(2);
  expect(list[0].title).toContain('c1');
  expect(list[0].read).toBe(false);
  expect(list[0].count).toBe(1);
  expect(list.find((e) => e.taskId === 't1')?.owner).toEqual({ kind: 'system' });
});

test('同源未读事件聚合计数与字段刷新', async () => {
  const svc = getNotificationCenterService();
  await svc.add(taskInput('t1', { summary: '第一次' }));
  await svc.add(taskInput('t1', { summary: '第二次' }));
  const list = await svc.list();
  expect(list).toHaveLength(1);
  expect(list[0].count).toBe(2);
  expect(list[0].summary).toBe('第二次');
  expect(list[0].read).toBe(false);
});

test('已读后同源再事件生成新条目', async () => {
  const svc = getNotificationCenterService();
  await svc.add(taskInput('t1'));
  const first = (await svc.list())[0];
  await svc.markRead(first.id);
  await svc.add(taskInput('t1'));
  const list = await svc.list();
  expect(list).toHaveLength(2);
  expect(list.filter((e) => !e.read)).toHaveLength(1);
});

test('markRead / markAllRead 置已读', async () => {
  const svc = getNotificationCenterService();
  await svc.add(taskInput('t1'));
  await svc.add(taskInput('t2', { dedupeKey: 'task:t2:review', title: '任务待审核：t2' }));
  const list = await svc.list();
  await svc.markRead(list[0].id);
  expect((await svc.list()).filter((e) => e.read)).toHaveLength(1);
  await svc.markAllRead();
  expect((await svc.list()).every((e) => e.read)).toBe(true);
});

test('markReadByExecSession 只清该会话归属的未读任务条目', async () => {
  const svc = getNotificationCenterService();
  await svc.add(taskInput('t1', { execSessionId: 'exec-1' }));
  await svc.add(taskInput('t2', { dedupeKey: 'task:t2:failed', title: '任务执行失败：t2', execSessionId: 'exec-2' }));
  await svc.add(convInput('c1', { execSessionId: 'exec-1' }));
  await svc.markReadByExecSession('exec-1');
  const list = await svc.list();
  expect(list.find((e) => e.taskId === 't1')?.read).toBe(true);
  expect(list.find((e) => e.taskId === 't2')?.read).toBe(false);
  expect(list.find((e) => e.type === 'conversation')?.read).toBe(false);
  await svc.markReadByExecSession('exec-1');
  expect((await svc.list()).filter((e) => !e.read)).toHaveLength(2);
});

test('markReadByExecSession 无命中时 no-op 不影响存量', async () => {
  const svc = getNotificationCenterService();
  await svc.add(taskInput('t1', { execSessionId: 'exec-1' }));
  await svc.markReadByExecSession('exec-nonexistent');
  const list = await svc.list();
  expect(list).toHaveLength(1);
  expect(list[0].read).toBe(false);
});

test('markReadByTask 清该任务全部未读条目（跨 dedupeKey）', async () => {
  const svc = getNotificationCenterService();
  await svc.add(taskInput('t1'));
  await svc.add(taskInput('t1', { dedupeKey: 'task:t1:failed', title: '任务执行失败：t1' }));
  await svc.add(taskInput('t2', { dedupeKey: 'task:t2:review', title: '任务待审核：t2' }));
  await svc.markReadByTask('t1');
  const list = await svc.list();
  expect(list.filter((e) => e.taskId === 't1').every((e) => e.read)).toBe(true);
  expect(list.find((e) => e.taskId === 't2')?.read).toBe(false);
});

test('markReadByTask 无命中时 no-op', async () => {
  const svc = getNotificationCenterService();
  await svc.add(taskInput('t1'));
  await svc.markReadByTask('t-nonexistent');
  const list = await svc.list();
  expect(list).toHaveLength(1);
  expect(list[0].read).toBe(false);
});

test('重启恢复：条目与未读状态持久化', async () => {
  const svc = getNotificationCenterService();
  await svc.add(taskInput('t1'));
  const first = (await svc.list())[0];
  await svc.markRead(first.id);
  const raw = JSON.parse(await fs.readFile(path.join(storageDir, 'notifications.json'), 'utf-8'));
  expect(raw.version).toBe(1);
  expect(raw.entries).toHaveLength(1);
  expect(raw.entries[0].read).toBe(true);
});

test('上限裁剪：超限时先丢已读旧条目再丢最旧未读', async () => {
  const svc = getNotificationCenterService();
  for (let i = 0; i < 105; i++) {
    await svc.add(convInput(`c${i}`, { dedupeKey: `conversation:c${i}:delivery`, title: `子会话「c${i}」已交付` }));
  }
  let list = await svc.list();
  expect(list).toHaveLength(100);
  expect(list[0].title).toContain('c104');
  expect(list.at(-1)?.title).toContain('c5');
  await svc.markAllRead();
  await svc.add(convInput('c-new', { dedupeKey: 'conversation:c-new:delivery', title: '子会话「c-new」已交付' }));
  list = await svc.list();
  expect(list).toHaveLength(100);
  expect(list[0].title).toContain('c-new');
  expect(list[0].read).toBe(false);
  expect(list.at(-1)?.read).toBe(true);
});

test('remove 删除单条，不存在的 id 无副作用', async () => {
  const svc = getNotificationCenterService();
  await svc.add(taskInput('t1'));
  await svc.add(taskInput('t2', { dedupeKey: 'task:t2:review', title: '任务待审核：t2' }));
  const list = await svc.list();
  const unreadBefore = list.filter((e) => !e.read).length;
  await svc.remove(list[0].id);
  let next = await svc.list();
  expect(next).toHaveLength(1);
  expect(next[0].taskId).toBe('t1');
  expect(next.filter((e) => !e.read)).toHaveLength(unreadBefore - 1);
  await svc.remove('nonexistent-id');
  expect(await svc.list()).toHaveLength(1);
});

test('clearAll 清空全部条目', async () => {
  const svc = getNotificationCenterService();
  await svc.add(taskInput('t1'));
  await svc.add(taskInput('t2', { dedupeKey: 'task:t2:review', title: '任务待审核：t2' }));
  await svc.clearAll();
  expect(await svc.list()).toHaveLength(0);
  const raw = JSON.parse(await fs.readFile(path.join(storageDir, 'notifications.json'), 'utf-8'));
  expect(raw.entries).toHaveLength(0);
});

test('pruneExpired 只清已读且超龄的条目', async () => {
  const svc = getNotificationCenterService();
  await svc.add(taskInput('old-read'));
  const first = (await svc.list())[0];
  await svc.markRead(first.id);
  await svc.add(taskInput('old-unread', {
    dedupeKey: 'task:old-unread:review',
    title: '任务待审核：old-unread',
  }));
  await svc.add(taskInput('fresh-read', { dedupeKey: 'task:fresh-read:review', title: '任务待审核：fresh-read' }));
  const fresh = (await svc.list()).find((e) => e.taskId === 'fresh-read')!;
  await svc.markRead(fresh.id);

  const filePath = path.join(storageDir, 'notifications.json');
  const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'));
  const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  for (const e of raw.entries) {
    if (e.taskId === 'old-read' || e.taskId === 'old-unread') e.createdAt = stale;
  }
  await fs.writeFile(filePath, JSON.stringify(raw));

  const removed = await svc.pruneExpired();
  expect(removed).toBe(1);
  const list = await svc.list();
  expect(list.map((e) => e.taskId).sort()).toEqual(['fresh-read', 'old-unread']);
});
