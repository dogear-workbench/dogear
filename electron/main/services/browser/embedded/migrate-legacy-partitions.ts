import { readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, session, type Cookie, type CookiesSetDetails, type Session } from 'electron';
import { GLOBAL_BROWSER_PARTITION } from './profile.js';

const LEGACY_DIR_PREFIX = 'dogear-browser-';
const MIGRATED_MARKER = 'dogear-migrated.marker';

function toCookieDetails(cookie: Cookie): CookiesSetDetails | null {
  if (!cookie.domain) return null;
  const hostOnly = cookie.hostOnly ?? !cookie.domain.startsWith('.');
  const host = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
  return {
    url: `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path || '/'}`,
    name: cookie.name,
    value: cookie.value,
    ...(hostOnly ? {} : { domain: cookie.domain }),
    path: cookie.path || '/',
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    ...(cookie.expirationDate !== undefined ? { expirationDate: cookie.expirationDate } : {}),
    ...(cookie.sameSite && cookie.sameSite !== 'unspecified' ? { sameSite: cookie.sameSite } : {}),
  };
}

export async function migrateLegacyBrowserPartitions(): Promise<void> {
  const partitionsDir = path.join(app.getPath('userData'), 'Partitions');
  let entries: string[];
  try {
    entries = await readdir(partitionsDir);
  } catch {
    return;
  }
  const legacyDirs = entries.filter((name) => name.startsWith(LEGACY_DIR_PREFIX));
  if (legacyDirs.length === 0) return;
  const target = session.fromPartition(GLOBAL_BROWSER_PARTITION);
  for (const dirName of legacyDirs) {
    const dirPath = path.join(partitionsDir, dirName);
    try {
      const markerPath = path.join(dirPath, MIGRATED_MARKER);
      if (await exists(markerPath)) {
        if (await cookiesModifiedAfterMarker(dirPath, markerPath)) {
          await mergePartitionCookies(target, dirPath, dirName);
        } else {
          await removeMigratedDir(dirPath, dirName);
        }
        continue;
      }
      await mergePartitionCookies(target, dirPath, dirName);
    } catch (err) {
      console.warn('[embedded-browser] 旧分区迁移失败，跳过:', dirName, err);
    }
  }
}

async function exists(p: string): Promise<boolean> {
  return stat(p).then(
    () => true,
    () => false,
  );
}

async function mergePartitionCookies(
  target: Session,
  dirPath: string,
  dirName: string,
): Promise<void> {
  const legacy = session.fromPartition(`persist:${dirName}`);
  const cookies = await legacy.cookies.get({});
  let failed = 0;
  for (const cookie of cookies) {
    const details = toCookieDetails(cookie);
    if (!details) {
      failed += 1;
      console.warn('[embedded-browser] 旧分区 cookie 缺少 domain，无法迁移:', dirName, cookie.name);
      continue;
    }
    try {
      await target.cookies.set(details);
    } catch (err) {
      failed += 1;
      console.warn('[embedded-browser] 旧分区 cookie 写入失败:', dirName, cookie.name, err);
    }
  }
  if (failed > 0) {
    console.warn(
      `[embedded-browser] 旧分区迁移不完整(${failed}/${cookies.length} 失败)，保留目录下次重试:`,
      dirName,
    );
    return;
  }
  await writeFile(path.join(dirPath, MIGRATED_MARKER), new Date().toISOString());
  console.log(`[embedded-browser] 旧分区 cookie 已合并进全局分区: ${dirName} (${cookies.length} 条)`);
}

/** marker 写入后分区又写入过 cookie（如旧版本应用运行期间），需重新合并而非直接删目录 */
async function cookiesModifiedAfterMarker(dirPath: string, markerPath: string): Promise<boolean> {
  const [markerStat, cookieStat] = await Promise.all([
    stat(markerPath),
    stat(path.join(dirPath, 'Network', 'Cookies')).catch(() => null),
  ]);
  if (!cookieStat) return false;
  return cookieStat.mtimeMs > markerStat.mtimeMs + 1000;
}

/** 旧分区 session 一旦在本进程打开，Windows 下句柄无法释放，只能留到下次启动直接删（不打开 session） */
async function removeMigratedDir(dirPath: string, dirName: string): Promise<void> {
  try {
    await rm(dirPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    console.log(`[embedded-browser] 已迁移旧分区目录已删除: ${dirName}`);
  } catch (err) {
    console.warn('[embedded-browser] 已迁移旧分区目录删除失败，下次启动重试:', dirName, err);
  }
}
