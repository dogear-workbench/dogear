import { test, expect, mock } from 'bun:test';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

process.env.DOGEAR_CONFIG_DIR = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-prefs-'));

mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir() }, nativeTheme: {} },
  app: { getPath: () => tmpdir() },
  nativeTheme: {},
}));

const prefs = await import('./preferences-service.js');

const cfgDir = () => process.env.DOGEAR_CONFIG_DIR!;
const prefFile = () => path.join(cfgDir(), 'preferences.md');

test('savePreference：新增建文件、条目单行、重复写入幂等', async () => {
  const r1 = await prefs.savePreference('回复一律用中文');
  expect(r1.status).toBe('added');
  const raw = await fsp.readFile(prefFile(), 'utf-8');
  expect(raw.startsWith('# 用户偏好')).toBe(true);
  expect(raw).toContain('- 回复一律用中文');

  const r2 = await prefs.savePreference('提交前先跑 lint');
  expect(r2.status).toBe('added');
  expect((await prefs.listPreferences()).length).toBe(2);

  const r3 = await prefs.savePreference('回复一律用中文');
  expect(r3.status).toBe('duplicate');
  expect((await prefs.listPreferences()).length).toBe(2);
});

test('savePreference：同主题相似内容拦截，replace 原地覆盖', async () => {
  const blocked = await prefs.savePreference('回复一律用中文，不要英文');
  expect(blocked.status).toBe('blocked');
  if (blocked.status === 'blocked') expect(blocked.similarTo).toContain('回复一律用中文');

  const replaced = await prefs.savePreference('回复用中文，代码与专有名词除外', '回复一律用中文');
  expect(replaced.status).toBe('replaced');
  const items = await prefs.listPreferences();
  expect(items).not.toContain('回复一律用中文');
  expect(items).toContain('回复用中文，代码与专有名词除外');

  await expect(prefs.savePreference('x', '不存在的旧条目')).rejects.toThrow('未命中');
});

test('savePreference：单行与长度准入', async () => {
  await expect(prefs.savePreference('第一行\n第二行')).rejects.toThrow('一条一行');
  await expect(prefs.savePreference('长'.repeat(prefs.PREF_MAX_ITEM_CHARS + 1))).rejects.toThrow('上限');
  await expect(prefs.savePreference('   ')).rejects.toThrow('不能为空');
});

test('熔断：条数达 60 拒绝写入（不静默置换）', async () => {
  const dir = path.dirname(prefFile());
  await fsp.rm(dir, { recursive: true, force: true });
  const lines = ['# 用户偏好', ''];
  for (let i = 1; i <= prefs.PREF_MAX_ITEMS; i++) lines.push(`- 占位偏好 ${i}`);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(prefFile(), `${lines.join('\n')}\n`, 'utf-8');
  await expect(prefs.savePreference('新偏好')).rejects.toThrow('熔断');
});

test('熔断：总行数超 100 拒绝写入（用户手写说明占行也计入）', async () => {
  const dir = path.dirname(prefFile());
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
  const lines = ['# 用户偏好', ''];
  for (let i = 0; i < 41; i++) lines.push(`说明段落 ${i}`);
  for (let i = 1; i <= 58; i++) lines.push(`- 占位偏好 ${i}`);
  await fsp.writeFile(prefFile(), `${lines.join('\n')}\n`, 'utf-8');
  await expect(prefs.savePreference('新偏好')).rejects.toThrow('熔断');
});

test('forgetPreference：按原文删除、未命中报错、保留非条目行', async () => {
  const dir = path.dirname(prefFile());
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(
    prefFile(),
    '# 用户偏好\n\n手工说明保留\n- 甲偏好\n- 乙偏好\n',
    'utf-8',
  );
  const items = await prefs.forgetPreference('甲偏好');
  expect(items).toEqual(['乙偏好']);
  const raw = await fsp.readFile(prefFile(), 'utf-8');
  expect(raw).toContain('手工说明保留');
  expect(raw).not.toContain('甲偏好');
  await expect(prefs.forgetPreference('甲偏好')).rejects.toThrow('未命中');
});
