/**
 * pi 会话的内建工具：Read/Write/Edit/Bash(双轨) + read_terminal/kill_terminal。
 *
 * Read/Write/Edit 直接复用 @earendil-works/pi-durable 公开导出的工厂函数。
 * bash 为同名替换：durable 侧对重复工具名抛错（validateUniqueNames），因此不注册
 * pi-durable 的 createBashTool() 产物，而是自写同名工具（schema 兼容 command + timeout?，
 * 新增 run_in_background?），同步路径委托内部创建的原版实例；后台路径走 pty-service 的
 * PTY（立即返回，进程持续运行，用 read_terminal/kill_terminal 管理）。
 * 工具 execute 经 api.env 拿执行环境（由 harness 按 HarnessOptions.env 构建）。
 */
import path from 'path';
import { Type, type TSchema } from 'typebox';
import type { JsonValue } from '@earendil-works/chord';
import type { ToolRegistration } from '@earendil-works/pi-durable';
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  type ImageProcessor,
} from '@earendil-works/pi-durable/tools';
import { createNodePhotonImages } from '@earendil-works/pi-durable/images/node';
import {
  createTerminal,
  getScreenText,
  killTerminal,
  listTerminals,
} from '../../services/pty-service.js';
import { takeSnapshot, toGitPath, type SnapshotSource } from '../../services/git-service/index.js';

export interface BuiltinFileToolsOptions {
  /** 本会话 conversationId：后台命令创建的 PTY 归属会话，close 清理与 read/kill 归属判断都依赖它 */
  conversationId?: string;
  /** 后台 PTY 的 cwd 边界，与注入 env 的 allowedPaths 同源；缺省不做越权校验 */
  workspaceRoots?: string[];
  /** 影子快照归属的工作区；缺省不打快照 */
  workspaceId?: string;
}

const SYNC_BASH_DEFAULT_TIMEOUT_S = 600;

let photonImages: Promise<ImageProcessor> | undefined;

// createNodePhotonImages 异步返回而 ReadToolOptions.images 要同步对象；进程级单例让各会话共用同一个 worker（30s 空闲自动退出）
function photonImagesProcessor(): ImageProcessor {
  photonImages ??= createNodePhotonImages();
  const pending = photonImages;
  return {
    async prepare(bytes, mimeType, limits) {
      return (await pending).prepare(bytes, mimeType, limits);
    },
  };
}

/** Read/Write/Edit/Bash + read_terminal/kill_terminal；文件操作和 bash cwd 边界由注入的 WorkspaceExecutionEnv 负责 */
export function createBuiltinFileTools(options?: BuiltinFileToolsOptions): ToolRegistration[] {
  return [
    createReadTool({ images: photonImagesProcessor() }),
    withSnapshot(createWriteTool(), 'agent-write', options),
    withSnapshot(createEditTool(), 'agent-edit', options),
    createPtyBashTool(options),
    createReadTerminalTool(options),
    createKillTerminalTool(options),
  ];
}

/** 原工具成功后才触发快照；失败/中断不快照。快照异步不阻塞工具返回 */
function withSnapshot<S extends TSchema, D extends JsonValue>(
  tool: ToolRegistration<S, D>,
  source: SnapshotSource,
  options?: BuiltinFileToolsOptions,
): ToolRegistration<S, D> {
  return {
    ...tool,
    async execute(args, api, context) {
      const result = await tool.execute(args, api, context);
      snapshotAfterAgentMutation(source, args, options);
      return result;
    },
  };
}

/** 写入落在主根（workspaceRoots[0]，即影子 work-tree 边界）内才快照；附加根文件进不了影子仓库 */
function snapshotAfterAgentMutation(source: SnapshotSource, args: unknown, options?: BuiltinFileToolsOptions): void {
  const root = options?.workspaceRoots?.[0];
  const rawPath = (args as { path?: unknown } | undefined)?.path;
  if (!options?.workspaceId || !root || typeof rawPath !== 'string') return;
  const abs = path.resolve(root, rawPath);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return;
  takeSnapshot(options.workspaceId, root, source, toGitPath(rel), options.conversationId).catch((error) => {
    console.warn(`[git-snapshot] ${source} 快照失败:`, error);
  });
}

const ptyBashSchema = Type.Object({
  command: Type.String({ description: 'The bash command to execute' }),
  timeout: Type.Optional(Type.Number({ description: 'Timeout in seconds (sync mode, default 600)' })),
  run_in_background: Type.Optional(Type.Boolean({ description: '设为 true 时命令在后台终端启动并立即返回，不等待结束' })),
});

function createPtyBashTool(options?: BuiltinFileToolsOptions): ToolRegistration<typeof ptyBashSchema> {
  const syncBash = createBashTool();
  return {
    name: 'bash',
    description:
      'Execute a bash command in the current working directory. Returns stdout and stderr (long output truncated). ' +
      '跑 dev server、watch、长驻服务等不会自行退出的命令时传 run_in_background: true：命令会在后台终端立即启动并持续运行，工具马上返回；' +
      '之后用 read_terminal 查看输出与运行状态，用 kill_terminal 终止。' +
      '其余命令保持默认（同步等待结果拿到输出再继续，缺省 600 秒超时；需要更长的命令显式传 timeout 秒数，或改用 run_in_background）。',
    parameters: ptyBashSchema,
    async execute(args, api, context) {
      if (!args.run_in_background) {
        // 同步 bash 无 timeout 会无限等待，命令挂住即会话僵死的最常见源头，缺省注入超时兜底
        const syncArgs = args.timeout === undefined ? { ...args, timeout: SYNC_BASH_DEFAULT_TIMEOUT_S } : args;
        return syncBash.execute(syncArgs, api, context);
      }
      const env = api.env;
      if (!env) throw new Error('后台终端需要执行环境，当前调用未注入 env');
      try {
        const terminalId = await createTerminal({
          conversationId: options?.conversationId ?? null,
          command: args.command,
          cwd: env.cwd,
          workspaceRoots: options?.workspaceRoots,
        });
        return {
          output: [{
            type: 'text',
            text: `已在后台终端启动。terminalId: ${terminalId}\n命令: ${args.command}\n用 read_terminal 查看输出与状态；不再需要时用 kill_terminal 终止。`,
          }],
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

function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n');
}

function formatTerminalStatus(info: { command: string; exited: boolean; exitCode?: number }): string {
  const name = info.command || '(交互 shell)';
  return info.exited ? `${name} · 已退出 (exit ${info.exitCode})` : `${name} · 运行中`;
}

function createReadTerminalTool(options?: BuiltinFileToolsOptions): ToolRegistration<typeof readTerminalSchema> {
  return {
    name: 'read_terminal',
    description:
      '读取后台终端的输出与状态（配合 bash 的 run_in_background: true 使用）。' +
      '不传 terminalId 时列出当前会话名下的全部后台终端；传入 terminalId 时返回该终端的状态（运行中/已退出）与尾部输出文本。',
    parameters: readTerminalSchema,
    // 只读 PTY 屏幕缓冲，崩溃恢复重跑无副作用
    replay: 'safe',
    // 输出上限收口到 harness（保留尾部 8KB）；PTY 自身 scrollback 2000 行管历史保留，这里只管给模型的量
    outputLimits: { maxBytes: 8 * 1024, retain: 'tail' },
    async execute(args) {
      const { terminalId } = args;
      if (!terminalId) {
        const terminals = listTerminals(options?.conversationId);
        if (terminals.length === 0) {
          return { output: [{ type: 'text', text: '当前会话没有后台终端。' }] };
        }
        const lines = terminals.map((t) => `- ${t.terminalId} | ${formatTerminalStatus(t)} | cwd: ${t.cwd}`);
        return { output: [{ type: 'text', text: `共 ${terminals.length} 个后台终端：\n${lines.join('\n')}` }] };
      }
      const info = listTerminals().find((t) => t.terminalId === terminalId);
      if (!info) {
        throw new Error(`终端不存在: ${terminalId}`);
      }
      const screenText = getScreenText(terminalId) ?? '';
      const text = collapseBlankLines(screenText);
      return {
        output: [{ type: 'text', text: `[${formatTerminalStatus(info)}]\n${text || '(暂无输出)'}` }],
      };
    },
  };
}

const killTerminalSchema = Type.Object({
  terminalId: Type.String({ description: '要终止的终端 ID' }),
});

function createKillTerminalTool(options?: BuiltinFileToolsOptions): ToolRegistration<typeof killTerminalSchema> {
  return {
    name: 'kill_terminal',
    description: '终止一个后台终端（配合 bash 的 run_in_background: true 使用）。只能终止当前会话名下的终端。',
    parameters: killTerminalSchema,
    async execute({ terminalId }) {
      const owned = listTerminals(options?.conversationId).some((t) => t.terminalId === terminalId);
      if (!owned) {
        throw new Error(`终端不存在或不属于当前会话: ${terminalId}`);
      }
      killTerminal(terminalId);
      return { output: [{ type: 'text', text: `已终止终端 ${terminalId}` }] };
    },
  };
}
