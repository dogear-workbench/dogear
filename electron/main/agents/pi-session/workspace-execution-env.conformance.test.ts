import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { registerEnvConformance } from '@earendil-works/pi-durable/testing';
import { WorkspaceExecutionEnv } from './workspace-execution-env.js';

function findBash(): string | null {
  if (process.platform !== 'win32') return null;
  const programFiles = process.env['ProgramFiles'];
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  const candidates = [
    programFiles ? path.join(programFiles, 'Git', 'bin', 'bash.exe') : '',
    programFilesX86 ? path.join(programFilesX86, 'Git', 'bin', 'bash.exe') : '',
  ].filter((candidate) => candidate !== '');
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  const where = spawnSync('where', ['bash.exe'], { encoding: 'utf-8' });
  if (where.status === 0 && where.stdout) {
    for (const line of where.stdout.split(/\r?\n/)) {
      const candidate = line.trim();
      if (candidate && !/^[a-z]:\\windows\\(?:system32|sysnative)\\bash\.exe$/i.test(candidate)) return candidate;
    }
  }
  return null;
}

const bash = findBash();

registerEnvConformance(
  { describe, it, expect },
  'WorkspaceExecutionEnv',
  async (use) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dogear-env-conformance-'));
    try {
      await use(new WorkspaceExecutionEnv([dir]));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  {
    listFiles: true,
    symlinks: process.platform !== 'win32',
    ...(bash ? { shell: [bash, '-c'] } : {}),
  },
);
