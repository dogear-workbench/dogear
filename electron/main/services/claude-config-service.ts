/**
 * 提示词文件（agent.md）+ .claude/agents/ 子目录管理服务
 *
 * agent.md 路径（与 pi-session 读取路径对齐）：
 *   工作区级：.dogear/workspaces/{workspaceId}/agent.md
 *   用户级：.dogear/agent.md
 *
 * agents/ 子目录仍保留在 .claude/agents/（Claude SDK 约定路径）。
 */
import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron';

/**
 * agent.md 状态
 */
export interface AgentMdStatus {
  hasWorkspaceAgentMd: boolean;  // .dogear/workspaces/{id}/agent.md
  hasUserAgentMd: boolean;       // .dogear/agent.md
}

/**
 * 获取 .dogear 配置目录（与 settings-service getConfigDir 一致）
 */
function getConfigDir(): string {
  if (process.env.DOGEAR_CONFIG_DIR) return process.env.DOGEAR_CONFIG_DIR;
  if (app?.isPackaged) return path.join(app.getPath('userData'), '.dogear');
  return path.join(process.cwd(), '.dogear');
}

/**
 * 获取工作区 agent.md 目录：.dogear/workspaces/{workspaceId}/
 */
function getWorkspaceAgentDir(workspaceId: string): string {
  return path.join(getConfigDir(), 'workspaces', workspaceId);
}

/**
 * 获取 agent.md 状态（工作区级 + 用户级）
 */
export async function getAgentMdStatus(workspaceId: string): Promise<AgentMdStatus> {
  const status: AgentMdStatus = {
    hasWorkspaceAgentMd: false,
    hasUserAgentMd: false,
  };

  try {
    await fs.access(path.join(getWorkspaceAgentDir(workspaceId), 'agent.md'));
    status.hasWorkspaceAgentMd = true;
  } catch {
    // 不存在
  }

  try {
    await fs.access(path.join(getConfigDir(), 'agent.md'));
    status.hasUserAgentMd = true;
  } catch {
    // 不存在
  }

  return status;
}

/**
 * 初始化工作区 agent.md（创建目录和空文件）
 */
export async function initAgentMd(workspaceId: string): Promise<void> {
  const dir = getWorkspaceAgentDir(workspaceId);
  await fs.mkdir(dir, { recursive: true });

  const filePath = path.join(dir, 'agent.md');
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, '# 工作区指令\n\n在此编写给 AI 助手的工作区级别指令。\n', 'utf-8');
  }
}

/**
 * 读取工作区级 agent.md
 */
export async function readWorkspaceAgentMd(workspaceId: string): Promise<string | null> {
  const filePath = path.join(getWorkspaceAgentDir(workspaceId), 'agent.md');
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * 写入工作区级 agent.md（自动创建目录）
 */
export async function writeWorkspaceAgentMd(workspaceId: string, content: string): Promise<void> {
  const dir = getWorkspaceAgentDir(workspaceId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'agent.md'), content, 'utf-8');
}

// ============================================================
// 用户级 agent.md（.dogear/agent.md）
// ============================================================

function getUserAgentMdPath(): string {
  return path.join(getConfigDir(), 'agent.md');
}

export async function readUserAgentMd(): Promise<string | null> {
  try {
    return await fs.readFile(getUserAgentMdPath(), 'utf-8');
  } catch {
    return null;
  }
}

export async function writeUserAgentMd(content: string): Promise<void> {
  const filePath = getUserAgentMdPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
}
