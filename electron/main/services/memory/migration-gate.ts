// 启动闸门：阻塞组提炼 / 分类 trigger，直到 migration-p4 完成。
// 迁移期间前端点触发按钮 / setTimeout 8s 扫描 / IPC 手动入口都会 await 这个 gate。
import { mainLogger } from '../../agents/logger.js';

let done = false;
let resolveFn: (() => void) | null = null;
const waiter: Promise<void> = new Promise((resolve) => {
  resolveFn = resolve;
});

export function whenMigrationReady(): Promise<void> {
  if (done) return Promise.resolve();
  return waiter;
}

export function markMigrationComplete(): void {
  if (done) return;
  done = true;
  mainLogger.info('[migration-gate] gate 开放');
  resolveFn?.();
}

export function isMigrationComplete(): boolean {
  return done;
}
