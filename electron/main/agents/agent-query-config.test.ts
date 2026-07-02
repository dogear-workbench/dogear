import { test, expect } from 'bun:test';
import { buildProfileEnv } from './agent-query-config.js';
import type { ModelProfile } from '../services/settings-types.js';

const profile: ModelProfile = {
  id: 'p1', name: '测试', apiKey: 'sk-test', baseUrl: 'https://api.test',
  haikuModel: 'h', sonnetModel: 's', opusModel: 'o',
  apiTimeoutMs: 3000000, disableNonessentialTraffic: true,
};

test('buildProfileEnv 注入凭证与模型映射', () => {
  const env = buildProfileEnv(profile, '/cfg/conversations');
  expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-test');
  expect(env.ANTHROPIC_BASE_URL).toBe('https://api.test');
  expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('h');
  expect(env.CLAUDE_CONFIG_DIR).toBe('/cfg/conversations');
  expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBeUndefined();
});

test('buildProfileEnv 在设置 autoCompactWindow 时注入具体 token 数', () => {
  const env = buildProfileEnv({ ...profile, autoCompactWindow: 500000 }, '/cfg/conversations');
  expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('500000');
});

test('buildProfileEnv 在 autoCompactWindow=0 时不注入压缩窗口', () => {
  const env = buildProfileEnv({ ...profile, autoCompactWindow: 0 }, '/cfg/conversations');
  expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBeUndefined();
});
