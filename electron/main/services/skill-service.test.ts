import { test, expect, beforeEach, afterEach, mock } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

mock.module('electron', () => ({
  default: {},
  app: undefined,
  nativeTheme: {},
}));

const {
  customSkillsDir,
  deleteCustomSkill,
  importCustomSkill,
  isValidSkillName,
  readCustomSkill,
  saveCustomSkill,
  writeCustomSkill,
} = await import('./skill-service.js');

let tmp: string;
let skillsDir: string;
let builtinDir: string;

const skillMd = (name: string, description = '测试技能') =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;

async function putCustomSkill(dirName: string, name: string, description = '测试技能') {
  const dir = path.join(skillsDir, dirName);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'SKILL.md'), skillMd(name, description), 'utf-8');
  return dir;
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dogear-skill-svc-'));
  skillsDir = path.join(tmp, 'custom', 'skills');
  builtinDir = path.join(tmp, 'builtin');
  await fs.mkdir(skillsDir, { recursive: true });
  await fs.mkdir(builtinDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

test('isValidSkillName 对齐 loadSkills 校验口径', () => {
  expect(isValidSkillName('foo')).toBe(true);
  expect(isValidSkillName('foo-bar-1')).toBe(true);
  expect(isValidSkillName('')).toBe(false);
  expect(isValidSkillName('Foo')).toBe(false);
  expect(isValidSkillName('foo_bar')).toBe(false);
  expect(isValidSkillName('-foo')).toBe(false);
  expect(isValidSkillName('foo-')).toBe(false);
  expect(isValidSkillName('foo--bar')).toBe(false);
  expect(isValidSkillName('a'.repeat(65))).toBe(false);
  expect(isValidSkillName('a'.repeat(64))).toBe(true);
});

test('customSkillsDir 拼接 configDir/custom/skills', () => {
  expect(customSkillsDir('/cfg')).toBe(path.join('/cfg', 'custom', 'skills'));
});

test('readCustomSkill 按 frontmatter name 定位并返回全文', async () => {
  await putCustomSkill('some-dir', 'my-skill');
  const r = await readCustomSkill('my-skill', skillsDir);
  expect(r.error).toBeUndefined();
  expect(r.content).toContain('name: my-skill');
});

test('readCustomSkill 未命中时返回 error', async () => {
  const r = await readCustomSkill('nope', skillsDir);
  expect(r.error).toBeTruthy();
});

test('writeCustomSkill 缺 frontmatter 时拒绝且不写盘', async () => {
  await putCustomSkill('foo', 'foo');
  const before = await fs.readFile(path.join(skillsDir, 'foo', 'SKILL.md'), 'utf-8');
  const r = await writeCustomSkill('foo', '# 无 frontmatter', { skillsDir, builtinDir });
  expect(r.error).toContain('frontmatter');
  expect(await fs.readFile(path.join(skillsDir, 'foo', 'SKILL.md'), 'utf-8')).toBe(before);
});

test('writeCustomSkill name 非法时拒绝', async () => {
  await putCustomSkill('foo', 'foo');
  const r = await writeCustomSkill('foo', skillMd('Bad_Name'), { skillsDir, builtinDir });
  expect(r.error).toContain('不合法');
});

test('writeCustomSkill 改名与内置技能重名时拒绝', async () => {
  const takenDir = path.join(builtinDir, 'taken');
  await fs.mkdir(takenDir, { recursive: true });
  await fs.writeFile(path.join(takenDir, 'SKILL.md'), skillMd('taken', '内置'), 'utf-8');
  await putCustomSkill('foo', 'foo');
  const r = await writeCustomSkill('foo', skillMd('taken'), { skillsDir, builtinDir });
  expect(r.error).toContain('内置');
  expect(await readCustomSkill('taken', skillsDir)).toEqual({ error: expect.any(String) });
});

test('writeCustomSkill 改名与其他自定义技能重名时拒绝', async () => {
  await putCustomSkill('other', 'other');
  await putCustomSkill('foo', 'foo');
  const r = await writeCustomSkill('foo', skillMd('other'), { skillsDir, builtinDir });
  expect(r.error).toContain('自定义');
});

test('writeCustomSkill 正常改名与内容写回', async () => {
  await putCustomSkill('foo', 'foo');
  const r = await writeCustomSkill('foo', skillMd('foo-renamed', '新描述'), { skillsDir, builtinDir });
  expect(r.error).toBeUndefined();
  const after = await readCustomSkill('foo-renamed', skillsDir);
  expect(after.content).toContain('新描述');
});

test('writeCustomSkill 内容不变仅改描述时通过（自身不参与重名）', async () => {
  await putCustomSkill('foo', 'foo');
  const r = await writeCustomSkill('foo', skillMd('foo', '更新描述'), { skillsDir, builtinDir });
  expect(r.error).toBeUndefined();
  expect((await readCustomSkill('foo', skillsDir)).content).toContain('更新描述');
});

test('importCustomSkill 目录缺 SKILL.md 时拒绝且不落盘', async () => {
  const src = path.join(tmp, 'src-no-skill');
  await fs.mkdir(src);
  const r = await importCustomSkill(src, { skillsDir, builtinDir }, false);
  expect(r.error).toContain('SKILL.md');
  expect(await fs.readdir(skillsDir)).toEqual([]);
});

test('importCustomSkill frontmatter 缺 name 时回退目录名，非法则拒绝', async () => {
  const src = path.join(tmp, 'Bad Name');
  await fs.mkdir(src);
  await fs.writeFile(path.join(src, 'SKILL.md'), '---\ndescription: x\n---\nbody', 'utf-8');
  const r = await importCustomSkill(src, { skillsDir, builtinDir }, false);
  expect(r.error).toContain('不合法');
  expect(await fs.readdir(skillsDir)).toEqual([]);
});

test('importCustomSkill 与现有技能重名时拒绝且不落盘', async () => {
  await putCustomSkill('existing', 'dup-name');
  const src = path.join(tmp, 'incoming');
  await fs.mkdir(src);
  await fs.writeFile(path.join(src, 'SKILL.md'), skillMd('dup-name'), 'utf-8');
  const r = await importCustomSkill(src, { skillsDir, builtinDir }, false);
  expect(r.error).toContain('dup-name');
  expect(await fs.readdir(skillsDir)).toEqual(['existing']);
});

test('importCustomSkill 正常导入整目录', async () => {
  const src = path.join(tmp, 'incoming');
  await fs.mkdir(path.join(src, 'refs'), { recursive: true });
  await fs.writeFile(path.join(src, 'SKILL.md'), skillMd('incoming'), 'utf-8');
  await fs.writeFile(path.join(src, 'refs', 'note.md'), 'ref', 'utf-8');
  const r = await importCustomSkill(src, { skillsDir, builtinDir }, false);
  expect(r.error).toBeUndefined();
  expect(r.name).toBe('incoming');
  expect(await fs.readFile(path.join(skillsDir, 'incoming', 'refs', 'note.md'), 'utf-8')).toBe('ref');
  const listed = await readCustomSkill('incoming', skillsDir);
  expect(listed.content).toContain('name: incoming');
});

test('importCustomSkill 目标已存在时先报 conflict，确认覆盖后删旧复制', async () => {
  await putCustomSkill('incoming', 'old-name', '旧描述');
  const src = path.join(tmp, 'incoming');
  await fs.mkdir(src);
  await fs.writeFile(path.join(src, 'SKILL.md'), skillMd('new-name', '新描述'), 'utf-8');

  const first = await importCustomSkill(src, { skillsDir, builtinDir }, false);
  expect(first.conflict).toBe(true);
  expect((await readCustomSkill('old-name', skillsDir)).content).toContain('旧描述');

  const overwrite = await importCustomSkill(src, { skillsDir, builtinDir }, true);
  expect(overwrite.error).toBeUndefined();
  expect(overwrite.name).toBe('new-name');
  expect((await readCustomSkill('new-name', skillsDir)).content).toContain('新描述');
  expect(await readCustomSkill('old-name', skillsDir)).toEqual({ error: expect.any(String) });
});

test('importCustomSkill 源即目标时直接视为已就位', async () => {
  const dir = await putCustomSkill('foo', 'foo');
  const r = await importCustomSkill(dir, { skillsDir, builtinDir }, true);
  expect(r.error).toBeUndefined();
  expect(r.name).toBe('foo');
  expect((await readCustomSkill('foo', skillsDir)).content).toContain('name: foo');
});

test('saveCustomSkill 新建：建目录拼 frontmatter，description 多行压平', async () => {
  const r = await saveCustomSkill('new-skill', '多行\n描述压平', '# 正文\n流程指引', { skillsDir, builtinDir });
  expect(r.error).toBeUndefined();
  const read = await readCustomSkill('new-skill', skillsDir);
  expect(read.content).toContain('name: new-skill');
  expect(read.content).toContain('description: 多行 描述压平');
  expect(read.content).not.toContain('\ndescription: 多行\n');
  expect(read.content).toContain('# 正文');
});

test('saveCustomSkill 覆盖已有：同名更新内容', async () => {
  await putCustomSkill('foo', 'foo', '旧描述');
  const r = await saveCustomSkill('foo', '新描述', '# 新正文', { skillsDir, builtinDir });
  expect(r.error).toBeUndefined();
  const read = await readCustomSkill('foo', skillsDir);
  expect(read.content).toContain('description: 新描述');
  expect(read.content).toContain('# 新正文');
});

test('saveCustomSkill 更新名字漂移的技能：写回原目录不新建双份', async () => {
  await putCustomSkill('foo', 'bar');
  const r = await saveCustomSkill('bar', '描述', '# 正文', { skillsDir, builtinDir });
  expect(r.error).toBeUndefined();
  expect(await fs.readdir(skillsDir)).toEqual(['foo']);
  expect((await readCustomSkill('bar', skillsDir)).content).toContain('# 正文');
});

test('saveCustomSkill name 非法时拒绝且不落盘', async () => {
  const r = await saveCustomSkill('Bad_Name', '描述', '# 正文', { skillsDir, builtinDir });
  expect(r.error).toContain('不合法');
  expect(await fs.readdir(skillsDir)).toEqual([]);
});

test('saveCustomSkill 与内置技能重名时拒绝', async () => {
  const takenDir = path.join(builtinDir, 'taken');
  await fs.mkdir(takenDir, { recursive: true });
  await fs.writeFile(path.join(takenDir, 'SKILL.md'), skillMd('taken', '内置'), 'utf-8');
  const r = await saveCustomSkill('taken', '描述', '# 正文', { skillsDir, builtinDir });
  expect(r.error).toContain('内置');
  expect(await fs.readdir(skillsDir)).toEqual([]);
});

test('saveCustomSkill 目录名撞车（目录存在但承载别的技能名）时拒绝', async () => {
  await putCustomSkill('foo', 'bar');
  const r = await saveCustomSkill('foo', '描述', '# 正文', { skillsDir, builtinDir });
  expect(r.error).toContain('禁止覆盖');
  expect((await readCustomSkill('bar', skillsDir)).content).toContain('name: bar');
});

test('deleteCustomSkill 按 name 删除整目录', async () => {
  await putCustomSkill('foo', 'foo');
  const r = await deleteCustomSkill('foo', skillsDir);
  expect(r.error).toBeUndefined();
  expect(await fs.readdir(skillsDir)).toEqual([]);
});

test('deleteCustomSkill 名字漂移时按 frontmatter name 删原目录', async () => {
  await putCustomSkill('foo', 'bar');
  const r = await deleteCustomSkill('bar', skillsDir);
  expect(r.error).toBeUndefined();
  expect(await fs.readdir(skillsDir)).toEqual([]);
});

test('deleteCustomSkill 未命中（含 builtin 名）返回 error 且不动内置目录', async () => {
  const takenDir = path.join(builtinDir, 'taken');
  await fs.mkdir(takenDir, { recursive: true });
  await fs.writeFile(path.join(takenDir, 'SKILL.md'), skillMd('taken', '内置'), 'utf-8');
  const r = await deleteCustomSkill('taken', skillsDir);
  expect(r.error).toBeTruthy();
  expect(await fs.readdir(takenDir)).toEqual(['SKILL.md']);
});
