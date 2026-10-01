import path from 'path';
import AdmZip from 'adm-zip';

export interface PackEntry {
  /** zip 内条目路径（posix 相对，相对 configDir 或 __ws-external__ 虚拟前缀） */
  entryPath: string;
  /** 磁盘真实读取路径（外部锚点已反解） */
  readPath: string;
  isDir: boolean;
}

function addEntry(zip: AdmZip, entry: PackEntry): void {
  if (entry.isDir) {
    zip.addLocalFolder(entry.readPath, entry.entryPath);
  } else {
    zip.addLocalFile(entry.readPath, path.posix.dirname(entry.entryPath));
  }
}

/** 零依赖纯打包：worker 与主进程回退共用；返回条目数，0 = 无有效内容（不写盘） */
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
