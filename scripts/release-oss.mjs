import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const allowDirty = args.includes('--allow-dirty');
const getOpt = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
};
const TARGET = getOpt('target') ?? path.resolve('..', 'dogear-oss');
const REMOTE = getOpt('remote');
const VERSION = getOpt('version');

// 开源仓库排除清单：私有计划文档与个人开发配置
const EXCLUDES = ['docs/plans', '.vscode'];

const run = (cmd, opts = {}) =>
  execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'inherit'], ...opts });

const root = run('git rev-parse --show-toplevel').trim();
process.chdir(root);

const dirty = run('git status --porcelain').trim();
if (dirty && !allowDirty) {
  console.error('私有仓库存在未提交改动，发布须基于干净的 HEAD（或加 --allow-dirty）：');
  console.error(dirty);
  process.exit(1);
}

const files = run('git ls-tree -r HEAD --name-only')
  .trim()
  .split('\n')
  .filter(Boolean)
  .filter((f) => !EXCLUDES.some((e) => f === e || f.startsWith(e + '/')));

console.log(`导出文件数：${files.length}（基于 HEAD，已排除：${EXCLUDES.join('、')}）`);

if (dryRun) {
  console.log('--- 文件清单预览（前 30）---');
  console.log(files.slice(0, 30).join('\n'));
  console.log('--- dry-run 结束，未写入任何内容 ---');
  process.exit(0);
}

if (!fs.existsSync(path.join(TARGET, '.git'))) {
  fs.mkdirSync(TARGET, { recursive: true });
  run(`git -C "${TARGET}" init`);
  run(`git -C "${TARGET}" branch -M main`);
  if (REMOTE) run(`git -C "${TARGET}" remote add origin "${REMOTE}"`);
  console.log(`已初始化开源仓库：${TARGET}`);
}

for (const name of fs.readdirSync(TARGET)) {
  if (name === '.git') continue;
  fs.rmSync(path.join(TARGET, name), { recursive: true, force: true });
}
for (const file of files) {
  const dest = path.join(TARGET, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}

run(`git -C "${TARGET}" add -A`);
const changed = run(`git -C "${TARGET}" status --porcelain`).trim();
if (!changed) {
  console.log('开源仓库内容无变化，无需提交');
  process.exit(0);
}

const date = new Date().toISOString().slice(0, 10);
const msg = VERSION ? `Release v${VERSION} (${date})` : `Sync from private repo (${date})`;
run(`git -C "${TARGET}" commit -m "${msg}"`);
if (VERSION) run(`git -C "${TARGET}" tag "v${VERSION}"`);
console.log(`已提交：${msg}`);

if (REMOTE) {
  run(`git -C "${TARGET}" push origin main --tags`);
  console.log('已推送到远端');
} else {
  console.log('未提供 --remote，跳过推送。手动推送：');
  console.log(`  git -C "${TARGET}" push origin main --tags`);
}
