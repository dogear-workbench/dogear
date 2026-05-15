/**
 * 代理定义文件解析服务
 * 解析 .claude/agents/*.md 的 YAML frontmatter + Markdown body
 */
import path from 'path';
import { listAgentFiles, readAgentFile } from './claude-config-service.js';

/**
 * 解析后的代理定义
 */
export interface ParsedAgentDefinition {
  description: string;
  prompt: string;
  model?: string;
  tools?: string[];
  disallowedTools?: string[];
  maxTurns?: number;
  skills?: string[];
}

/**
 * 代理文件信息
 */
export interface AgentFileInfo {
  fileName: string;
  agentName: string;
  definition: ParsedAgentDefinition;
  filePath: string;
  source: 'file' | 'template';
}

/**
 * 从 Markdown 内容解析 frontmatter + body
 * 手写简单解析器，不引入额外依赖
 */
export function parseAgentMd(content: string): ParsedAgentDefinition {
  const lines = content.split(/\r?\n/);
  const result: ParsedAgentDefinition = { description: '', prompt: '' };

  // 查找 frontmatter 边界
  if (lines[0]?.trim() !== '---') {
    // 没有 frontmatter，整个内容作为 prompt
    result.prompt = content.trim();
    return result;
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    result.prompt = content.trim();
    return result;
  }

  // 解析 frontmatter（简单 YAML key: value 和 - item 列表）
  const headerLines = lines.slice(1, endIndex);
  let currentKey = '';
  let currentList: string[] | null = null;

  for (const line of headerLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // 列表项：- value
    if (trimmed.startsWith('- ') && currentKey) {
      if (!currentList) currentList = [];
      currentList.push(trimmed.slice(2).trim());
      continue;
    }

    // 如果上一个 key 是列表，保存
    if (currentList && currentKey) {
      setField(result, currentKey, currentList);
      currentList = null;
    }

    // key: value
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0) {
      currentKey = trimmed.slice(0, colonIndex).trim();
      const value = trimmed.slice(colonIndex + 1).trim();
      if (value) {
        // 有值，直接设置
        setField(result, currentKey, value);
        currentKey = '';
      }
      // 无值，可能是列表的开始
    }
  }

  // 最后一个 key 可能是列表
  if (currentList && currentKey) {
    setField(result, currentKey, currentList);
  }

  // body 作为 prompt
  result.prompt = lines.slice(endIndex + 1).join('\n').trim();

  return result;
}

/**
 * 设置解析结果字段
 */
function setField(result: ParsedAgentDefinition, key: string, value: string | string[]) {
  switch (key) {
    case 'description':
      result.description = String(value);
      break;
    case 'model':
      result.model = String(value);
      break;
    case 'maxTurns':
      result.maxTurns = parseInt(String(value), 10) || undefined;
      break;
    case 'tools':
      result.tools = Array.isArray(value) ? value : String(value).split(',').map((s) => s.trim());
      break;
    case 'disallowedTools':
      result.disallowedTools = Array.isArray(value) ? value : String(value).split(',').map((s) => s.trim());
      break;
    case 'skills':
      result.skills = Array.isArray(value) ? value : String(value).split(',').map((s) => s.trim());
      break;
  }
}

/**
 * 从代理定义生成 Markdown frontmatter + body
 */
export function serializeAgentMd(definition: ParsedAgentDefinition): string {
  const lines: string[] = ['---'];

  if (definition.description) {
    lines.push(`description: ${definition.description}`);
  }
  if (definition.model) {
    lines.push(`model: ${definition.model}`);
  }
  if (definition.maxTurns) {
    lines.push(`maxTurns: ${definition.maxTurns}`);
  }
  if (definition.tools && definition.tools.length > 0) {
    lines.push('tools:');
    for (const tool of definition.tools) {
      lines.push(`  - ${tool}`);
    }
  }
  if (definition.disallowedTools && definition.disallowedTools.length > 0) {
    lines.push('disallowedTools:');
    for (const tool of definition.disallowedTools) {
      lines.push(`  - ${tool}`);
    }
  }
  if (definition.skills && definition.skills.length > 0) {
    lines.push('skills:');
    for (const skill of definition.skills) {
      lines.push(`  - ${skill}`);
    }
  }

  lines.push('---');
  lines.push('');

  if (definition.prompt) {
    lines.push(definition.prompt);
  }

  return lines.join('\n');
}

/**
 * 加载工作区所有代理定义文件
 */
export async function loadWorkspaceAgents(workspacePath: string): Promise<AgentFileInfo[]> {
  const files = await listAgentFiles(workspacePath);
  const agents: AgentFileInfo[] = [];

  for (const fileName of files) {
    const content = await readAgentFile(workspacePath, fileName);
    if (!content) continue;

    try {
      const definition = parseAgentMd(content);
      agents.push({
        fileName,
        agentName: path.basename(fileName, '.md'),
        definition,
        filePath: `${workspacePath}/.claude/agents/${fileName}`,
        source: 'file',
      });
    } catch {
      console.warn(`解析代理文件失败: ${fileName}`);
    }
  }

  return agents;
}
