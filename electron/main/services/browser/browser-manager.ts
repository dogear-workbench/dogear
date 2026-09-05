import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { chromium, type BrowserContext, type Page } from 'patchright';
import { getConfigDir, loadSettings } from '../settings-service.js';
import {
  chromiumInstallStatus,
  ensureChromiumInstalled,
} from './browser-download-service.js';

const execFileP = promisify(execFile);

export interface BrowserTaskMeta {
  kind: 'article' | 'agent';
  conversationId?: string;
  articleId?: string;
}

export interface BrowserLease {
  page: Page;
  release: () => void;
}

interface PendingAcquire {
  meta: BrowserTaskMeta;
  resolve: (lease: BrowserLease) => void;
  reject: (err: Error) => void;
}

const IDLE_CLOSE_MS = Number(process.env.DOGEAR_BROWSER_IDLE_CLOSE_MS) || 3 * 60 * 1000;
const DISPOSE_CLOSE_TIMEOUT_MS = 3000;
const PAC_PROXY_DOMAINS = [
  'google.com',
  'googleusercontent.com',
  'gstatic.com',
  'googleapis.com',
  'ggpht.com',
  'duckduckgo.com',
];

function buildProxyPacUrl(proxyServer: string | undefined): string | null {
  const proxy = (proxyServer ?? '').trim().replace(/["\\]/g, '');
  if (!proxy) return null;
  const rules = PAC_PROXY_DOMAINS.map((d) => `dnsDomainIs(host,".${d}")||host==="${d}"`).join('||');
  const script = `function FindProxyForURL(url,host){if(${rules})return "PROXY ${proxy}";return "DIRECT";}`;
  return `data:text/plain,${encodeURIComponent(script)}`;
}

class BrowserManager {
  private profileDir = path.join(getConfigDir(), 'browser-profile');
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private holder: BrowserTaskMeta | null = null;
  private queue: PendingAcquire[] = [];
  private idleTimer: NodeJS.Timeout | null = null;
  private launchPromise: Promise<void> | null = null;
  private intentionalClose = false;
  private disposed = false;

  async acquire(meta: BrowserTaskMeta): Promise<BrowserLease> {
    if (this.disposed) throw new Error('[browser-manager] 实例已销毁，无法获取任务');
    this.clearIdleTimer();
    return new Promise<BrowserLease>((resolve, reject) => {
      this.queue.push({ meta, resolve, reject });
      void this.pump();
    });
  }

  /** 只读状态快照（动作流/伴随面板查询用，不触碰队列与生命周期） */
  getSnapshot(): {
    running: boolean;
    launched: boolean;
    queued: number;
    holder: BrowserTaskMeta | null;
  } {
    return {
      running: this.holder !== null,
      launched: this.context !== null && this.page !== null,
      queued: this.queue.length,
      holder: this.holder ? { ...this.holder } : null,
    };
  }

  async bringToFront(): Promise<void> {
    const ctx = this.context;
    const page = this.page;
    if (!ctx || !page) throw new Error('[browser-manager] 浏览器未启动，无法置前窗口');
    const cdp = await ctx.newCDPSession(page);
    try {
      const { windowId } = await cdp.send('Browser.getWindowForTarget');
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    } finally {
      await cdp.detach().catch(() => {});
    }
    await page.bringToFront();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.clearIdleTimer();
    for (const pending of this.queue.splice(0)) {
      pending.reject(new Error('[browser-manager] 应用退出，任务取消'));
    }
    this.holder = null;
    const ctx = this.context;
    this.context = null;
    this.page = null;
    if (!ctx) return;
    this.intentionalClose = true;
    let closed = false;
    await Promise.race([
      ctx.close()
        .catch((err) => {
          console.warn('[browser-manager] 退出关闭浏览器失败:', err instanceof Error ? err.message : err);
        })
        .finally(() => {
          closed = true;
        }),
      new Promise<void>((resolve) => setTimeout(resolve, DISPOSE_CLOSE_TIMEOUT_MS)),
    ]);
    if (!closed) {
      await this.killProfileProcesses().catch(() => {});
    }
  }

  private async pump(): Promise<void> {
    if (this.holder || this.queue.length === 0) return;
    const next = this.queue.shift()!;
    try {
      await this.ensureLaunched();
    } catch (err) {
      next.reject(err instanceof Error ? err : new Error(String(err)));
      void this.pump();
      return;
    }
    if (!this.page) {
      next.reject(new Error('[browser-manager] 启动完成但 page 缺失'));
      return;
    }
    this.holder = next.meta;
    const page = this.page;
    let released = false;
    next.resolve({
      page,
      release: () => {
        if (released) return;
        released = true;
        this.handleRelease();
      },
    });
  }

  private handleRelease(): void {
    this.holder = null;
    if (this.disposed) return;
    if (this.queue.length > 0) {
      void this.pump();
    } else {
      this.armIdleTimer();
    }
  }

  private armIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      console.log('[browser-manager] 空闲超时，关闭浏览器实例');
      void this.closeContext();
    }, IDLE_CLOSE_MS);
    this.idleTimer.unref?.();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private async ensureLaunched(): Promise<void> {
    if (this.context && this.page) return;
    if (this.launchPromise) {
      await this.launchPromise;
      return;
    }
    const promise = this.launch();
    this.launchPromise = promise;
    try {
      await promise;
    } finally {
      if (this.launchPromise === promise) this.launchPromise = null;
    }
  }

  private async launch(): Promise<void> {
    this.intentionalClose = false;
    fs.mkdirSync(this.profileDir, { recursive: true });
    const proxyServer = await loadSettings().then((s) => s.browserProxyServer).catch(() => undefined);
    const candidates = this.buildLaunchCandidates(proxyServer);
    const failures: string[] = [];
    for (const candidate of candidates) {
      try {
        await candidate.prepare?.();
      } catch (err) {
        failures.push(`${candidate.label}: ${errorMessage(err)}`);
        continue;
      }
      const context = await this.startContext(candidate.options, failures, candidate.label);
      if (!context) continue;
      this.context = context;
      break;
    }
    if (!this.context) {
      throw new Error(
        `受控浏览器启动失败（${failures.join('；')}）。可检查网络后重试，或安装 Edge/Chrome 后重试`,
      );
    }
    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    this.context.on('close', () => this.handleContextClosed());
    await this.minimizeWindow();
    console.log('[browser-manager] 浏览器实例已启动:', this.profileDir);
  }

  private async startContext(
    options: Parameters<typeof chromium.launchPersistentContext>[1],
    failures: string[],
    label: string,
  ): Promise<BrowserContext | null> {
    try {
      return await chromium.launchPersistentContext(this.profileDir, options);
    } catch (err) {
      if (!this.isSingletonError(err)) {
        failures.push(`${label}: ${errorMessage(err)}`);
        return null;
      }
      console.warn('[browser-manager] profile 锁残留，清理后重试启动');
      await this.recoverSingletonLock();
      try {
        return await chromium.launchPersistentContext(this.profileDir, options);
      } catch (retryErr) {
        failures.push(`${label}: ${errorMessage(retryErr)}`);
        return null;
      }
    }
  }

  private buildLaunchCandidates(proxyServer: string | undefined): Array<{
    label: string;
    options: Parameters<typeof chromium.launchPersistentContext>[1];
    prepare?: () => Promise<void>;
  }> {
    const base = this.buildLaunchOptions(proxyServer);
    return [
      {
        label: '内置浏览器组件',
        options: base,
        prepare: async () => {
          const status = chromiumInstallStatus();
          if (!status.installed) {
            throw new Error(status.error ?? `未安装（期望位置 ${status.executablePath}）`);
          }
        },
      },
      { label: '系统 Edge', options: { ...base, channel: 'msedge' } },
      { label: '系统 Chrome', options: { ...base, channel: 'chrome' } },
      {
        label: '内置浏览器组件（新下载）',
        options: base,
        prepare: () => ensureChromiumInstalled(),
      },
    ];
  }

  // --start-minimized 在部分 Chromium 版本被忽略，启动后 CDP 主动最小化兜底
  private async minimizeWindow(): Promise<void> {
    const ctx = this.context;
    const page = this.page;
    if (!ctx || !page) return;
    const cdp = await ctx.newCDPSession(page);
    try {
      const { windowId } = await cdp.send('Browser.getWindowForTarget');
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
    } catch {
      // 最小化失败不阻断启动
    } finally {
      await cdp.detach().catch(() => {});
    }
  }

  // headful 常驻最小化：任务栏可见不抢屏，登录墙时 bringToFront 还原窗口；代理未配置时不注入 PAC，全直连
  private buildLaunchOptions(proxyServer: string | undefined) {
    const args: string[] = ['--start-minimized'];
    const pacUrl = buildProxyPacUrl(proxyServer);
    if (pacUrl) args.push(`--proxy-pac-url=${pacUrl}`);
    return {
      headless: false,
      args,
    };
  }

  private handleContextClosed(): void {
    if (this.intentionalClose || this.disposed) return;
    console.warn('[browser-manager] 浏览器意外退出，标记失效，下次 acquire 自动重启');
    this.context = null;
    this.page = null;
    this.clearIdleTimer();
  }

  private async closeContext(): Promise<void> {
    const ctx = this.context;
    if (!ctx) return;
    this.context = null;
    this.page = null;
    this.intentionalClose = true;
    try {
      await ctx.close();
    } catch (err) {
      console.warn('[browser-manager] 关闭浏览器实例失败:', err instanceof Error ? err.message : err);
    } finally {
      this.intentionalClose = false;
    }
  }

  private isSingletonError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return /singleton/i.test(message);
  }

  private async recoverSingletonLock(): Promise<void> {
    await this.killProfileProcesses().catch(() => {});
    for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      await fs.promises.rm(path.join(this.profileDir, name), { force: true }).catch(() => {});
    }
  }

  private async killProfileProcesses(): Promise<void> {
    if (process.platform === 'win32') {
      const pattern = this.profileDir.replace(/'/g, "''");
      const script =
        `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ` +
        `Where-Object { $_.CommandLine -like '*${pattern}*' } | ` +
        'ForEach-Object { Stop-Process -Id $_.ProcessId -Force }';
      await execFileP('powershell.exe', ['-NoProfile', '-Command', script]);
    } else {
      await execFileP('pkill', ['-f', this.profileDir]);
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

let instance: BrowserManager | null = null;

export function getBrowserManager(): BrowserManager {
  if (!instance) instance = new BrowserManager();
  return instance;
}
