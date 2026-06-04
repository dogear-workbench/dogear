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

test('buildProfileEnv 在 enable1MContext 时设置压缩窗口', () => {
  const env = buildProfileEnv({ ...profile, enable1MContext: true }, '/cfg/conversations');
  expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('900000');
});
