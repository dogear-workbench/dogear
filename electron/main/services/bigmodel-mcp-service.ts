/**
 * GLM Coding Plan 专属 MCP（streamable HTTP）轻量客户端
 *
 * 手写 JSON-RPC over HTTP，不引入 MCP SDK。智谱为 Coding Plan 用户提供两个远程
 * MCP Server（Bearer Key 认证）：web_search_prime（联网搜索）与 web_reader（网页读取）。
 * 协议流程：initialize → notifications/initialized → tools/call；
 * 响应兼容纯 JSON 与 SSE（text/event-stream）两种格式。
 *
 * 两个端点各自维护模块级连接状态：lazy init + 单飞防并发重复 init；
 * initialize 响应头带 Mcp-Session-Id 则缓存并在后续请求回传，不带则无状态直呼。
 */

const PROTOCOL_VERSION = '2025-03-26';
const REQUEST_TIMEOUT_MS = 60_000;

const BASE_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
} as const;

export const BIGMODEL_MCP_ENDPOINTS = {
  search: 'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp',
  reader: 'https://open.bigmodel.cn/api/mcp/web_reader/mcp',
} as const;

export class McpHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly rpcMessage?: string,
  ) {
    super(message);
    this.name = 'McpHttpError';
  }
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

interface McpCallResult {
  text: string;
  isError: boolean;
}

interface McpConnection {
  initPromise: Promise<string | null> | null;
  sessionId: string | null;
}

const connections = new Map<string, McpConnection>();

function getConnection(endpoint: string): McpConnection {
  let conn = connections.get(endpoint);
  if (!conn) {
    conn = { initPromise: null, sessionId: null };
    connections.set(endpoint, conn);
  }
  return conn;
}

function resetConnection(endpoint: string): void {
  connections.delete(endpoint);
}

function parseSseBody(body: string): JsonRpcResponse {
  const dataLines: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) throw new McpHttpError('MCP SSE 响应缺少 data 行', 0);
  try {
    return JSON.parse(dataLines.join('\n')) as JsonRpcResponse;
  } catch {
    throw new McpHttpError('MCP SSE data 行不是合法 JSON', 0);
  }
}

/** 单次 JSON-RPC POST：兼容纯 JSON 与 SSE 响应，返回解析后的 JSON-RPC body；HTTP 非 2xx / JSON-RPC error 抛 McpHttpError */
async function rpcRequest(
  endpoint: string,
  apiKey: string,
  sessionId: string | null,
  payload: Record<string, unknown>,
): Promise<JsonRpcResponse | null> {
  const headers: Record<string, string> = { ...BASE_HEADERS, Authorization: `Bearer ${apiKey}` };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new McpHttpError(`MCP 请求失败（网络错误或超时 ${REQUEST_TIMEOUT_MS / 1000}s）：${err instanceof Error ? err.message : String(err)}`, 0);
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new McpHttpError(`MCP 端点返回 HTTP ${res.status}${bodyText ? `：${bodyText.slice(0, 300)}` : ''}`, res.status);
  }

  if (payload.id === undefined) return null;

  const contentType = res.headers.get('content-type') ?? '';
  let body: JsonRpcResponse;
  if (contentType.includes('text/event-stream')) {
    body = parseSseBody(await res.text());
  } else {
    const raw = await res.text();
    try {
      body = JSON.parse(raw) as JsonRpcResponse;
    } catch {
      throw new McpHttpError(`MCP 响应不是合法 JSON：${raw.slice(0, 300)}`, 0);
    }
  }

  if (body.error) {
    throw new McpHttpError(`MCP JSON-RPC 错误（code ${body.error.code}）：${body.error.message}`, 200, body.error.message);
  }
  return body;
}

/** lazy initialize + 单飞：返回会话 id（服务端不下发则 null） */
async function ensureInitialized(endpoint: string, apiKey: string): Promise<string | null> {
  const conn = getConnection(endpoint);
  if (conn.initPromise) return conn.initPromise;

  conn.initPromise = (async () => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { ...BASE_HEADERS, Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'dogear', version: '1.0.0' },
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      const hint = res.status === 401 || res.status === 403
        ? '（API Key 无效或不是 GLM Coding Plan 专属 Key）'
        : '';
      throw new McpHttpError(`MCP initialize 失败 HTTP ${res.status}${hint}${bodyText ? `：${bodyText.slice(0, 300)}` : ''}`, res.status);
    }

    const contentType = res.headers.get('content-type') ?? '';
    let body: JsonRpcResponse;
    if (contentType.includes('text/event-stream')) {
      body = parseSseBody(await res.text());
    } else {
      body = (await res.json()) as JsonRpcResponse;
    }
    if (body.error) {
      throw new McpHttpError(`MCP initialize 被拒绝（code ${body.error.code}）：${body.error.message}`, 200, body.error.message);
    }

    const sessionId = res.headers.get('mcp-session-id');
    if (sessionId) conn.sessionId = sessionId;

    // notifications/initialized 是通知（无 id），成功与否不影响调用，失败静默
    await rpcRequest(endpoint, apiKey, sessionId, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }).catch(() => null);

    return sessionId;
  })();

  try {
    return await conn.initPromise;
  } catch (err) {
    // init 失败不缓存，下次调用重试
    resetConnection(endpoint);
    throw err;
  }
}

function isSessionError(err: unknown): boolean {
  if (!(err instanceof McpHttpError)) return false;
  if ([400, 404, 410].includes(err.status)) return true;
  return err.rpcMessage !== undefined && /session/i.test(err.rpcMessage);
}

async function toolsCall(
  endpoint: string,
  apiKey: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpCallResult> {
  let nextId = 10;
  const call = async (): Promise<McpCallResult> => {
    const body = await rpcRequest(endpoint, apiKey, getConnection(endpoint).sessionId, {
      jsonrpc: '2.0',
      id: nextId++,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    });
    const result = body?.result as
      | { content?: Array<{ type?: string; text?: string }>; isError?: boolean }
      | undefined;
    if (!result || !Array.isArray(result.content)) {
      throw new McpHttpError(`MCP tools/call(${toolName}) 响应缺少 result.content`, 0);
    }
    const text = result.content
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string)
      .join('\n');
    return { text: text || `（${toolName} 返回空内容）`, isError: result.isError === true };
  };

  try {
    return await call();
  } catch (err) {
    if (!isSessionError(err)) throw err;
    // 会话失效：重置连接重新 initialize 后重试一次
    resetConnection(endpoint);
    await ensureInitialized(endpoint, apiKey);
    return await call();
  }
}

export async function callBigmodelTool(
  endpoint: string,
  apiKey: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpCallResult> {
  await ensureInitialized(endpoint, apiKey);
  return toolsCall(endpoint, apiKey, toolName, args);
}
