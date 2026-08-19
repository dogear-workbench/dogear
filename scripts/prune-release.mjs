import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELEASE_DIR = path.resolve(__dirname, '..', 'release');
const KEEP_VERSIONS = 2;

function versionOf(name) {
  const m = /(\d+\.\d+\.\d+)/.exec(name);
  return m ? m[1] : null;
}

function compareVersionDesc(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < pa.length; i++) {
    if (pa[i] !== pb[i]) return pb[i] - pa[i];
  }
  return 0;
}

export async function pruneReleaseDir({ keep = KEEP_VERSIONS } = {}) {
  let entries;
  try {
    entries = await fs.readdir(RELEASE_DIR);
  } catch {
    return { kept: [], removed: [] };
  }
  const versions = [...new Set(entries.map(versionOf).filter(Boolean))].sort(compareVersionDesc);
  const keepSet = new Set(versions.slice(0, keep));
  const removed = [];
  for (const name of entries) {
    const v = versionOf(name);
    if (v && !keepSet.has(v)) {
      await fs.rm(path.join(RELEASE_DIR, name), { force: true, recursive: true }).catch(() => {});
      removed.push(name);
    }
  }
  return { kept: [...keepSet], removed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { kept, removed } = await pruneReleaseDir();
  console.log(`prune release/: 保留版本 [${kept.join(', ') || '-'}]`);
  console.log(removed.length ? `  已删除: ${removed.join(', ')}` : '  无旧版本需清理');
}
