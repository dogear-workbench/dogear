import fs from 'node:fs/promises';
import path from 'node:path';

// ─── 文件级互斥锁 ───

const locks = new Map<string, Promise<void>>();

/**
 * 按文件路径加锁，确保同一文件不会被并发写入。
 */
export async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const normalizedPath = path.resolve(filePath);
  const prev = locks.get(normalizedPath) ?? Promise.resolve();
  let resolve!: () => void;
  const next = new Promise<void>((r) => { resolve = r; });
  locks.set(normalizedPath, next);

  await prev;
  try {
    return await fn();
  } finally {
    resolve();
    if (locks.get(normalizedPath) === next) {
      locks.delete(normalizedPath);
    }
  }
}

/**
 * 安全写入 JSON 文件（原子写入 + 备份）。
 * 1. 写入 .tmp 临时文件并验证 JSON 格式
 * 2. 备份原文件为 .bak
 * 3. 原子 rename .tmp → 目标文件
 */
export async function safeJsonWrite(filePath: string, data: unknown): Promise<void> {
  await withFileLock(filePath, async () => {
    const tmpPath = filePath + '.tmp';
    const bakPath = filePath + '.bak';
    const content = JSON.stringify(data, null, 2);

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(tmpPath, content, 'utf-8');

    // 验证写入内容可解析
    const verify = await fs.readFile(tmpPath, 'utf-8');
    JSON.parse(verify);

    // 备份原文件
    try {
      await fs.access(filePath);
      try { await fs.unlink(bakPath); } catch { /* .bak 不存在，忽略 */ }
      await fs.rename(filePath, bakPath);
    } catch {
      // 原文件不存在，跳过备份
    }

    await fs.rename(tmpPath, filePath);
  });
}

/**
 * 安全写入纯文本文件（非 JSON，不做 parse 验证）。
 */
export async function safeFileWrite(filePath: string, content: string): Promise<void> {
  await withFileLock(filePath, async () => {
    const tmpPath = filePath + '.tmp';
    const bakPath = filePath + '.bak';

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(tmpPath, content, 'utf-8');

    try {
      await fs.access(filePath);
      try { await fs.unlink(bakPath); } catch { /* 忽略 */ }
      await fs.rename(filePath, bakPath);
    } catch {
      // 原文件不存在
    }

    await fs.rename(tmpPath, filePath);
  });
}

/**
 * 安全读取 JSON 文件（主文件失败时从 .bak 恢复）。
 */
export async function safeJsonRead<T>(filePath: string, defaultValue: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (mainError) {
    console.warn(`[safeJsonRead] 主文件读取失败: ${filePath}`, mainError);
  }

  const bakPath = filePath + '.bak';
  try {
    const raw = await fs.readFile(bakPath, 'utf-8');
    const data = JSON.parse(raw) as T;
    console.warn(`[safeJsonRead] 从备份恢复成功: ${bakPath}`);
    try {
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch { /* 修复失败也没关系 */ }
    return data;
  } catch {
    console.warn(`[safeJsonRead] 备份也无法读取: ${bakPath}`);
  }

  return defaultValue;
}
