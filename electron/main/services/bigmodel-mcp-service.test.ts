import { describe, test, expect, afterAll } from 'bun:test';
import { callBigmodelTool, McpHttpError } from './bigmodel-mcp-service.js';

const servers: ReturnType<typeof Bun.serve>[] = [];

function startMockServer(handler: (req: Request) => Response | Promise<Response>): { url: string } {
  const server = Bun.serve({ port: 0, fetch: handler });
  servers.push(server);
  return { url: `http://localhost:${server.port}/mcp` };
}

afterAll(() => {
  for (const s of servers) s.stop(true);
});

function jsonResponse(id: number, result: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function sseResponse(id: number, result: unknown, headers: Record<string, string> = {}): Response {
  const body = `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result })}\n\n`;
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', ...headers },
  });
}

describe('bigmodel-mcp-service：纯 JSON 响应', () => {
  test('initialize + tools/call 正常链路，Authorization 头携带 Key', async () => {
    const seenAuth: string[] = [];
    let callCount = 0;
    const { url } = startMockServer(async (req) => {
      seenAuth.push(req.headers.get('authorization') ?? '');
      const body = (await req.json()) as { id?: number; method: string };
      callCount++;
      if (body.method === 'initialize') return jsonResponse(1, { protocolVersion: '2025-03-26' });
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
      if (body.method === 'tools/call') {
        return jsonResponse(body.id ?? 0, {
          content: [{ type: 'text', text: '[{"title":"t","url":"u"}]' }],
          isError: false,
        });
      }
      return jsonResponse(0, {});
    });

    const result = await callBigmodelTool(url, 'test-key', 'webSearchPrime', { search_query: 'ai' });
    expect(result.isError).toBe(false);
    expect(result.text).toContain('title');
    expect(seenAuth.every((a) => a === 'Bearer test-key')).toBe(true);
    expect(callCount).toBeGreaterThanOrEqual(3);
  });
});

describe('bigmodel-mcp-service：SSE 响应 + session id 回传', () => {
  test('SSE data 行解析出 JSON-RPC 结果，Mcp-Session-Id 在后续请求回传', async () => {
    const seenSessionIds: (string | null)[] = [];
    const { url } = startMockServer(async (req) => {
      seenSessionIds.push(req.headers.get('mcp-session-id'));
      const body = (await req.json()) as { id?: number; method: string };
      if (body.method === 'initialize') {
        return jsonResponse(1, { protocolVersion: '2025-03-26' }, { 'mcp-session-id': 'sess-123' });
      }
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
      return sseResponse(body.id ?? 0, { content: [{ type: 'text', text: 'ok-from-sse' }] });
    });

    const result = await callBigmodelTool(url, 'k', 'webReader', { url: 'https://example.com' });
    expect(result.text).toBe('ok-from-sse');
    expect(seenSessionIds[0]).toBeNull();
    expect(seenSessionIds[1]).toBe('sess-123');
    expect(seenSessionIds[2]).toBe('sess-123');
  });
});

describe('bigmodel-mcp-service：会话失效重试', () => {
  test('tools/call 404 → 重置连接重新 initialize 后重试成功', async () => {
    let sessionId: string | null = null;
    let failOnce = true;
    const initCount = { n: 0 };
    const { url } = startMockServer(async (req) => {
      if (req.headers.get('mcp-session-id') !== sessionId) {
        return new Response('session expired', { status: 404 });
      }
      const body = (await req.json()) as { id?: number; method: string };
      if (body.method === 'initialize') {
        initCount.n++;
        sessionId = `sess-${initCount.n}`;
        return jsonResponse(1, { protocolVersion: '2025-03-26' }, { 'mcp-session-id': sessionId });
      }
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
      if (failOnce) {
        failOnce = false;
        sessionId = null;
        return new Response('gone', { status: 410 });
      }
      return jsonResponse(body.id ?? 0, { content: [{ type: 'text', text: 'retry-ok' }] });
    });

    const result = await callBigmodelTool(url, 'k', 'webSearchPrime', { search_query: 'q' });
    expect(result.text).toBe('retry-ok');
    expect(initCount.n).toBe(2);
  });
});

describe('bigmodel-mcp-service：错误透传', () => {
  test('initialize 401 → 抛 McpHttpError 且带 Key 无效提示', async () => {
    const { url } = startMockServer(async () => new Response('unauthorized', { status: 401 }));
    try {
      await callBigmodelTool(url, 'bad-key', 'webSearchPrime', {});
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(McpHttpError);
      expect((err as McpHttpError).status).toBe(401);
      expect((err as McpHttpError).message).toContain('Coding Plan');
    }
  });

  test('tools/call 返回 isError=true → 透传给调用方', async () => {
    const { url } = startMockServer(async (req) => {
      const body = (await req.json()) as { id?: number; method: string };
      if (body.method === 'initialize') return jsonResponse(1, { protocolVersion: '2025-03-26' });
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
      return jsonResponse(body.id ?? 0, {
        content: [{ type: 'text', text: '上游搜索失败' }],
        isError: true,
      });
    });
    const result = await callBigmodelTool(url, 'k', 'webSearchPrime', { search_query: 'q' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('上游搜索失败');
  });
});
