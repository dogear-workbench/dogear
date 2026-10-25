import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { register } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
register('./electron-hooks.mjs', pathToFileURL(path.join(here, 'electron-hooks.mjs')).href);

const typesUrl = pathToFileURL(path.resolve(here, '../../dist/main/services/settings-types.js')).href;
const {
  DEFAULT_SETTINGS,
  createBrowserParseSubAgentProfile,
  createDefaultSubAgentProfile,
  createExploreSubAgentProfile,
} = await import(typesUrl);
const { normalizeSettings } = await import(
  pathToFileURL(path.resolve(here, '../../dist/main/services/settings-service.js')).href
);

const NEW_DESCRIPTION = createBrowserParseSubAgentProfile().description;

// 现行迁移语义（内置预设收编后）：内置条目 name/description 以代码模板为单一真源无条件接管，
// 不再依赖 LEGACY 旧值登记；能力域只补缺失键，显式 false 不动；探索/股票按同名收编为内置 slug。
const HISTORICAL_DESCRIPTION = '挂载浏览器工具包执行网页抓取与解析，建议选择便宜档模型以节省成本';

const mkProfile = (ab, description = '旧描述') => ({
  id: 'browser-parse',
  name: '浏览器解析',
  description,
  modelSelection: null,
  timeoutMinutes: 30,
  enabledBasicTools: ['read', 'write', 'edit', 'bash', 'Glob', 'Grep'],
  enabledAbilities: ab,
});

const mkSettings = (profiles) => ({
  ...DEFAULT_SETTINGS,
  subAgent: { profiles },
});

let failed = 0;
const check = (label, cond) => {
  console.log(cond ? `PASS ${label}` : `FAIL ${label}`);
  if (!cond) failed++;
};

const legacy = mkSettings([createDefaultSubAgentProfile(), mkProfile({ browser: true })]);
normalizeSettings(legacy);
check('旧数据（无 extension 键）补 true', legacy.subAgent.profiles[1].enabledAbilities.extension === true);

const off = mkSettings([createDefaultSubAgentProfile(), mkProfile({ browser: true, extension: false })]);
normalizeSettings(off);
check('用户显式 false 不被覆盖', off.subAgent.profiles[1].enabledAbilities.extension === false);

const legacyCurrent = mkSettings([
  createDefaultSubAgentProfile(),
  mkProfile({ browser: true, extension: true }, HISTORICAL_DESCRIPTION),
]);
const legacyChanged = normalizeSettings(legacyCurrent);
check('历代历史文案无条件接管为当前模板文案', legacyChanged === true && legacyCurrent.subAgent.profiles[1].description === NEW_DESCRIPTION);
check('接管后二次 normalize 幂等', normalizeSettings(legacyCurrent) === false);

const custom = mkSettings([
  createDefaultSubAgentProfile(),
  mkProfile({ browser: true, extension: true }, '我的自定义浏览器描述'),
]);
normalizeSettings(custom);
check('用户自定义描述同样被模板版接管（收编即产品化）', custom.subAgent.profiles[1].description === NEW_DESCRIPTION);

const builtin = mkSettings([
  createDefaultSubAgentProfile(),
  mkProfile({ ...createBrowserParseSubAgentProfile().enabledAbilities }, NEW_DESCRIPTION),
]);
normalizeSettings(builtin);
const bpAfter = builtin.subAgent.profiles.find((p) => p.id === 'browser-parse');
check(
  '已是模板文案且键全齐时条目零改动（changed 仅来自补齐缺失内置）',
  bpAfter.description === NEW_DESCRIPTION &&
    JSON.stringify(bpAfter.enabledAbilities) === JSON.stringify(createBrowserParseSubAgentProfile().enabledAbilities) &&
    builtin.subAgent.profiles.map((p) => p.id).slice(0, 2).join() === 'default,browser-parse' &&
    normalizeSettings(builtin) === false,
);

const legacyExplore = {
  id: '94132af8-e2f4-40b3-a070-f5cb72323074',
  name: '探索',
  description: '旧版自建描述',
  modelSelection: { profileId: 'default', tier: 'glm-5.3' },
  timeoutMinutes: 45,
  enabledBasicTools: ['read', 'bash', 'Glob', 'Grep'],
  enabledAbilities: { reference: true, memory: true, extension: false, web: true },
};
const adopt = mkSettings([createDefaultSubAgentProfile(), legacyExplore]);
const adoptChanged = normalizeSettings(adopt);
const adopted = adopt.subAgent.profiles.find((p) => p.id === 'explore');
check(
  '同名自建「探索」收编为内置 slug，配置继承、文案接管',
  adoptChanged === true &&
    adopted !== undefined &&
    adopted.description === createExploreSubAgentProfile().description &&
    adopted.timeoutMinutes === 45 &&
    adopted.modelSelection.tier === 'glm-5.3' &&
    adopted.enabledAbilities.extension === false,
);
check('收编后二次 normalize 幂等', normalizeSettings(adopt) === false);

process.exit(failed > 0 ? 1 : 0);
