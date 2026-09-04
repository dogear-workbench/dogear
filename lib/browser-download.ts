import { toast } from 'sonner';
import { useSyncExternalStore } from 'react';
import type { BrowserDownloadEvent } from '../electron/main/services/browser/browser-download-service';

export interface BrowserDownloadState {
  downloading: boolean;
  percent: number;
  receivedBytes: number;
  totalBytes: number;
  error: string | null;
}

const initial: BrowserDownloadState = {
  downloading: false,
  percent: -1,
  receivedBytes: 0,
  totalBytes: -1,
  error: null,
};

const TOAST_ID = 'browser-download';

let state: BrowserDownloadState = initial;
const listeners = new Set<() => void>();

function setState(next: Partial<BrowserDownloadState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): BrowserDownloadState {
  return state;
}

export function useBrowserDownloadState(): BrowserDownloadState {
  return useSyncExternalStore(subscribe, getSnapshot);
}

function formatMB(bytes: number): string {
  if (bytes < 0) return '未知大小';
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function progressLabel(event: BrowserDownloadEvent): string {
  const total = event.totalBytes > 0 ? ` / ${formatMB(event.totalBytes)}` : '';
  return `正在下载浏览器组件 ${formatMB(event.receivedBytes)}${total}`;
}

export function setupBrowserDownloadToasts(): void {
  import('@/lib/events').then(({ rendererEvents }) => {
    rendererEvents.browserDownloadProgress.listen((event: BrowserDownloadEvent) => {
      if (event.status === 'downloading') {
        const percent = event.totalBytes > 0 ? Math.round((event.receivedBytes / event.totalBytes) * 100) : -1;
        setState({
          downloading: true,
          percent,
          receivedBytes: event.receivedBytes,
          totalBytes: event.totalBytes,
          error: null,
        });
        toast.loading(progressLabel(event), { id: TOAST_ID, duration: Infinity });
        return;
      }
      if (event.status === 'done') {
        setState({ downloading: false, percent: 100, error: null });
        toast.success('浏览器组件下载完成，正在继续任务', { id: TOAST_ID, duration: 4000 });
        return;
      }
      setState({ downloading: false, error: event.error ?? '未知错误' });
      toast.error('浏览器组件下载失败', {
        id: TOAST_ID,
        description: `${event.error ?? '未知错误'}。可稍后重试，或安装 Edge/Chrome 作为受控浏览器`,
        duration: 10000,
      });
    });
  });
}
