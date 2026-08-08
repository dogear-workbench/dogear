import { z } from 'zod';
import { type AgentTool } from '@earendil-works/pi-agent-core';

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

/** 中立化工具描述符。schema 统一用 z.object({...})，toPiTools 负责转成 pi AgentTool */
export interface ToolDef {
  name: string;
  shortDescription: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any) => Promise<ToolResult>;
}

/** 类型安全的 ToolDef 创建辅助，泛型约束在调用点做类型检查，返回公共 ToolDef 类型 */
export function defineTool<S extends z.ZodObject<z.ZodRawShape>>(
  name: string,
  shortDescription: string,
  description: string,
  schema: S,
  handler: (args: z.infer<S>) => Promise<ToolResult>,
): ToolDef {
  return { name, shortDescription, description, schema, handler };
}

export function toPiTools(defs: ToolDef[]): AgentTool[] {
  return defs.map((def) => ({
    name: def.name,
    label: def.name,
    description: def.description,
    parameters: z.toJSONSchema(def.schema),
    execute: async (_toolCallId: string, params: unknown) => {
      const result = await def.handler(def.schema.parse(params));
      if (result.isError) throw new Error(result.content.map((c) => c.text).join('\n'));
      return { content: result.content, details: null };
    },
  })) as AgentTool[];
}
