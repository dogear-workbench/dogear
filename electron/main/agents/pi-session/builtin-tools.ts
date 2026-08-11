/**
 * pi 会话的文件类内建工具：Read/Write/Edit/Bash。
 *
 * 直接复用 @earendil-works/pi-agent-core 公开导出的 harness 工具工厂函数
 * （createReadTool/createWriteTool/createEditTool/createBashTool）。
 * AgentHarness 原生支持带 context 的工具（execute 第 5 参 context 由 harness 按 turn 快照注入），
 * 不再需要阶段二 Step 1 那层把 env 提前绑定到闭包里的 wrapHarnessTool 降级包装
 * （那是为了喂给裸 Agent 的 4 参 AgentTool 形状），env 现在统一由 PiSession 构造
 * AgentHarness 时通过 toolContext: { env } 注入。
 */
import { createBashTool, createEditTool, createReadTool, createWriteTool, type AgentHarnessTool, type ExecutionEnv } from '@earendil-works/pi-agent-core';
import { rewriteWithRtk } from './rtk-rewrite.js';

/** Read/Write/Edit/Bash 四个 harness 原生工具，文件操作和 bash cwd 边界由注入的 WorkspaceExecutionEnv 负责 */
export function createBuiltinFileTools(rtkEnabled: boolean = false): AgentHarnessTool<{ env: ExecutionEnv }>[] {
  return [
    createReadTool(),
    createWriteTool(),
    createEditTool(),
    createBashTool({
      prepare(execution) {
        if (rtkEnabled) execution.command = rewriteWithRtk(execution.command);
      },
    }),
  ];
}
