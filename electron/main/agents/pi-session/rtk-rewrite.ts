import { execFileSync } from 'child_process';

const RTK_TOOLS = new Set([
  'git', 'gh', 'pnpm', 'npm', 'npx', 'yarn', 'bun',
  'cargo', 'tsc', 'jest', 'vitest', 'playwright', 'pytest', 'rspec', 'prisma',
  'prettier', 'eslint', 'next', 'docker', 'kubectl', 'curl', 'wget',
  'ls', 'grep', 'find',
]);

let rtkAvailable: boolean | null = null;

function isRtkAvailable(): boolean {
  if (rtkAvailable !== null) return rtkAvailable;
  try {
    execFileSync('rtk', ['--version'], { stdio: 'ignore' });
    rtkAvailable = true;
  } catch {
    rtkAvailable = false;
  }
  return rtkAvailable;
}

export function rewriteWithRtk(command: string): string {
  if (!isRtkAvailable()) return command;

  const segments = command.split(/(\s*(?:&&|\|\||;|\|)\s*)/);

  for (let i = 0; i < segments.length; i += 2) {
    const seg = segments[i];
    if (!seg) continue;

    const trimmed = seg.replace(/^\s+/, '');
    if (!trimmed) continue;

    const firstToken = trimmed.split(/\s+/, 2)[0];
    if (firstToken === 'rtk') continue;
    if (!RTK_TOOLS.has(firstToken)) continue;

    const leadingWs = seg.slice(0, seg.length - trimmed.length);
    segments[i] = leadingWs + 'rtk ' + trimmed;
  }

  return segments.join('');
}
