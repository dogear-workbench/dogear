import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { register } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
register('./electron-hooks.mjs', pathToFileURL(path.join(here, 'electron-hooks.mjs')).href);

const typesUrl = pathToFileURL(path.resolve(here, '../../dist/main/services/settings-types.js')).href;
const { DEFAULT_SETTINGS, createBrowserParseSubAgentProfile, createDefaultSubAgentProfile } = await import(typesUrl);
const { normalizeSettings } = await import(
  pathToFileURL(path.resolve(here, '../../dist/main/services/settings-service.js')).href
);

const NEW_DESCRIPTION = createBrowserParseSubAgentProfile().description;

const LEGACY_DESCRIPTIONS = [
  '挂载浏览器工具包执行网页抓取与解析，建议选择便宜档模型以节省成本',
  '挂载扩展工具包在用户真实浏览器（登录态站点如小红书）执行只读调研，或用受控浏览器读取公开网页',
  '挂载扩展工具包在用户真实浏览器（登录态站点如小红书）执行只读调研，或用受控浏览器读取公开网页；扩展通道同一时间仅一个会话可用，并行调研请改串行派遣或使用受控浏览器',
];

const mkProfile = (ab, description = '旧描述') => ({
  id: 'browser-parse',
  name: '浏览器解析',
  description,
  modelSelection: null,
  timeoutMinutes: 30,
  enabledBasicTools: ['read', 'write', 'edit', 'bash', 'Glob', 'Grep'],
  enabledAbilities: ab,
});

const mkSettings = (ab, description) => ({
  ...DEFAULT_SETTINGS,
  subAgent: { profiles: [createDefaultSubAgentProfile(), mkProfile(ab, description)] },
});

let failed = 0;
const check = (label, cond) => {
  console.log(cond ? `PASS ${label}` : `FAIL ${label}`);
  if (!cond) failed++;
};

const legacy = mkSettings({ browser: true });
normalizeSettings(legacy);
check('旧数据（无 extension 键）补 true', legacy.subAgent.profiles[1].enabledAbilities.extension === true);

const off = mkSettings({ browser: true, extension: false });
normalizeSettings(off);
check('用户显式 false 不被覆盖', off.subAgent.profiles[1].enabledAbilities.extension === false);

const current = mkSettings({ browser: true, extension: true });
normalizeSettings(current);
check('已是 true 保持不变', current.subAgent.profiles[1].enabledAbilities.extension === true);

LEGACY_DESCRIPTIONS.forEach((desc, i) => {
  const s = mkSettings({ browser: true, extension: true }, desc);
  const changed = normalizeSettings(s);
  check(
    `旧描述 v${i + 1} 迁移到新方法论描述`,
    changed === true && s.subAgent.profiles[1].description === NEW_DESCRIPTION,
  );
  check(`旧描述 v${i + 1} 迁移后二次 normalize 幂等`, normalizeSettings(s) === false);
});

const custom = mkSettings({ browser: true, extension: true }, '我的自定义浏览器描述');
normalizeSettings(custom);
check('用户自定义描述不被迁移', custom.subAgent.profiles[1].description === '我的自定义浏览器描述');

const builtin = mkSettings({ browser: true, extension: true }, NEW_DESCRIPTION);
check('已是新描述 normalize 零改动', normalizeSettings(builtin) === false);

process.exit(failed > 0 ? 1 : 0);
