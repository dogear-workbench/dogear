/**
 * GLM Coding Plan 联网 MCP 工具组
 *
 * 提供 2 个工具，走 GLM Coding Plan 套餐专属 MCP 额度（API 直出，不占浏览器会话）：
 *   - bigmodel__webSearch  — 全网搜索（web_search_prime，智谱服务端已从驼峰 webSearchPrime 改为下划线命名）
 *   - bigmodel__webReader  — 网页读取（webReader）
 *
 * 与浏览器的分工按会话实际能力两态化（fallbackHint）：主会话引导派「浏览器解析」子会话；
 * 子会话不提浏览器（不能派单）。
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

export type WebMcpFallbackHint = 'browser-subagent' | 'none';

const SEARCH_FALLBACK_TAILS: Record<WebMcpFallbackHint, string> = {
  'browser-subagent': '\n与浏览器的分工：本工具是快档（纯 API 直出）；深度阅读、翻页拼接或登录墙场景建议派「浏览器解析」子会话（profile: browser-parse）。',
  none: '',
};

const READER_FALLBACK_TAILS: Record<WebMcpFallbackHint, string> = {
  'browser-subagent': '\n与浏览器的分工：本工具是快档（服务端抓取，无 JS 渲染）；JS 渲染、页面交互或登录态场景建议派「浏览器解析」子会话（profile: browser-parse）。',
  none: '',
};

export function createWebMcpToolDefs(opts: { fallbackHint: WebMcpFallbackHint }): ToolDef[] {
  const { fallbackHint } = opts;
  return [
    defineTool(
      'bigmodel__webSearch',
      '联网搜索',
      '全网搜索，返回标题/URL/摘要等结果列表。走 GLM Coding Plan 专属 MCP 额度（web_search_prime），API 直出、速度快、不占浏览器会话；适合快速检索资讯与资料。\n' +
      '参数说明：\n' +
      '- query：搜索关键词，必填。\n' +
      '- count：返回条数，默认 10，最多 50。' +
      SEARCH_FALLBACK_TAILS[fallbackHint],
      z.object({
        query: z.string().min(1).describe('搜索关键词'),
        count: z.number().int().min(1).max(50).optional().describe('返回条数，默认 10，最多 50'),
      }),
      async (args) => {
        return runBigmodelTool(BIGMODEL_MCP_ENDPOINTS.search, 'web_search_prime', {
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
      '- url：要读取的网页地址（http/https），必填。' +
      READER_FALLBACK_TAILS[fallbackHint],
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
  placeholder: [{ fallbackHint: 'browser-subagent' }],
});
