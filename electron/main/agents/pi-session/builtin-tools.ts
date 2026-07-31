/**
 * pi 会话的文件类内建工具：Read/Write/Edit/Bash。
 *
 * 直接复用 @earendil-works/pi-agent-core 公开导出的 harness 工具工厂函数
 * （createReadTool/createWriteTool/createEditTool/createBashTool），不引入 AgentHarness。
 * 决策见 step3-delivery.md：这几个工厂函数只依赖一个 `{ env }` 上下文对象（ExecutionEnv 接口），
 * 与 AgentHarness 的 turn/session 状态机无关；官方还导出了实现完整 ExecutionEnv 的
 * NodeExecutionEnv（`@earendil-works/pi-agent-core/node`），复用它可以省掉截断、diff 生成、
 * 跨平台 bash 探测（Windows 下找 Git Bash）、文件 mutation queue 等一整套已验证逻辑。
 *
 * 工厂函数产出的对象 execute 签名是 5 参（多一个 `{ env }` context），
 * 而 pi 的 Agent（非 AgentHarness）期待的 AgentTool.execute 是 4 参，
 * 这里用 wrapHarnessTool 把 env 提前绑定到闭包里，转成 pi 原生能吃的形状。
 */
import { createBashTool, createEditTool, createReadTool, createWriteTool, type AgentTool, type ExecutionEnv } from '@earendil-works/pi-agent-core';
import { WorkspaceExecutionEnv } from './workspace-execution-env.js';

interface HarnessToolLike {
  name: string;
  label: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parameters: any;
  execute: (
    toolCallId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params: any,
    signal: AbortSignal | undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onUpdate: ((partial: any) => void) | undefined,
    context: { env: ExecutionEnv },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<any>;
}

function wrapHarnessTool(tool: HarnessToolLike, env: ExecutionEnv): AgentTool {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    execute: (toolCallId, params, signal, onUpdate) => tool.execute(toolCallId, params, signal, onUpdate, { env }),
  };
}

/** 为指定工作区生成 Read/Write/Edit/Bash 四个 pi 原生 AgentTool，文件操作和 bash cwd 都限定在工作区内 */
export function createBuiltinFileTools(workspacePath: string): AgentTool[] {
  const env = new WorkspaceExecutionEnv(workspacePath);
  return [
    wrapHarnessTool(createReadTool(), env),
    wrapHarnessTool(createWriteTool(), env),
    wrapHarnessTool(createEditTool(), env),
    wrapHarnessTool(createBashTool(), env),
  ];
}
