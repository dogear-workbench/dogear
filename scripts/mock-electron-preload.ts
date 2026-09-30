// bun --preload 用：mock electron 模块供直跑主进程服务的冒烟脚本使用
import { plugin } from 'bun';

plugin({
  name: 'mock-electron',
  setup(build) {
    build.module('electron', () => ({
      loader: 'object' as const,
      exports: { app: { isPackaged: false }, nativeTheme: {}, default: { app: { isPackaged: false }, nativeTheme: {} } },
    }));
  },
});
