import fs from 'fs/promises';
import path from 'path';
import { EXTERNAL_ANCHOR_PREFIX, resolveArchiveRelPath, toArchiveRelPath } from '../data-registry.js';

/**
 * 快照还原：删除「registry 声明的源边界内、磁盘现存但 zip 快照中不存在」的文件。
 * 删除绝不越出 sources 列表声明的路径（目录源只删其子树内文件，文件源只删文件本身）；
 * 外部锚点经 workspaces.json 反解到真实磁盘位置，工作区已注销则整体跳过该边界。
 * 调用方须保证 zip 条目集非空（空 zip 意味着把全部源清空，须在上游拒绝）。
 * @returns 被删除文件的 zip 条目视角路径（posix）
 */
export async function deleteFilesOutsideSnapshot(sources: string[], zipEntryNames: string[]): Promise<string[]> {
  const snapshotFiles = new Set<string>();
  for (const name of zipEntryNames) {
    if (name.endsWith('/')) continue;
    snapshotFiles.add(name);
  }
  const removed: string[] = [];
  for (const source of sources) {
    const archiveRel = toArchiveRelPath(source);
    if (archiveRel.startsWith('..')) continue;
    let root = source;
    if (archiveRel.split('/')[0] === EXTERNAL_ANCHOR_PREFIX) {
      const resolved = await resolveArchiveRelPath(archiveRel);
      if (!resolved) continue;
      root = resolved;
    }
    const st = await fs.lstat(root).catch(() => null);
    if (!st) continue;
    if (st.isFile()) {
      if (!snapshotFiles.has(archiveRel)) {
        await fs.rm(root, { force: true });
        removed.push(archiveRel);
      }
      continue;
    }
    if (!st.isDirectory()) continue;
    for (const file of await walkFiles(root)) {
      const rel = path.relative(root, file).split(path.sep).join('/');
      const entryName = `${archiveRel}/${rel}`;
      if (!snapshotFiles.has(entryName)) {
        await fs.rm(file, { force: true });
        removed.push(entryName);
      }
    }
  }
  return removed;
}

/** 目录子树内的普通文件（symlink 不跟随不删除，防边界外误伤） */
async function walkFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const queue = [dir];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    const entries = await fs.readdir(cur, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) queue.push(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  return out;
}
