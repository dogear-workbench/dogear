/**
 * 统一工具注册中心
 *
 * 所有工具组在此注册，设置页和 agent 从同一来源获取数据。
 * 注册条目 = 分类标识 + 中文名 + 工厂引用 + 占位参数。
 * 设置页调工厂提取 name/description（handler 不执行，传占位值安全）。
 */

import type { ToolDef } from '../pi/tool-adapter.js';

/** 工具展示元数据（给设置页用，从 ToolDef 提取） */
export interface ToolInfo {
  name: string;
  shortDescription: string;
  description: string;
}

/** 按分类分组后的工具列表（给设置页用） */
export interface ToolGroupInfo {
  server: string;
  label: string;
  tools: ToolInfo[];
}

/** 注册条目 */
export interface ToolGroupRegistration {
  server: string;
  label: string;
  create: (...args: never[]) => ToolDef[];
  /** 调工厂时的占位参数（给设置页提取元数据用），缺省为空数组 */
  placeholder?: unknown[];
}

const registrations: ToolGroupRegistration[] = [];

/** 注册一个工具组（在各工具文件末尾调用） */
export function registerToolGroup(group: ToolGroupRegistration): void {
  if (!registrations.some(g => g.server === group.server)) {
    registrations.push(group);
  }
}

/** 获取所有已注册的工具组（给 IPC 层遍历用） */
export function getRegistrations(): ToolGroupRegistration[] {
  return [...registrations];
}

/** 安全调工厂提取工具元数据（给设置页用） */
export function getAllToolGroups(): ToolGroupInfo[] {
  return registrations.map(({ server, label, create, placeholder }) => {
    let tools: ToolInfo[] = [];
    try {
      const defs = create(...(placeholder ?? []) as never[]);
      tools = defs.map(d => ({ name: d.name, shortDescription: d.shortDescription, description: d.description }));
    } catch {
      tools = [];
    }
    return { server, label, tools };
  });
}
