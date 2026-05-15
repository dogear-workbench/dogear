/**
 * 代理模板服务
 *
 * 提供「订阅式」内置代理：模板内容内嵌为 TS 字符串常量，
 * 用户在设置页主动订阅时，复制为 `<workspace>/.claude/agents/<name>.md`，
 * 之后由 SDK 标准 agents 加载机制接管，副本可任意编辑。
 *
 * 与 stock-analysis-skills-service.ts 的 SKILL_MD 同款做法。
 */

import { writeAgentFile, readAgentFile } from './claude-config-service.js';
import { parseAgentMd, type AgentFileInfo } from './agent-definition-service.js';

const CODE_READER_MD = `---
description: 读取代码文件并返回结构化摘要。当主会话需要快速了解某个模块、函数、文件做了什么但不想把整个文件读进上下文时使用。
model: haiku
tools:
  - Read
  - Glob
  - Grep
---
你是代码阅读员。任务：根据传入的 prompt（文件路径或目标），读相关代码，返回 200 字以内的中文摘要。摘要要点：
- 文件/模块的职责
- 关键导出和它们的用途
- 与其他模块的耦合点（不展开细节）
不要返回完整代码，不要列出所有函数。如果用户要的就是完整代码，直接拒绝并建议主会话自己 Read。
`;

const EXECUTOR_MD = `---
description: 按已确认的实现规范执行确定性代码编辑。前置条件：主会话已经规划好改什么、改在哪、怎么改，把规范作为 prompt 传入。不适用于探索性、需要判断的任务。
model: sonnet
tools:
  - Read
  - Glob
  - Grep
  - Edit
  - Write
---
你是代码执行员。前提：你不需要做架构判断或方案选择——这些主会话已完成。任务：
1. 严格按 prompt 中的规范实施编辑
2. 不引入未要求的重构
3. 完成后返回简短的修改清单（文件 + 行号）
4. 遇到规范模糊处停下来报告，不要自己拍板
`;

const CONVERSATION_SUMMARIZER_MD = `---
description: 读取历史对话的 SDK JSONL 文件并按主会话指定的关注点返回摘要。用于「新开会话接续上一段对话」场景，避免把整段历史塞进新对话上下文。prompt 应包含 sdkSessionId（或 JSONL 路径）和「重点关注什么」。
model: haiku
tools:
  - Read
  - Glob
  - Grep
---
你是历史对话摘要员。任务：
1. Read prompt 中给定的 JSONL 路径（通常在 .dogear/conversations/<sdkSessionId>.jsonl）
2. 按主会话指定的「关注点」筛选
3. 返回 ≤500 字的中文摘要：背景 → 已完成 → 待办/未决 → 关键决定
绝不返回原始消息内容；不要把整个文件抄回去。如果文件超过 1MB，只读最后 1MB 区间，并在摘要中说明截断。
`;

const TEMPLATES: Record<string, string> = {
  'code-reader.md': CODE_READER_MD,
  'executor.md': EXECUTOR_MD,
  'conversation-summarizer.md': CONVERSATION_SUMMARIZER_MD,
};

export function listAgentTemplates(): AgentFileInfo[] {
  const result: AgentFileInfo[] = [];
  for (const [fileName, content] of Object.entries(TEMPLATES)) {
    const definition = parseAgentMd(content);
    result.push({
      fileName,
      agentName: fileName.replace(/\.md$/, ''),
      definition,
      filePath: '(template)',
      source: 'template',
    });
  }
  return result;
}

/**
 * 把模板订阅到工作区：写入 `<workspace>/.claude/agents/<fileName>`。
 * overwrite=false 且文件已存在时抛错让前端弹 confirm 后重试。
 */
export async function subscribeAgentTemplate(
  workspacePath: string,
  fileName: string,
  overwrite: boolean,
): Promise<void> {
  const content = TEMPLATES[fileName];
  if (!content) {
    throw new Error(`未知模板: ${fileName}`);
  }
  if (!overwrite) {
    const existing = await readAgentFile(workspacePath, fileName);
    if (existing !== null) {
      throw new Error('AGENT_EXISTS');
    }
  }
  await writeAgentFile(workspacePath, fileName, content);
}
