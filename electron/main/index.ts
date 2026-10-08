import { runNmBridge } from './services/browser/nm-bridge.js';

if (process.argv.includes('--nm-host-bridge')) {
  void runNmBridge();
} else {
  void import('./main-app.js');
}
