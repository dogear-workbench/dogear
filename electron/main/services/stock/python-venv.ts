/**
 * Python venv 管理（darwin 专用）
 *
 * Homebrew Python 受 PEP 668 保护，pip 直装系统解释器会被拒绝（externally-managed-environment），
 * 因此 darwin 下股票计算层依赖统一装入 userData 下的 venv；Windows 保持系统直装链路不走此模块。
 */

import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import electron from 'electron';

const { app } = electron;

const VENV_DIR_NAME = 'python-venv';
const MIN_PYTHON = { major: 3, minor: 10 };

const EXEC_OPTS = { timeout: 5000, encoding: 'utf-8' as const, stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'] };

export interface PythonVersion {
  major: number;
  minor: number;
}

export function parsePythonVersion(output: string): PythonVersion | null {
  const m = output.match(/Python\s+(\d+)\.(\d+)/);
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : null;
}

export function isSupportedVersion(v: PythonVersion | null): boolean {
  return !!v
    && (v.major > MIN_PYTHON.major
      || (v.major === MIN_PYTHON.major && v.minor >= MIN_PYTHON.minor));
}

export function getVenvDir(): string {
  // Worker 线程无 electron app，与 python-bridge 的 userData 回退模式一致
  const base = app?.getPath('userData') ?? process.cwd();
  return path.join(base, VENV_DIR_NAME);
}

export function getVenvPythonPath(): string {
  return path.join(getVenvDir(), 'bin', 'python');
}

/** darwin 的 userData 绝对路径常含空格（Application Support），shell 字符串命令需引号 */
export function shellQuotePath(p: string): string {
  return p.includes(' ') ? `"${p}"` : p;
}

function execVersion(cmd: string): string | null {
  try {
    return execSync(cmd, EXEC_OPTS).trim();
  } catch {
    return null;
  }
}

/** 探测系统 Python 3.10+（Homebrew / python.org / Xcode CLT 3.10+ 均可命中） */
export function detectSystemPython3(): { cmd: string; version: string } | null {
  for (const cmd of ['python3', 'python']) {
    const out = execVersion(`${cmd} --version`);
    if (!out) continue;
    if (isSupportedVersion(parsePythonVersion(out))) {
      return { cmd, version: out.replace('Python ', '') };
    }
  }
  return null;
}

/**
 * venv 解释器可用性：存在 + 可执行 + 版本达标 + pip 可用。
 * 半成品 venv（创建中断）、基于旧 Python 创建（base 升级后 symlink 断裂）、缺 pip 的 venv 均判不可用。
 */
export function probeVenvPython(): { ok: true; version: string } | { ok: false } {
  const p = getVenvPythonPath();
  if (!fs.existsSync(p)) return { ok: false };
  const out = execVersion(`${shellQuotePath(p)} --version`);
  if (!out || !isSupportedVersion(parsePythonVersion(out))) return { ok: false };
  const pip = execVersion(`${shellQuotePath(p)} -m pip --version`);
  if (!pip) return { ok: false };
  return { ok: true, version: out.replace('Python ', '') };
}

function describeError(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  if (code === 'ENOSPC') return '磁盘空间不足';
  if (code === 'EACCES' || code === 'EPERM') return '目录写权限不足';
  return err instanceof Error ? err.message : String(err);
}

function tryRemoveVenvDir(): void {
  try {
    fs.rmSync(getVenvDir(), { recursive: true, force: true });
  } catch {
    // 删除失败留给上层报错，不掩盖原始错误
  }
}

/**
 * darwin：确保 venv 存在且可用，返回 venv python 路径与是否发生了（重）创建。
 * 重建后第三方依赖必然缺失，调用方需重置依赖验证缓存。
 */
export function ensureVenv(): { pythonPath: string; recreated: boolean } {
  const probe = probeVenvPython();
  if (probe.ok) {
    return { pythonPath: getVenvPythonPath(), recreated: false };
  }

  const venvDir = getVenvDir();
  if (fs.existsSync(venvDir)) {
    try {
      fs.rmSync(venvDir, { recursive: true, force: true });
    } catch (err) {
      throw new Error(`Python 虚拟环境已损坏且无法删除（${describeError(err)}）。目录: ${venvDir}`);
    }
  }

  const sys = detectSystemPython3();
  if (!sys) {
    throw new Error(
      '未找到 Python 3.10+。请先安装：\n' +
      '  brew install python3\n' +
      '或安装 Xcode Command Line Tools：\n' +
      '  xcode-select --install',
    );
  }

  try {
    execSync(`${sys.cmd} -m venv "${venvDir}"`, { timeout: 120_000, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    tryRemoveVenvDir();
    throw new Error(`Python 虚拟环境创建失败（${describeError(err)}）。目录: ${venvDir}`);
  }

  const recheck = probeVenvPython();
  if (!recheck.ok) {
    tryRemoveVenvDir();
    throw new Error(`Python 虚拟环境创建后不可用，已清理半成品目录。请重试；若反复失败请手动执行: ${sys.cmd} -m venv "${venvDir}"`);
  }

  return { pythonPath: getVenvPythonPath(), recreated: true };
}
