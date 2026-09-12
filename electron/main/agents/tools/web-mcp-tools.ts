/**
 * GLM Coding Plan 联网 MCP 工具组
 *
 * 提供 2 个工具，走 GLM Coding Plan 套餐专属 MCP 额度（API 直出，不占浏览器会话）：
 *   - bigmodel__webSearch  — 全网搜索（webSearchPrime）
 *   - bigmodel__webReader  — 网页读取（webReader）
 *
 * 与内嵌浏览器工具的分工：本组是 API 直出的快档，适合快速检索与简单页面读取；
 * 复杂渲染页面（JS 重度、登录墙）用浏览器工具（dogear__browser__*）。
 * API Key 在设置 → 基础设置 → 联网搜索（GLM MCP）填写，未配置时工具返回 isError 提示。
 */

import { z } from 'zod';
import { loadSettings } from '../../services/settings-service.js';
import { BIGMODEL_MCP_ENDPOINTS, callBigmodelTool, McpHttpError } from '../../services/bigmodel-mcp-service.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';

const NO_KEY_MESSAGE = '未配置 GLM Coding Plan API Key，请在设置 → 基础设置 → 联网搜索（GLM MCP）填写（Key 在智谱个人编程套餐 → 套餐概览页创建）';

async function runBigmodelTool(
  endpoint: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const settings = await loadSettings();
  const apiKey = settings.webMcpApiKey?.trim();
  if (!apiKey) {
    return { content: [{ type: 'text' as const, text: NO_KEY_MESSAGE }], isError: true };
  }
  try {
    const result = await callBigmodelTool(endpoint, apiKey, toolName, args);
    return {
      content: [{ type: 'text' as const, text: result.text }],
      isError: result.isError || undefined,
    };
  } catch (err) {
    const message = err instanceof McpHttpError
      ? `${toolName} 调用失败：${err.message}`
      : `${toolName} 调用失败：${err instanceof Error ? err.message : String(err)}`;
    return { content: [{ type: 'text' as const, text: message }], isError: true };
  }
}

export function createWebMcpToolDefs(): ToolDef[] {
  return [
    defineTool(
      'bigmodel__webSearch',
      '联网搜索',
      '全网搜索，返回标题/URL/摘要等结果列表。走 GLM Coding Plan 专属 MCP 额度（webSearchPrime），API 直出、速度快、不占浏览器会话；适合快速检索资讯与资料。\n' +
      '参数说明：\n' +
      '- query：搜索关键词，必填。\n' +
      '- count：返回条数，默认 10，最多 50。\n' +
      '与浏览器工具的分工：本工具是快档（纯 API 直出）；需要打开页面深度阅读、翻页或应对登录墙时改用 dogear__browser__* 系列工具。',
      z.object({
        query: z.string().min(1).describe('搜索关键词'),
        count: z.number().int().min(1).max(50).optional().describe('返回条数，默认 10，最多 50'),
      }),
      async (args) => {
        return runBigmodelTool(BIGMODEL_MCP_ENDPOINTS.search, 'webSearchPrime', {
          search_query: args.query,
          ...(args.count !== undefined ? { count: args.count } : {}),
        });
      },
    ),
    defineTool(
      'bigmodel__webReader',
      '读取网页',
      '抓取指定网页，返回标题、正文与元数据。走 GLM Coding Plan 专属 MCP 额度（webReader），API 直出、速度快、不占浏览器会话；适合读取静态文章与文档页。\n' +
      '参数说明：\n' +
      '- url：要读取的网页地址（http/https），必填。\n' +
      '与浏览器工具的分工：本工具是快档（服务端抓取，无 JS 渲染）；页面依赖前端渲染、需要交互或遇到登录墙时改用 dogear__browser__readArticle。',
      z.object({
        url: z.string().url().describe('要读取的网页地址（http/https）'),
      }),
      async (args) => {
        return runBigmodelTool(BIGMODEL_MCP_ENDPOINTS.reader, 'webReader', { url: args.url });
      },
    ),
  ];
}

registerToolGroup({
  server: 'dogear-web-mcp',
  label: '联网搜索（GLM MCP）',
  create: createWebMcpToolDefs,
});
