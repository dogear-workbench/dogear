import { describe, expect, mock, test } from 'bun:test';
import fsp from 'node:fs/promises';
import path from 'path';
import { tmpdir } from 'node:os';
import type { SubAgentProfile } from '../../services/settings-types.js';
import type { SkillEntry } from './skill-loader.js';

process.env.DOGEAR_CONFIG_DIR = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-tool-assembly-'));

mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir(), on: () => {} }, nativeTheme: {} },
  app: { getPath: () => tmpdir(), on: () => {}, once: () => {} },
  nativeTheme: {},
  shell: { openExternal: () => {} },
  session: {},
  BrowserWindow: class {},
  Tray: class {},
  nativeImage: {},
  Notification: class {},
  ipcMain: { handle: () => {}, on: () => {} },
  ipcRenderer: { send: () => {}, on: () => {} },
}));

const { filterSkillsForSubAgent } = await import('./tool-assembly.js');
const { createDefaultSubAgentProfile } = await import('../../services/settings-types.js');

const SCAN_DIRS = {
  builtin: path.join('data', 'skills-builtin'),
  custom: path.join('data', 'custom', 'skills'),
};

function entry(dir: string, name: string): SkillEntry {
  return {
    name,
    description: `${name} desc`,
    dir: path.join(dir, name),
    bodyPath: path.join(dir, name, 'SKILL.md'),
  };
}

function profileWith(ab: SubAgentProfile['enabledAbilities']): SubAgentProfile {
  return { ...createDefaultSubAgentProfile(), enabledAbilities: ab };
}

const FIXTURE = [
  entry(SCAN_DIRS.builtin, 'builtin-generic'),
  entry(SCAN_DIRS.builtin, 'article-parser'),
  entry(SCAN_DIRS.custom, 'my-custom-skill'),
];

describe('filterSkillsForSubAgent 来源分段闸', () => {
  test('custom 段按 customSkills[] 匹配，与派遣页勾选写回字段一致', () => {
    const loaded = filterSkillsForSubAgent(
      FIXTURE,
      profileWith({ skills: ['builtin-generic'], customSkills: ['my-custom-skill'] }),
      SCAN_DIRS,
    );
    expect(loaded.map((e) => e.name).sort()).toEqual(['builtin-generic', 'my-custom-skill']);
  });

  test('custom 段 skill 不再查 skills[]（旧映射回归锁）', () => {
    const loaded = filterSkillsForSubAgent(
      FIXTURE,
      profileWith({ skills: ['builtin-generic', 'my-custom-skill'], customSkills: [] }),
      SCAN_DIRS,
    );
    expect(loaded.map((e) => e.name)).toEqual(['builtin-generic']);
  });

  test('builtin 段 article-parser 随布尔直通，其余按 skills[]', () => {
    const loaded = filterSkillsForSubAgent(
      FIXTURE,
      profileWith({ article: true, customSkills: ['my-custom-skill'] }),
      SCAN_DIRS,
    );
    expect(loaded.map((e) => e.name).sort()).toEqual(['article-parser', 'my-custom-skill']);
  });
});
