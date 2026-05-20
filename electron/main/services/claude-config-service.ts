/**
 * 工作区 .claude 目录管理服务
 * 读写 CLAUDE.md、管理 agents/ 子目录
 */
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// .claude 目录结构
// <workspacePath>/.claude/
//   CLAUDE.md              — 工作区级指令文件
//   agents/                — 子代理定义（.md frontmatter 格式）

/**
 * .claude 目录状态
 */
export interface ClaudeDirStatus {
  exists: boolean;
  hasClaudeMd: boolean;
  hasAgentsDir: boolean;
  agentFiles: string[];  // .md 文件名列表
}

/**
 * 获取工作区 .claude 目录路径
 */
function getClaudeDir(workspacePath: string): string {
  return path.join(workspacePath, '.claude');
}

/**
 * 获取 .claude 目录状态
 */
export async function getClaudeDirStatus(workspacePath: string): Promise<ClaudeDirStatus> {
  const claudeDir = getClaudeDir(workspacePath);
  const status: ClaudeDirStatus = {
    exists: false,
    hasClaudeMd: false,
    hasAgentsDir: false,
    agentFiles: [],
  };

  try {
    await fs.access(claudeDir);
    status.exists = true;
  } catch {
    return status;
  }

  try {
    await fs.access(path.join(claudeDir, 'CLAUDE.md'));
    status.hasClaudeMd = true;
  } catch {
    // 不存在
  }

  const agentsDir = path.join(claudeDir, 'agents');
  try {
    await fs.access(agentsDir);
    status.hasAgentsDir = true;
    const entries = await fs.readdir(agentsDir);
    status.agentFiles = entries.filter((f) => f.endsWith('.md'));
  } catch {
    // 不存在
  }

  return status;
}

/**
 * 初始化 .claude 目录（创建目录和空 CLAUDE.md）
 */
export async function initClaudeDir(workspacePath: string): Promise<void> {
  const claudeDir = getClaudeDir(workspacePath);
  await fs.mkdir(claudeDir, { recursive: true });
  await fs.mkdir(path.join(claudeDir, 'agents'), { recursive: true });

  const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');
  try {
    await fs.access(claudeMdPath);
  } catch {
    // 文件不存在，创建空文件
    await fs.writeFile(claudeMdPath, '# 工作区指令\n\n在此编写给 AI 助手的工作区级别指令。\n', 'utf-8');
  }
}

/**
 * 读取工作区 CLAUDE.md
 */
export async function readClaudeMd(workspacePath: string): Promise<string | null> {
  const filePath = path.join(getClaudeDir(workspacePath), 'CLAUDE.md');
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * 写入工作区 CLAUDE.md（自动创建 .claude/ 目录）
 */
export async function writeClaudeMd(workspacePath: string, content: string): Promise<void> {
  const claudeDir = getClaudeDir(workspacePath);
  await fs.mkdir(claudeDir, { recursive: true });
  await fs.writeFile(path.join(claudeDir, 'CLAUDE.md'), content, 'utf-8');
}

// ============================================================
// 用户级 CLAUDE.md（~/.claude/CLAUDE.md）
// ============================================================

function getUserClaudeMdPath(): string {
  return path.join(os.homedir(), '.claude', 'CLAUDE.md');
}

export async function readUserClaudeMd(): Promise<string | null> {
  try {
    return await fs.readFile(getUserClaudeMdPath(), 'utf-8');
  } catch {
    return null;
  }
}

export async function writeUserClaudeMd(content: string): Promise<void> {
  const filePath = getUserClaudeMdPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
}

// ============================================================
// 子代理文件管理（供 P2 使用）
// ============================================================

/**
 * 列出 .claude/agents/ 下的所有 .md 文件名
 */
export async function listAgentFiles(workspacePath: string): Promise<string[]> {
  const agentsDir = path.join(getClaudeDir(workspacePath), 'agents');
  try {
    const entries = await fs.readdir(agentsDir);
    return entries.filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
}

/**
 * 读取代理文件的原始内容
 */
export async function readAgentFile(workspacePath: string, fileName: string): Promise<string | null> {
  // 安全检查：防止路径穿越
  if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    return null;
  }
  const filePath = path.join(getClaudeDir(workspacePath), 'agents', fileName);
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * 写入代理文件
 */
export async function writeAgentFile(workspacePath: string, fileName: string, content: string): Promise<void> {
  if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    throw new Error('非法文件名');
  }
  const agentsDir = path.join(getClaudeDir(workspacePath), 'agents');
  await fs.mkdir(agentsDir, { recursive: true });
  await fs.writeFile(path.join(agentsDir, fileName), content, 'utf-8');
}

/**
 * 删除代理文件
 */
export async function deleteAgentFile(workspacePath: string, fileName: string): Promise<void> {
  if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    throw new Error('非法文件名');
  }
  const filePath = path.join(getClaudeDir(workspacePath), 'agents', fileName);
  await fs.unlink(filePath);
}
