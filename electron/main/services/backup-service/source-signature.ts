import { createHash } from 'crypto';
import { resolveSourceEntries } from './zip-pack.js';
import { collectPackFiles } from './zip-pack-core.js';

/**
 * 源内容签名：sha1(排序拼接的 `zip内路径|mtimeMs|size`)，hex；无任何存在文件 → null。
 * 遍历复用 packSources 同一套 resolveSourceEntries + collectPackFiles，保证签名集合 = 打包集合
 */
export async function computeSourceSignature(sources: string[]): Promise<string | null> {
  const files = await collectPackFiles(await resolveSourceEntries(sources));
  if (files.length === 0) return null;
  const lines = files.map((f) => `${f.entryPath}|${f.mtimeMs}|${f.size}`).sort();
  return createHash('sha1').update(lines.join('\n')).digest('hex');
}
