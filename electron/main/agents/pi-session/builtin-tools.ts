/**
 * pi 会话的内建工具：Read/Write/Edit/Bash(双轨) + read_terminal/kill_terminal。
 *
 * Read/Write/Edit 直接复用 @earendil-works/pi-agent-core 公开导出的工厂函数。
 * bash 为同名替换：AgentHarness 对重复工具名抛错（validateUniqueNames），因此不注册
 * pi-agent-core 的 createBashTool() 产物，而是自写同名工具（schema 兼容 command + timeout?，
 * 新增 run_in_background?），同步路径委托内部创建的原版实例；后台路径走 pty-service 的
 * PTY（立即返回，进程持续运行，用 read_terminal/kill_terminal 管理）。
 * 工具 execute 的 context 由 harness 按 turn 快照注入（PiSession 通过 toolContext: { env } 提供）。
 */
import { Type, type TSchema } from 'typebox';
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  type AgentHarnessTool,
  type ExecutionEnv,
} from '@earendil-works/pi-agent-core';
import {
  createTerminal,
  getScreenText,
  killTerminal,
  listTerminals,
} from '../../services/pty-service.js';

export interface BuiltinFileToolsOptions {
  /** 本会话 conversationId：后台命令创建的 PTY 归属会话，close 清理与 read/kill 归属判断都依赖它 */
  conversationId?: string;
  /** 后台 PTY 的 cwd 边界，与注入 env 的 allowedPaths 同源；缺省不做越权校验 */
  workspaceRoots?: string[];
}

type Ctx = { env: ExecutionEnv };
type HarnessTool<S extends TSchema = TSchema> = AgentHarnessTool<Ctx, S, unknown>;

/** Read/Write/Edit/Bash + read_terminal/kill_terminal；文件操作和 bash cwd 边界由注入的 WorkspaceExecutionEnv 负责 */
export function createBuiltinFileTools(options?: BuiltinFileToolsOptions): HarnessTool[] {
  return [
    createReadTool(),
    createWriteTool(),
    createEditTool(),
    createPtyBashTool(options),
    createReadTerminalTool(options),
    createKillTerminalTool(options),
  ];
}

const ptyBashSchema = Type.Object({
  command: Type.String({ description: 'The bash command to execute' }),
  timeout: Type.Optional(Type.Number({ description: 'Timeout in seconds (optional, no default timeout, sync mode only)' })),
  run_in_background: Type.Optional(Type.Boolean({ description: '设为 true 时命令在后台终端启动并立即返回，不等待结束' })),
});

function createPtyBashTool(options?: BuiltinFileToolsOptions): HarnessTool<typeof ptyBashSchema> {
  const syncBash = createBashTool();
  return {
    name: 'bash',
    label: 'bash',
    description:
      'Execute a bash command in the current working directory. Returns stdout and stderr (long output truncated). ' +
      '跑 dev server、watch、长驻服务等不会自行退出的命令时传 run_in_background: true：命令会在后台终端立即启动并持续运行，工具马上返回；' +
      '之后用 read_terminal 查看输出与运行状态，用 kill_terminal 终止。' +
      '其余命令保持默认（同步等待结果拿到输出再继续）。可选 timeout 为秒数（仅同步模式有效）。',
    parameters: ptyBashSchema,
    async execute(toolCallId, args, signal, onUpdate, context) {
      if (!args.run_in_background) {
        return syncBash.execute(toolCallId, args, signal, onUpdate, context);
      }
      try {
        const terminalId = await createTerminal({
          conversationId: options?.conversationId ?? null,
          command: args.command,
          cwd: context.env.cwd,
          workspaceRoots: options?.workspaceRoots,
        });
        return {
          content: [{
            type: 'text',
            text: `已在后台终端启动。terminalId: ${terminalId}\n命令: ${args.command}\n用 read_terminal 查看输出与状态；不再需要时用 kill_terminal 终止。`,
          }],
          details: null,
        };
      } catch (error) {
        throw new Error(`后台终端启动失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}

const readTerminalSchema = Type.Object({
  terminalId: Type.Optional(Type.String({ description: '终端 ID；缺省时列出当前会话名下的全部后台终端' })),
});

const READ_TERMINAL_MAX_CHARS = 8 * 1024;

function tailText(text: string, max = READ_TERMINAL_MAX_CHARS): string {
  const collapsed = text.replace(/\n{3,}/g, '\n\n');
  return collapsed.length > max ? `${collapsed.slice(0, 32)}\n...(中间输出已截断)...\n${collapsed.slice(collapsed.length - max)}` : collapsed;
}

function formatTerminalStatus(info: { command: string; exited: boolean; exitCode?: number }): string {
  const name = info.command || '(交互 shell)';
  return info.exited ? `${name} · 已退出 (exit ${info.exitCode})` : `${name} · 运行中`;
}

function createReadTerminalTool(options?: BuiltinFileToolsOptions): HarnessTool<typeof readTerminalSchema> {
  return {
    name: 'read_terminal',
    label: 'read_terminal',
    description:
      '读取后台终端的输出与状态（配合 bash 的 run_in_background: true 使用）。' +
      '不传 terminalId 时列出当前会话名下的全部后台终端；传入 terminalId 时返回该终端的状态（运行中/已退出）与尾部输出文本。',
    parameters: readTerminalSchema,
    async execute(_toolCallId, { terminalId }) {
      if (!terminalId) {
        const terminals = listTerminals(options?.conversationId);
        if (terminals.length === 0) {
          return { content: [{ type: 'text', text: '当前会话没有后台终端。' }], details: null };
        }
        const lines = terminals.map((t) => `- ${t.terminalId} | ${formatTerminalStatus(t)} | cwd: ${t.cwd}`);
        return { content: [{ type: 'text', text: `共 ${terminals.length} 个后台终端：\n${lines.join('\n')}` }], details: null };
      }
      const info = listTerminals().find((t) => t.terminalId === terminalId);
      if (!info) {
        throw new Error(`终端不存在: ${terminalId}`);
      }
      const screenText = getScreenText(terminalId) ?? '';
      const text = tailText(screenText);
      return {
        content: [{ type: 'text', text: `[${formatTerminalStatus(info)}]\n${text || '(暂无输出)'}` }],
        details: null,
      };
    },
  };
}

const killTerminalSchema = Type.Object({
  terminalId: Type.String({ description: '要终止的终端 ID' }),
});

function createKillTerminalTool(options?: BuiltinFileToolsOptions): HarnessTool<typeof killTerminalSchema> {
  return {
    name: 'kill_terminal',
    label: 'kill_terminal',
    description: '终止一个后台终端（配合 bash 的 run_in_background: true 使用）。只能终止当前会话名下的终端。',
    parameters: killTerminalSchema,
    async execute(_toolCallId, { terminalId }) {
      const owned = listTerminals(options?.conversationId).some((t) => t.terminalId === terminalId);
      if (!owned) {
        throw new Error(`终端不存在或不属于当前会话: ${terminalId}`);
      }
      killTerminal(terminalId);
      return { content: [{ type: 'text', text: `已终止终端 ${terminalId}` }], details: null };
    },
  };
}
