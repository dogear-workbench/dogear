/**
 * 工作区共享常量
 * 与 electron/main/types.ts 保持一致（主进程 rootDir 限制无法跨目录 import）
 */

/**
 * personal 是保留字 workspaceId：内置隐藏工作区，承载随手问临时会话。
 * 不得注册进 workspaces.json，不得出现在工作区切换器、workspace-watcher、手动文件夹树。
 * 任何 workspaceId 消费方遇到它必须走特殊分支或显式放行。
 */
export const PERSONAL_WORKSPACE_ID = 'personal';
