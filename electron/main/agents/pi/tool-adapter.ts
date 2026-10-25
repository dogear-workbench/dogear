import { z } from 'zod';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ToolRegistration } from '@earendil-works/pi-durable';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';

export type ToolResult = {
  content: Array<TextContent | ImageContent>;
  isError?: boolean
  /** 透传到 harness 工具结果，请求 harness 为后续请求挂载工具（写入 conversation modelTools，压缩后仍 offered） */
  control?: { addTools: string[] };
};

/** 中立化工具描述符。schema 统一用 z.object({...})，toPiTools 负责转成 pi AgentTool */
export interface ToolDef {
  name: string;
  shortDescription: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any) => Promise<ToolResult>;
  /** 按需挂载：不随请求下发，模型经 tool_search 搜索加载后才可用 */
  deferred?: true;
  /** 崩溃恢复时允许重跑，只可标注幂等只读工具；有副作用的工具绝不标注 */
  replay?: 'safe';
  /** harness 层输出上限（缺省 50KB/2000 行/保留头部），超限截断并附 truncated 诊断 */
  outputLimits?: { maxBytes?: number; maxLines?: number; retain?: 'head' | 'tail' };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prepareArguments?: (args: unknown) => any;
}

/** 类型安全的 ToolDef 创建辅助，泛型约束在调用点做类型检查，返回公共 ToolDef 类型 */
export function defineTool<S extends z.ZodObject<z.ZodRawShape>>(
  name: string,
  shortDescription: string,
  description: string,
  schema: S,
  handler: (args: z.infer<S>) => Promise<ToolResult>,
  extras?: Pick<ToolDef, 'replay' | 'outputLimits' | 'prepareArguments'>,
): ToolDef {
  return { name, shortDescription, description, schema, handler, ...extras };
}

/** 校验参数并执行 handler，isError 时抛错（调用方按目标工具体系包装返回形状） */
async function runToolDef(def: ToolDef, params: unknown): Promise<ToolResult> {
  const result = await def.handler(def.schema.parse(params));
  if (result.isError) throw new Error(result.content.map((c) => (c.type === 'text' ? c.text : '[image]')).join('\n'));
  return result;
}

function toolDefShape(def: ToolDef) {
  return {
    name: def.name,
    label: def.name,
    description: def.description,
    parameters: z.toJSONSchema(def.schema),
  };
}

export function toPiTools(defs: ToolDef[]): AgentTool[] {
  return defs.map((def) => ({
    ...toolDefShape(def),
    execute: async (_toolCallId: string, params: unknown) => {
      const { content } = await runToolDef(def, params);
      return { content, details: null };
    },
  })) as AgentTool[];
}

/** harness 侧注册用：ToolRegistration 形态（execute(args, api, context) 3 参签名，api/context 不使用） */
export function toHarnessTools(defs: ToolDef[]): ToolRegistration[] {
  return defs.map((def) => ({
    name: def.name,
    description: def.description,
    parameters: z.toJSONSchema(def.schema),
    ...(def.deferred ? { deferred: true as const } : {}),
    ...(def.replay ? { replay: def.replay } : {}),
    ...(def.outputLimits ? { outputLimits: def.outputLimits } : {}),
    ...(def.prepareArguments ? { prepareArguments: def.prepareArguments } : {}),
    async execute(args: unknown) {
      const { content, control } = await runToolDef(def, args);
      return { output: content, ...(control ? { control } : {}) };
    },
  }));
}

/** 工具组整体转按需挂载（deferred 第三态：装配处决定常驻还是按需，工具定义本身不感知） */
export function deferToolDefs(defs: ToolDef[]): ToolDef[] {
  return defs.map((def) => ({ ...def, deferred: true as const }));
}
