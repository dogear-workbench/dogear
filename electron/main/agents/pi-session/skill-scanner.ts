import fs from 'fs/promises';
import path from 'path';
import ignore from 'ignore';
import type { Ignore } from 'ignore';
import { parse as parseYaml } from 'yaml';

export interface SkillInfo {
  name: string;
  description: string;
  content: string;
  filePath: string;
  disableModelInvocation?: boolean;
}

export interface SkillDiagnostic {
  type: 'warning';
  code: 'file_info_failed' | 'list_failed' | 'read_failed' | 'parse_failed' | 'invalid_metadata';
  message: string;
  path: string;
}

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const IGNORE_FILE_NAMES = ['.gitignore', '.ignore', '.fdignore'];

type EntryKind = 'file' | 'directory' | 'symlink' | 'other';

interface DirEntry {
  name: string;
  path: string;
  kind: EntryKind;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isNotFound(error: unknown): boolean {
  return isNodeError(error) && error.code === 'ENOENT';
}

function warn(diagnostics: SkillDiagnostic[], code: SkillDiagnostic['code'], message: string, p: string): void {
  diagnostics.push({ type: 'warning', code, message, path: p });
}

async function lstatKind(p: string): Promise<{ kind: EntryKind } | { error: unknown }> {
  try {
    const st = await fs.lstat(p);
    const kind: EntryKind = st.isFile() ? 'file' : st.isDirectory() ? 'directory' : st.isSymbolicLink() ? 'symlink' : 'other';
    return { kind };
  } catch (error) {
    return { error };
  }
}

async function resolveKind(entry: DirEntry, diagnostics: SkillDiagnostic[]): Promise<'file' | 'directory' | undefined> {
  if (entry.kind === 'file' || entry.kind === 'directory') return entry.kind;
  let realPath: string;
  try {
    realPath = await fs.realpath(entry.path);
  } catch (error) {
    if (!isNotFound(error)) warn(diagnostics, 'file_info_failed', toErrorMessage(error), entry.path);
    return undefined;
  }
  const target = await lstatKind(realPath);
  if ('error' in target) {
    if (!isNotFound(target.error)) warn(diagnostics, 'file_info_failed', toErrorMessage(target.error), realPath);
    return undefined;
  }
  return target.kind === 'file' || target.kind === 'directory' ? target.kind : undefined;
}

async function listDirEntries(dir: string): Promise<DirEntry[] | { error: unknown }> {
  try {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    const infos: DirEntry[] = [];
    for (const entry of dirents) {
      const entryPath = path.resolve(dir, entry.name);
      const info = await lstatKind(entryPath);
      if ('error' in info) return { error: info.error };
      if (info.kind === 'other') continue;
      infos.push({ name: entry.name, path: entryPath, kind: info.kind });
    }
    return infos;
  } catch (error) {
    return { error };
  }
}

function relativeEnvPath(root: string, p: string): string {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedPath = p.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalizedPath === normalizedRoot) return '';
  return normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath.replace(/^\/+/, '');
}

function prefixIgnorePattern(line: string, prefix: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('#') && !trimmed.startsWith('\\#')) return null;
  let pattern = line;
  let negated = false;
  if (pattern.startsWith('!')) {
    negated = true;
    pattern = pattern.slice(1);
  } else if (pattern.startsWith('\\!')) {
    pattern = pattern.slice(1);
  }
  if (pattern.startsWith('/')) pattern = pattern.slice(1);
  const prefixed = prefix ? `${prefix}${pattern}` : pattern;
  return negated ? `!${prefixed}` : prefixed;
}

async function addIgnoreRules(ig: Ignore, dir: string, rootDir: string, diagnostics: SkillDiagnostic[]): Promise<void> {
  const relativeDir = relativeEnvPath(rootDir, dir);
  const prefix = relativeDir ? `${relativeDir}/` : '';
  for (const filename of IGNORE_FILE_NAMES) {
    const ignorePath = path.join(dir, filename);
    const info = await lstatKind(ignorePath);
    if ('error' in info) {
      if (!isNotFound(info.error)) warn(diagnostics, 'file_info_failed', toErrorMessage(info.error), ignorePath);
      continue;
    }
    if (info.kind !== 'file') continue;
    let content: string;
    try {
      content = await fs.readFile(ignorePath, 'utf-8');
    } catch (error) {
      warn(diagnostics, 'read_failed', toErrorMessage(error), ignorePath);
      continue;
    }
    const patterns = content
      .split(/\r?\n/)
      .map((line) => prefixIgnorePattern(line, prefix))
      .filter((line): line is string => Boolean(line));
    if (patterns.length > 0) ig.add(patterns);
  }
}

function validateName(name: string, parentDirName: string): string[] {
  const errors: string[] = [];
  if (name !== parentDirName) errors.push(`name "${name}" does not match parent directory "${parentDirName}"`);
  if (name.length > MAX_NAME_LENGTH) errors.push(`name exceeds ${MAX_NAME_LENGTH} characters (${name.length})`);
  if (!/^[a-z0-9-]+$/.test(name)) {
    errors.push('name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)');
  }
  if (name.startsWith('-') || name.endsWith('-')) errors.push('name must not start or end with a hyphen');
  if (name.includes('--')) errors.push('name must not contain consecutive hyphens');
  return errors;
}

function validateDescription(description: string | undefined): string[] {
  const errors: string[] = [];
  if (!description || description.trim() === '') {
    errors.push('description is required');
  } else if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`);
  }
  return errors;
}

function toErrorInstance(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error(String(error));
  }
}

function parseFrontmatter(content: string): { ok: true; frontmatter: Record<string, unknown>; body: string } | { ok: false; error: Error } {
  try {
    const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!normalized.startsWith('---')) return { ok: true, frontmatter: {}, body: normalized };
    const endIndex = normalized.indexOf('\n---', 3);
    if (endIndex === -1) return { ok: true, frontmatter: {}, body: normalized };
    const yamlString = normalized.slice(4, endIndex);
    const body = normalized.slice(endIndex + 4).trim();
    return { ok: true, frontmatter: (parseYaml(yamlString) ?? {}) as Record<string, unknown>, body };
  } catch (error) {
    return { ok: false, error: toErrorInstance(error) };
  }
}

async function loadSkillFromFile(filePath: string, parentDirName: string, diagnostics: SkillDiagnostic[]): Promise<SkillInfo | null> {
  const isDeclaredSkill = filePath
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() === 'SKILL.md';
  let rawContent: string;
  try {
    rawContent = await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    warn(diagnostics, 'read_failed', toErrorMessage(error), filePath);
    return null;
  }
  const parsed = parseFrontmatter(rawContent);
  if (!parsed.ok) {
    if (isDeclaredSkill) warn(diagnostics, 'parse_failed', parsed.error.message, filePath);
    return null;
  }
  const { frontmatter, body } = parsed;
  const description = typeof frontmatter.description === 'string' ? frontmatter.description : undefined;
  if (!isDeclaredSkill && (!description || description.trim() === '')) return null;
  for (const error of validateDescription(description)) {
    warn(diagnostics, 'invalid_metadata', error, filePath);
  }
  const frontmatterName = typeof frontmatter.name === 'string' ? frontmatter.name : undefined;
  const name = frontmatterName || parentDirName;
  for (const error of validateName(name, parentDirName)) {
    warn(diagnostics, 'invalid_metadata', error, filePath);
  }
  if (!description || description.trim() === '') return null;
  return {
    name,
    description,
    content: body,
    filePath,
    disableModelInvocation: frontmatter['disable-model-invocation'] === true,
  };
}

async function scanDir(
  dir: string,
  includeRootFiles: boolean,
  ig: Ignore,
  rootDir: string,
  diagnostics: SkillDiagnostic[],
): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];
  const dirInfo = await lstatKind(dir);
  if ('error' in dirInfo) {
    if (!isNotFound(dirInfo.error)) warn(diagnostics, 'file_info_failed', toErrorMessage(dirInfo.error), dir);
    return skills;
  }
  const dirKind = await resolveKind({ name: path.basename(dir), path: dir, kind: dirInfo.kind }, diagnostics);
  if (dirKind !== 'directory') return skills;
  await addIgnoreRules(ig, dir, rootDir, diagnostics);
  const entriesResult = await listDirEntries(dir);
  if ('error' in entriesResult) {
    warn(diagnostics, 'list_failed', toErrorMessage(entriesResult.error), dir);
    return skills;
  }
  const entries = entriesResult;
  const dirName = path.basename(dir);
  for (const entry of entries) {
    if (entry.name !== 'SKILL.md') continue;
    const kind = await resolveKind(entry, diagnostics);
    if (kind !== 'file') continue;
    if (ig.ignores(relativeEnvPath(rootDir, entry.path))) continue;
    const skill = await loadSkillFromFile(entry.path, dirName, diagnostics);
    if (skill) skills.push(skill);
    return skills;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const kind = await resolveKind(entry, diagnostics);
    if (!kind) continue;
    const relPath = relativeEnvPath(rootDir, entry.path);
    if (ig.ignores(kind === 'directory' ? `${relPath}/` : relPath)) continue;
    if (kind === 'directory') {
      skills.push(...(await scanDir(entry.path, false, ig, rootDir, diagnostics)));
      continue;
    }
    if (!includeRootFiles || !entry.name.endsWith('.md')) continue;
    const skill = await loadSkillFromFile(entry.path, dirName, diagnostics);
    if (skill) skills.push(skill);
  }
  return skills;
}

export async function scanSkillDirs(dirs: string[]): Promise<{ skills: SkillInfo[]; diagnostics: SkillDiagnostic[] }> {
  const skills: SkillInfo[] = [];
  const diagnostics: SkillDiagnostic[] = [];
  for (const input of dirs) {
    const dir = path.resolve(input);
    const rootInfo = await lstatKind(dir);
    if ('error' in rootInfo) {
      if (!isNotFound(rootInfo.error)) warn(diagnostics, 'file_info_failed', toErrorMessage(rootInfo.error), dir);
      continue;
    }
    const kind = await resolveKind({ name: path.basename(dir), path: dir, kind: rootInfo.kind }, diagnostics);
    if (kind !== 'directory') continue;
    skills.push(...(await scanDir(dir, true, ignore(), dir, diagnostics)));
  }
  return { skills, diagnostics };
}

function dirnameEnvPath(p: string): string {
  const normalized = p.replace(/[\\/]+$/, '');
  const separatorIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  if (separatorIndex === 2 && normalized[1] === ':') return normalized.slice(0, 3);
  return separatorIndex <= 0 ? '/' : normalized.slice(0, separatorIndex);
}

export function formatSkillInvocation(skill: SkillInfo, additionalInstructions?: string): string {
  const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${dirnameEnvPath(skill.filePath)}.\n\n${skill.content}\n</skill>`;
  return additionalInstructions ? `${skillBlock}\n\n${additionalInstructions}` : skillBlock;
}
