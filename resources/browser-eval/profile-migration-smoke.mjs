import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { register } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
register('./electron-hooks.mjs', pathToFileURL(path.join(here, 'electron-hooks.mjs')).href);

const { DEFAULT_SETTINGS } = await import(
  pathToFileURL(path.resolve(here, '../../dist/main/services/settings-types.js')).href
);
const { normalizeSettings } = await import(
  pathToFileURL(path.resolve(here, '../../dist/main/services/settings-service.js')).href
);

const mkProfile = (ab) => ({
  id: 'browser-parse',
  name: '浏览器解析',
  description: '旧描述',
  modelSelection: null,
  timeoutMinutes: 30,
  enabledBasicTools: ['read', 'write', 'edit', 'bash', 'Glob', 'Grep'],
  enabledAbilities: ab,
});

const mkSettings = (ab) => ({
  ...DEFAULT_SETTINGS,
  subAgent: { profiles: [mkProfile(ab)] },
});

let failed = 0;
const check = (label, cond) => {
  console.log(cond ? `PASS ${label}` : `FAIL ${label}`);
  if (!cond) failed++;
};

const legacy = mkSettings({ browser: true });
normalizeSettings(legacy);
check('旧数据（无 extension 键）补 true', legacy.subAgent.profiles[0].enabledAbilities.extension === true);

const off = mkSettings({ browser: true, extension: false });
normalizeSettings(off);
check('用户显式 false 不被覆盖', off.subAgent.profiles[0].enabledAbilities.extension === false);

const current = mkSettings({ browser: true, extension: true });
normalizeSettings(current);
check('已是 true 保持不变', current.subAgent.profiles[0].enabledAbilities.extension === true);

process.exit(failed > 0 ? 1 : 0);
