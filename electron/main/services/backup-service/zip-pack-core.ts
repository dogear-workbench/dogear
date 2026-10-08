import fs from 'fs/promises';
import path from 'path';
import AdmZip from 'adm-zip';

export interface PackEntry {
  /** zip 内条目路径（posix 相对，相对 configDir 或 __ws-external__ 虚拟前缀） */
  entryPath: string;
  /** 磁盘真实读取路径（外部锚点已反解） */
  readPath: string;
  isDir: boolean;
}

export interface PackFileInfo {
  /** zip 内文件条目路径（posix） */
  entryPath: string;
  mtimeMs: number;
  size: number;
}

async function walkPackDir(absDir: string, zipPrefix: string, out: PackFileInfo[]): Promise<void> {
  let dirents;
  try {
    dirents = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const d of dirents) {
    const abs = path.join(absDir, d.name);
    const st = await fs.stat(abs).catch(() => null);
    if (!st) continue;
    const zipPath = `${zipPrefix}/${d.name}`;
    if (st.isDirectory()) await walkPackDir(abs, zipPath, out);
    else if (st.isFile()) out.push({ entryPath: zipPath, mtimeMs: st.mtimeMs, size: st.size });
  }
}

/** 文件级收集：与 addLocalFolder 展开目录所得文件集合一致（stat 跟随符号链接，stat 失败跳过） */
export async function collectPackFiles(entries: PackEntry[]): Promise<PackFileInfo[]> {
  const files: PackFileInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDir) {
      const st = await fs.stat(entry.readPath).catch(() => null);
      if (!st?.isFile()) continue;
      files.push({ entryPath: entry.entryPath, mtimeMs: st.mtimeMs, size: st.size });
      continue;
    }
    await walkPackDir(entry.readPath, entry.entryPath, files);
  }
  return files;
}

function addEntry(zip: AdmZip, entry: PackEntry): void {
  if (entry.isDir) {
    zip.addLocalFolder(entry.readPath, entry.entryPath);
  } else {
    zip.addLocalFile(entry.readPath, path.posix.dirname(entry.entryPath));
  }
}

/** 纯打包原语：worker 与主进程回退共用；返回条目数，0 = 无有效内容（不写盘） */
export function packEntriesSync(entries: PackEntry[], outZipPath: string): number {
  const zip = new AdmZip();
  for (const entry of entries) addEntry(zip, entry);
  if (zip.getEntries().length === 0) return 0;
  zip.writeZip(outZipPath);
  return zip.getEntries().length;
}

/** 主进程回退：条目间让出事件循环，避免大目录整段阻塞；writeZip 受 adm-zip 同步 API 限制无法分片 */
export async function packEntriesSharded(entries: PackEntry[], outZipPath: string): Promise<number> {
  const zip = new AdmZip();
  for (const entry of entries) {
    addEntry(zip, entry);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  if (zip.getEntries().length === 0) return 0;
  zip.writeZip(outZipPath);
  return zip.getEntries().length;
}
