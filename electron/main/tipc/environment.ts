// electron/main/tipc/environment.ts
// 环境依赖检测 + Python 依赖安装

import { tipc } from '@egoist/tipc/main';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import electron from 'electron';
import {
  detectSystemPython3,
  ensureVenv,
  getVenvDir,
  getVenvPythonPath,
  probeVenvPython,
  shellQuotePath,
} from '../services/stock/python-venv.js';

const { app } = electron;
const t = tipc.create();

/** 单条依赖信息 */
interface DependencyInfo {
  name: string;
  version: string | null;
  installed: boolean;
  required: boolean;
  description?: string;
  installable?: boolean;
}

const EXEC_OPTS = { timeout: 5000, encoding: 'utf-8' as const, stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'] };

/** 安全执行命令，失败返回 null */
function tryExec(cmd: string): string | null {
  try {
    return execSync(cmd, EXEC_OPTS).trim();
  } catch {
    return null;
  }
}

/** 检测 Python 解释器（返回可用命令或 null） */
function detectPythonCmd(): { cmd: string; version: string } | null {
  // darwin：venv 优先，兜底系统 Python 3.10+（Xcode CLT 的 3.9 被版本解析拦住）
  if (process.platform === 'darwin') {
    const venv = probeVenvPython();
    if (venv.ok) return { cmd: getVenvPythonPath(), version: venv.version };
    return detectSystemPython3();
  }

  const candidates = process.platform === 'win32'
    ? ['python', 'python3', 'py']
    : ['python3', 'python'];

  for (const cmd of candidates) {
    const output = tryExec(`${cmd} --version`);
    if (output && output.startsWith('Python 3')) {
      const version = output.replace('Python ', '');
      return { cmd, version };
    }
  }
  return null;
}

/** 获取 Python 脚本目录（与 python-bridge.ts 同逻辑） */
function getPythonDir(): string {
  if (!app.isPackaged) {
    return path.join(process.cwd(), 'python');
  }
  return path.join(process.resourcesPath, 'python');
}

/** Python 包定义 */
const PYTHON_PACKAGES = [
  { pkg: 'pandas', name: 'pandas', description: '数据分析库' },
  { pkg: 'numpy', name: 'numpy', description: '数值计算库' },
  { pkg: 'akshare', name: 'akshare', description: 'A股数据接口' },
  { pkg: 'lark', name: 'lark', description: '公式解析引擎' },
] as const;

export const environmentRouter = {
  /** 渲染层平台探测（contextIsolation 下无 process.platform，UI 按平台适配如红绿灯让位） */
  getPlatform: t.procedure
    .action(async () => process.platform),

  /**
   * 检测所有环境依赖
   */
  checkEnvironment: t.procedure
    .action(async () => {
      const dependencies: DependencyInfo[] = [];

      // 1. Node.js（Electron 内置，基本都有）
      const nodeOutput = tryExec('node --version');
      dependencies.push({
        name: 'Node.js',
        version: nodeOutput,
        installed: !!nodeOutput,
        required: true,
        description: '运行时环境',
      });

      // 2. Git
      const gitOutput = tryExec('git --version');
      const gitVersion = gitOutput?.replace('git version ', '').split('.windows')[0] ?? null;
      dependencies.push({
        name: 'Git',
        version: gitVersion,
        installed: !!gitOutput,
        required: true,
        description: '快照安全网依赖',
      });

      // 3. Python
      const python = detectPythonCmd();
      dependencies.push({
        name: 'Python',
        version: python?.version ?? null,
        installed: !!python,
        required: false,
        description: '股票分析计算引擎',
      });

      // 4. Python 包（仅当 Python 存在时逐个检测）
      if (python) {
        // darwin venv 是含空格绝对路径，shell 字符串命令需引号；win 命令名原样
        const pyCmd = process.platform === 'darwin' ? shellQuotePath(python.cmd) : python.cmd;
        // 先快速检测是否全部可用
        const allOk = tryExec(`${pyCmd} -c "import pandas,numpy,akshare,lark"`);

        if (allOk !== null) {
          // 全部可用，逐个获取版本
          for (const { pkg, name, description } of PYTHON_PACKAGES) {
            const ver = tryExec(`${pyCmd} -c "import ${pkg}; print(${pkg}.__version__)"`);
            dependencies.push({
              name,
              version: ver,
              installed: true,
              required: false,
              description,
              installable: true,
            });
          }
        } else {
          // 逐个检测
          for (const { pkg, name, description } of PYTHON_PACKAGES) {
            const ver = tryExec(`${pyCmd} -c "import ${pkg}; print(${pkg}.__version__)"`);
            dependencies.push({
              name,
              version: ver,
              installed: ver !== null,
              required: false,
              description,
              installable: true,
            });
          }
        }
      } else {
        // Python 不存在，仍然列出包（全部未安装）
        for (const { name, description } of PYTHON_PACKAGES) {
          dependencies.push({
            name,
            version: null,
            installed: false,
            required: false,
            description,
            installable: true,
          });
        }
      }

      return { dependencies };
    }),

  /**
   * 安装 Python 依赖（pip install -r requirements.txt）
   */
  installPythonDeps: t.procedure
    .action(async () => {
      // darwin：依赖装入 venv（venv 不存在/损坏时先创建/重建），PEP 668 下系统 pip 不可写
      if (process.platform === 'darwin') {
        let pythonPath: string;
        try {
          pythonPath = ensureVenv().pythonPath;
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }

        const reqFile = path.join(getPythonDir(), 'requirements.txt');
        if (!fs.existsSync(reqFile)) {
          return { error: `requirements.txt 不存在: ${reqFile}` };
        }

        try {
          execSync(
            `${shellQuotePath(pythonPath)} -m pip install -r "${reqFile}" --quiet`,
            {
              timeout: 300_000,
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe'],
            },
          );
          return { success: true };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('No module named pip')) {
            return {
              error: `venv 中 pip 缺失，请删除目录后重试: ${getVenvDir()}`,
            };
          }
          return {
            error: `安装失败: ${msg.slice(0, 500)}`,
          };
        }
      }

      const python = detectPythonCmd();
      if (!python) {
        return { error: 'Python 3 未找到。请先安装 Python 3.10+ 并确保在 PATH 中。' };
      }

      const reqFile = path.join(getPythonDir(), 'requirements.txt');
      if (!fs.existsSync(reqFile)) {
        return { error: `requirements.txt 不存在: ${reqFile}` };
      }

      try {
        execSync(
          `${python.cmd} -m pip install -r "${reqFile}" --quiet`,
          {
            timeout: 300_000,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        );
        return { success: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // 检查是否 pip 不可用
        if (msg.includes('No module named pip')) {
          return {
            error: `pip 未安装。请先执行: ${python.cmd} -m ensurepip --upgrade`,
          };
        }
        return {
          error: `安装失败: ${msg.slice(0, 500)}`,
        };
      }
    }),
};
