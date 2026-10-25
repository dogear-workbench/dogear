import { describe, expect, mock, test } from 'bun:test';
import fsp from 'node:fs/promises';
import path from 'path';
import { tmpdir } from 'node:os';

process.env.DOGEAR_CONFIG_DIR = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-wsconfig-'));

mock.module('electron', () => ({
  default: { app: { isPackaged: false } },
  app: { isPackaged: false },
}));

const { getWorkspaceConfig } = await import('./workspace-config-service.js');
const { resolveAbilities } = await import('../agents/ability-registry.js');

async function seedConfig(workspaceId: string, config: Record<string, unknown>): Promise<void> {
  const dir = path.join(process.env.DOGEAR_CONFIG_DIR!, 'workspaces', workspaceId);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'config.json'), JSON.stringify(config), 'utf-8');
}

describe('skill 型包默认开启的子开关视图回填（article）', () => {
  test('未拨过（无 config 文件）：视图补齐 article 子开关成员，不落盘', async () => {
    const config = await getWorkspaceConfig('ws-fresh');
    expect(config.enabledToolPacks).toContain('article');
    expect(config.enabledSkills).toContain('article-parser');
    expect(config.abilityOverrides?.article).toBeUndefined();
    expect(config.enabledToolPacks).not.toContain('stock-quote');

    const rawPath = path.join(process.env.DOGEAR_CONFIG_DIR!, 'workspaces', 'ws-fresh', 'config.json');
    await expect(fsp.access(rawPath)).rejects.toThrow();
  });

  test('包总闸解析：默认配置下主会话 article 生效（修引用悬空的注册表层）', () => {
    const active = resolveAbilities(
      { enabledToolPacks: [], enabledSkills: [] },
      { role: 'main', hasWorkspace: true, groupId: null },
    );
    expect(active.has('article')).toBe(true);
  });

  test('显式拨关（override=false）：不注入，列表保持原样', async () => {
    await seedConfig('ws-off', { enabledToolPacks: [], enabledSkills: [], abilityOverrides: { article: false } });
    const config = await getWorkspaceConfig('ws-off');
    expect(config.abilityOverrides?.article).toBe(false);
    expect(config.enabledToolPacks).not.toContain('article');
    expect(config.enabledSkills).not.toContain('article-parser');
  });

  test('显式拨开且成员已写：视图不重复注入', async () => {
    await seedConfig('ws-on', {
      enabledToolPacks: ['article'],
      enabledSkills: ['article-parser'],
      abilityOverrides: { article: true },
    });
    const config = await getWorkspaceConfig('ws-on');
    expect(config.enabledToolPacks).toEqual(['article']);
    expect(config.enabledSkills).toEqual(['article-parser']);
  });
});
