/**
 * pi-session-manager 孤儿超龄回收（A3）子进程自检
 *
 * bun test 单进程合跑时 delegation-test-mocks 会全局 mock.module 掉 pi-session-manager.js
 * （进程级、不可逆、按文件名排序 delegation 先于本目录执行），真实 manager 无法在合跑
 * 进程内直接 import。本脚本以独立进程注册自己的 electron / tipc / pi-session stub 后
 * 直实例化 PiSessionManager + EventEmitter 假 session，验证布防/撤防/到期强杀路径；
 * 由 pi-session-manager.test.ts 派生执行并回收结果，勿加入 tsc 构建（见 tsconfig.electron.json exclude）。
 */

import { mock } from 'bun:test';
import { EventEmitter } from 'events';
import assert from 'node:assert/strict';
import path from 'node:path';

const dir = import.meta.dir;

const electronStub = {
  BrowserWindow: { getAllWindows: () => [] },
  WebContentsView: class {},
  session: {},
  nativeImage: {},
  Notification: {},
  Tray: {},
  app: {},
  nativeTheme: {},
  ipcMain: { on: () => {}, handle: () => {}, removeHandler: () => {} },
  ipcRenderer: {},
  dialog: {},
  shell: {},
  Menu: {},
  webContents: {},
};

mock.module('electron', () => ({ ...electronStub, default: electronStub }));
mock.module('@egoist/tipc/main', () => ({
  tipc: { create: () => ({ procedure: {} }) },
  registerIpcMain: () => {},
  getRendererHandlers: () => new Proxy({}, { get: () => ({ send: () => {} }) }),
}));

const fakeById = new Map<string, FakePiSession>();
let lastCreated: FakePiSession | null = null;

class FakePiSession extends EventEmitter {
  running = false;
  closeCalls = 0;
  constructor(public readonly sessionId: string) {
    super();
    fakeById.set(sessionId, this);
    lastCreated = this;
  }
  isRunning(): boolean {
    return this.running;
  }
  async close(): Promise<void> {
    this.closeCalls += 1;
    this.running = false;
  }
}

mock.module(path.join(dir, './pi-session.js'), () => ({ PiSession: FakePiSession }));

const manager = await import('./pi-session-manager.js');
const { PiSessionManager, setOrphanGraceMs, getOrphanGraceMs, ORPHAN_GRACE_MS } = manager;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const GRACE = 50;
const EXPIRE = 200;
let seq = 0;

type CreateConfig = Parameters<InstanceType<typeof PiSessionManager>['createSession']>[0];

async function makeSession(mgr: InstanceType<typeof PiSessionManager>): Promise<FakePiSession> {
  await mgr.createSession({ conversationId: `orphan-probe-${++seq}` } as unknown as CreateConfig);
  return lastCreated!;
}

setOrphanGraceMs(GRACE);
assert.equal(getOrphanGraceMs(), GRACE, 'setter 注入生效');
assert.equal(getOrphanGraceMs() !== ORPHAN_GRACE_MS, true);

// 路径 1：release → 保活布防 → 超龄四条件满足 → forced 强杀
{
  const mgr = new PiSessionManager();
  const s = await makeSession(mgr);
  s.running = true;
  await mgr.release(s.sessionId);
  assert.ok(mgr.getSession(s.sessionId), '宽限期内保活不销毁');
  await sleep(EXPIRE);
  assert.equal(mgr.getSession(s.sessionId), undefined, '超龄 forced 销毁');
  assert.equal(s.closeCalls, 1, 'close 恰好一次');
}

// 路径 2：retain 撤防 → 到期复核 re-attach 放行不误杀 → 再次 release 走完整到期
{
  const mgr = new PiSessionManager();
  const s = await makeSession(mgr);
  s.running = true;
  await mgr.release(s.sessionId);
  mgr.retain(s.sessionId);
  await sleep(EXPIRE);
  assert.ok(mgr.getSession(s.sessionId), 're-attach 后复核放行');
  await mgr.release(s.sessionId);
  await sleep(EXPIRE);
  assert.equal(mgr.getSession(s.sessionId), undefined, '再次归零后正常超龄销毁');
}

// 路径 3：settled 赌注兑现即撤防 + natural 回收，无二次强杀
{
  const mgr = new PiSessionManager();
  const s = await makeSession(mgr);
  s.running = true;
  await mgr.release(s.sessionId);
  s.running = false;
  s.emit('settled');
  await sleep(30);
  assert.equal(mgr.getSession(s.sessionId), undefined, 'settled 后 natural 回收');
  assert.equal(s.closeCalls, 1, 'settled 路径 close 恰好一次');
  await sleep(EXPIRE);
  assert.equal(s.closeCalls, 1, '撤防生效，无二次销毁');
}

// 路径 4：hold 入口——acquireHold 撤防 / releaseHold（仍 running）重新布防并超龄强杀
{
  const mgr = new PiSessionManager();
  const s = await makeSession(mgr);
  s.running = true;
  await mgr.release(s.sessionId);
  mgr.acquireHold(s.sessionId);
  await sleep(EXPIRE);
  assert.ok(mgr.getSession(s.sessionId), 'hold 期内复核放行');
  await mgr.releaseHold(s.sessionId);
  assert.ok(mgr.getSession(s.sessionId), 'releaseHold 后立即保活不销毁');
  await sleep(EXPIRE);
  assert.equal(mgr.getSession(s.sessionId), undefined, 'releaseHold 超龄强杀');
}

// 路径 5：release 时未 running → 直接销毁不布防（既有行为回归）
{
  const mgr = new PiSessionManager();
  const s = await makeSession(mgr);
  await mgr.release(s.sessionId);
  assert.equal(mgr.getSession(s.sessionId), undefined, '非 running 直接销毁');
  await sleep(EXPIRE);
  assert.equal(s.closeCalls, 1);
}

// 路径 6：closeAll 清空全部 timer，退出路径无二次强杀
{
  const mgr = new PiSessionManager();
  const s = await makeSession(mgr);
  s.running = true;
  await mgr.release(s.sessionId);
  mgr.closeAll();
  await sleep(EXPIRE);
  assert.equal(s.closeCalls, 1, 'closeAll 清防后无二次销毁');
}

setOrphanGraceMs(ORPHAN_GRACE_MS);
assert.equal(getOrphanGraceMs(), ORPHAN_GRACE_MS, '恢复默认值');
console.log('[orphan-probe] all paths OK');
