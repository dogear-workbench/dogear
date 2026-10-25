import { client } from './client';

/** 应用内 http(s) 外链统一走主进程系统浏览器打开（Electron 的 window.open 只会开应用内裸窗口） */
export function openExternalUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  void client
    ['browser:openExternal']({ url })
    .then((res) => {
      if ('error' in res && res.error) console.error('[open-external] 打开外部浏览器失败:', res.error);
    })
    .catch((err) => console.error('[open-external] 打开外部浏览器失败:', err));
}
