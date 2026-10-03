/**
 * 影子快照存量瘦身：按当前阈值/排除规则重写全部快照历史的 tree（剔除超限 blob 与排除目录），
 * 重建 commit 链换头后 gc，再顺带做保留窗口裁剪。历史重写只允许用户手动触发（设置页入口），
 * 本模块不做任何自动调用；调用方须走 shadow.ts 的按工作区串行队列，与快照/恢复互斥
 */
import { spawn } from 'child_process';
import fs from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';
import type { SnapshotSettings } from '../settings-types.js';
import { execGit, execGitCode, execGitInput, GitServiceError } from './exec.js';
import { listSnapshotChain, pruneSnapshotHistory } from './shadow-prune.js';

export interface SlimShadowResult {
  /** done：历史重写或窗口裁剪生效；noop：空仓库或历史已合规；skipped：链上混入非快照 commit 保守停手 */
  status: 'done' | 'noop' | 'skipped';
  commitsBefore: number;
  commitsAfter: number;
  sizeBytesBefore: number;
  sizeBytesAfter: number;
}

interface TreeEntry {
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  hash: string;
  name: string;
}

const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

interface SlimContext {
  cwd: string;
  gitDir: string;
  maxBytes: number;
  excludeDirs: Set<string>;
  /** tree hash → 直接条目（预扫描全量收集，重写决策纯内存） */
  treeData: Map<string, TreeEntry[]>;
  /** blob hash → 字节大小（cat-file --batch-check 批量查询） */
  blobSizes: Map<string, number>;
  /** 同位置跨 commit 的相同 tree 大量复现，按 prefix+hash 缓存重写结果 */
  treeCache: Map<string, string>;
}

/** 目录磁盘占用（字节，递归求和）；目录不存在返回 0 */
export async function dirSizeBytes(dir: string): Promise<number> {
  let total = 0;
  const walk = async (d: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(p);
      } else if (entry.isFile()) {
        total += await fs.stat(p).then((st) => st.size, () => 0);
      }
    }
  };
  await walk(dir);
  return total;
}

/** 对齐 takeSnapshot 的 pathspec 语义：单段名匹配任意层级同名目录，嵌套名（a/b）匹配任意层级的连续段序列 */
function isExcludedDir(fullRel: string, name: string, excludeDirs: Set<string>): boolean {
  const segs = fullRel.split('/');
  for (const dir of excludeDirs) {
    const dSegs = dir.split('/');
    if (dSegs.length === 1) {
      if (name === dir) return true;
      continue;
    }
    for (let i = 0; i + dSegs.length <= segs.length; i++) {
      if (dSegs.every((s, j) => segs[i + j] === s)) return true;
    }
  }
  return false;
}

function commitTreeOf(raw: string): string {
  const m = /^tree ([0-9a-f]{40})/.exec(raw);
  if (!m) throw new GitServiceError('git-failed', '快照 commit 对象格式异常：缺少 tree 头');
  return m[1];
}

function rebuildCommitObject(raw: string, tree: string, parent: string | undefined): string {
  const sep = raw.indexOf('\n\n');
  if (sep === -1) throw new GitServiceError('git-failed', '快照 commit 对象格式异常：缺少头/体分隔');
  const lines = raw.slice(0, sep).split('\n');
  const preserved = lines.filter((l) => !l.startsWith('tree ') && !l.startsWith('parent '));
  const header = ['tree ' + tree, ...(parent ? ['parent ' + parent] : []), ...preserved];
  return header.join('\n') + raw.slice(sep);
}

function parseTreeEntry(chunk: string): TreeEntry {
  const tab = chunk.indexOf('\t');
  if (tab === -1) throw new GitServiceError('git-failed', '快照 tree 条目格式异常');
  const [mode = '', type = '', hash = ''] = chunk.slice(0, tab).split(' ');
  return { mode, type: type as TreeEntry['type'], hash, name: chunk.slice(tab + 1) };
}

/** cat-file --batch 输出含多字节内容时字节数 ≠ JS 字符串长度，必须按 Buffer 切分 */
function execGitBuffer(cwd: string, args: string[], input: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', 'core.quotepath=false', ...args], { cwd, windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk;
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      reject(err.code === 'ENOENT' ? new GitServiceError('git-missing', '系统未安装 git 或 git 不在 PATH 中') : err);
    });
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new GitServiceError('git-failed', `git ${args[0]} 执行失败: ${stderr.trim() || `exit ${code}`}`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

function parseCommitBatch(buf: Buffer, hashes: string[]): Map<string, string> {
  const map = new Map<string, string>();
  let pos = 0;
  for (const hash of hashes) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl === -1) break;
    const header = buf.slice(pos, nl).toString('utf8');
    const m = /^([0-9a-f]{40}) commit (\d+)$/.exec(header);
    if (!m || m[1] !== hash) {
      pos = nl + 1;
      continue;
    }
    const size = Number(m[2]);
    map.set(hash, buf.slice(nl + 1, nl + 1 + size).toString('utf8'));
    pos = nl + 1 + size + 1;
  }
  return map;
}

async function collectTrees(rootHashes: string[], ctx: SlimContext): Promise<void> {
  const queue = [...new Set(rootHashes)];
  while (queue.length > 0) {
    const hash = queue.shift()!;
    if (ctx.treeData.has(hash)) continue;
    const out = await execGit(ctx.cwd, ['--git-dir', ctx.gitDir, 'ls-tree', '-z', hash]);
    const entries = out
      .split('\0')
      .filter(Boolean)
      .map(parseTreeEntry);
    ctx.treeData.set(hash, entries);
    for (const e of entries) {
      if (e.type === 'tree') queue.push(e.hash);
    }
  }
}

async function loadBlobSizes(ctx: SlimContext): Promise<void> {
  const blobs = new Set<string>();
  for (const entries of ctx.treeData.values()) {
    for (const e of entries) {
      if (e.type === 'blob') blobs.add(e.hash);
    }
  }
  if (blobs.size === 0) return;
  const out = await execGitInput(
    ctx.cwd,
    ['--git-dir', ctx.gitDir, 'cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
    [...blobs].join('\n') + '\n',
  );
  for (const line of out.split('\n')) {
    const [hash = '', type = '', size = ''] = line.trim().split(' ');
    if (hash && type === 'blob' && /^\d+$/.test(size)) ctx.blobSizes.set(hash, Number(size));
  }
}

async function rewriteTree(treeHash: string, relPrefix: string, ctx: SlimContext): Promise<string> {
  const cacheKey = `${relPrefix}\0${treeHash}`;
  const cached = ctx.treeCache.get(cacheKey);
  if (cached) return cached;
  const entries = ctx.treeData.get(treeHash);
  if (!entries) throw new GitServiceError('git-failed', `快照 tree 对象读取失败: ${treeHash}`);
  const kept: TreeEntry[] = [];
  let modified = false;
  for (const entry of entries) {
    if (entry.type === 'tree') {
      if (isExcludedDir(relPrefix + entry.name, entry.name, ctx.excludeDirs)) {
        modified = true;
        continue;
      }
      const child = await rewriteTree(entry.hash, `${relPrefix}${entry.name}/`, ctx);
      if (child === EMPTY_TREE_HASH) {
        // 子目录内容全被剔除后空目录无保留意义，连锁向上剔除
        modified = true;
        continue;
      }
      if (child !== entry.hash) modified = true;
      kept.push({ ...entry, hash: child });
    } else if (entry.type === 'blob') {
      if ((ctx.blobSizes.get(entry.hash) ?? 0) > ctx.maxBytes) {
        modified = true;
        continue;
      }
      kept.push(entry);
    } else {
      kept.push(entry);
    }
  }
  if (!modified) {
    ctx.treeCache.set(cacheKey, treeHash);
    return treeHash;
  }
  // mktree 对空条目集只接受 0 字节输入（尾换行会被当作空行报错）
  const input = kept.map((e) => `${e.mode} ${e.type} ${e.hash}\t${e.name}`).join('\n') + (kept.length > 0 ? '\n' : '');
  const newHash = (await execGitInput(ctx.cwd, ['--git-dir', ctx.gitDir, 'mktree'], input)).trim();
  ctx.treeCache.set(cacheKey, newHash);
  return newHash;
}

export async function slimShadowRepo(
  gitDir: string,
  workspacePath: string,
  settings: SnapshotSettings,
): Promise<SlimShadowResult> {
  const sizeBytesBefore = await dirSizeBytes(gitDir);
  const noop = (commits: number): SlimShadowResult => ({
    status: 'noop',
    commitsBefore: commits,
    commitsAfter: commits,
    sizeBytesBefore,
    sizeBytesAfter: sizeBytesBefore,
  });
  const hasHead =
    (await execGitCode(workspacePath, ['--git-dir', gitDir, 'rev-parse', '--verify', '--quiet', 'HEAD'])) === 0;
  if (!hasHead) return noop(0);
  const commits = await listSnapshotChain(gitDir, workspacePath);
  if (commits.length === 0) return noop(0);
  // 链上混入非快照 commit（理论不存在）时保守停手，防止重写波及未知提交
  if (commits.some((c) => !c.subject.startsWith('[snapshot]'))) {
    console.warn('[shadow-slim] 快照链中发现非快照 commit，跳过瘦身:', workspacePath);
    return {
      status: 'skipped',
      commitsBefore: commits.length,
      commitsAfter: commits.length,
      sizeBytesBefore,
      sizeBytesAfter: sizeBytesBefore,
    };
  }
  const hashes = commits.map((c) => c.hash);
  const raws = parseCommitBatch(
    await execGitBuffer(workspacePath, ['--git-dir', gitDir, 'cat-file', '--batch'], hashes.join('\n') + '\n'),
    hashes,
  );
  const ctx: SlimContext = {
    cwd: workspacePath,
    gitDir,
    maxBytes: settings.maxFileSizeBytes,
    excludeDirs: new Set(settings.excludeDirs),
    treeData: new Map(),
    blobSizes: new Map(),
    treeCache: new Map(),
  };
  const oldRoots: string[] = [];
  for (const c of commits) {
    const raw = raws.get(c.hash);
    if (raw === undefined) throw new GitServiceError('git-failed', `快照 commit 对象读取失败: ${c.hash}`);
    oldRoots.push(commitTreeOf(raw));
  }
  await collectTrees(oldRoots, ctx);
  await loadBlobSizes(ctx);
  const newRoots: string[] = [];
  let changed = false;
  for (const root of oldRoots) {
    const next = await rewriteTree(root, '', ctx);
    if (next !== root) changed = true;
    newRoots.push(next);
  }
  if (changed) {
    let parent: string | undefined;
    for (let i = commits.length - 1; i >= 0; i--) {
      const rebuilt = rebuildCommitObject(raws.get(commits[i].hash)!, newRoots[i], parent);
      parent = (
        await execGitInput(
          workspacePath,
          ['--git-dir', gitDir, 'hash-object', '-t', 'commit', '-w', '--stdin'],
          rebuilt,
        )
      ).trim();
    }
    await execGit(workspacePath, ['--git-dir', gitDir, 'update-ref', 'HEAD', parent!, commits[0].hash]);
    // 旧链靠 reflog 仍可达，必须先清 reflog 再 gc，否则 blob 剪不掉；
    // index 暂存着上次 add -A 的全量状态，也钉住磁盘上仍存在的被剔 blob，同样必须清
    await execGit(workspacePath, ['--git-dir', gitDir, 'reflog', 'expire', '--expire=now', '--all']);
    await execGit(workspacePath, ['--git-dir', gitDir, 'read-tree', '--empty']);
    await execGit(workspacePath, ['--git-dir', gitDir, 'gc', '--prune=now', '--quiet']);
  }
  const prune = await pruneSnapshotHistory(gitDir, workspacePath, settings.retention);
  const sizeBytesAfter = await dirSizeBytes(gitDir);
  const commitsAfter = Number.parseInt(
    (await execGit(workspacePath, ['--git-dir', gitDir, 'rev-list', '--count', 'HEAD'])).trim(),
    10,
  );
  return {
    status: changed || prune.after < prune.before ? 'done' : 'noop',
    commitsBefore: commits.length,
    commitsAfter: Number.isFinite(commitsAfter) ? commitsAfter : commits.length,
    sizeBytesBefore,
    sizeBytesAfter,
  };
}
