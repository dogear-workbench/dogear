/**
 * pi 会话内建工具（Read/Write/Edit/Bash/Grep/Glob）共用的工作区路径边界校验。
 *
 * 比 workspace-fs-service.ts 的 resolveAndValidate 多一层符号链接逃逸检测：
 * 只做字符串前缀校验无法拦住"工作区内放一个指向工作区外的符号链接"这种手法，
 * 这里额外对已存在的最近祖先路径做 realpath 校验。
 */
import fs from 'fs/promises';
import path from 'path';

function assertSyntacticallyWithin(workspacePath: string, resolved: string, original: string): void {
  const rel = path.relative(workspacePath, resolved);
  if (rel === '') return;
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`路径越权：不允许访问工作区外的文件: ${original}`);
  }
}

/** 沿目录链向上找到最近一个真实存在的祖先，校验其 realpath 仍落在工作区 realpath 内 */
async function assertNoSymlinkEscape(workspacePath: string, resolved: string, original: string): Promise<void> {
  const workspaceReal = await fs.realpath(workspacePath).catch(() => workspacePath);
  let probe = resolved;
  for (;;) {
    try {
      const real = await fs.realpath(probe);
      const rel = path.relative(workspaceReal, real);
      if (rel !== '' && (rel.startsWith('..') || path.isAbsolute(rel))) {
        throw new Error(`路径越权：符号链接指向工作区外: ${original}`);
      }
      return;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('路径越权')) throw error;
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') return; // 权限等其它错误交给真实文件操作自然抛出
      const parent = path.dirname(probe);
      if (parent === probe) return;
      probe = parent;
    }
  }
}

/**
 * 将候选路径（相对或绝对）解析为工作区内的绝对路径，越权（含 `../` 穿越、符号链接逃逸）时抛出。
 */
export async function resolveWithinWorkspace(workspacePath: string, candidatePath: string): Promise<string> {
  const resolved = path.resolve(workspacePath, candidatePath);
  assertSyntacticallyWithin(workspacePath, resolved, candidatePath);
  await assertNoSymlinkEscape(workspacePath, resolved, candidatePath);
  return resolved;
}
