import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = path.resolve(here, '..', '..');
const serviceUrl = pathToFileURL(
  path.join(projectRoot, 'dist', 'main', 'services', 'browser', 'browser-article-service.js'),
).href;
const managerUrl = pathToFileURL(
  path.join(projectRoot, 'dist', 'main', 'services', 'browser', 'browser-manager.js'),
).href;
const articleServiceUrl = pathToFileURL(
  path.join(projectRoot, 'dist', 'main', 'services', 'article-service.js'),
).href;
const searchServiceUrl = pathToFileURL(
  path.join(projectRoot, 'dist', 'main', 'services', 'browser', 'browser-search-service.js'),
).href;

const profileDir = mkdtempSync(path.join(os.tmpdir(), 'dogear-eval-profile-'));
process.env.DOGEAR_CONFIG_DIR = profileDir;

const { readArticleWithBrowser } = await import(serviceUrl);
const { getBrowserManager } = await import(managerUrl);
const { fetchRawHtml, FetchError, isBrowserRetryableFetchError } = await import(articleServiceUrl);
const { searchWeb, clampMaxResults } = await import(searchServiceUrl);

const tasks = JSON.parse(readFileSync(path.join(here, 'tasks.json'), 'utf-8')).tasks;
const resolveUrl = (tpl) => tpl.replace('{{BASE}}', pathToFileURL(here.replace(/[\\/]$/, '')).href);

function assertTask(expect, result) {
  const failures = [];
  if (expect.ok !== undefined) {
    if (result.ok !== expect.ok) {
      failures.push(`ok 期望 ${expect.ok} 实际 ${result.ok}${result.ok ? '' : `（errorClass=${result.errorClass}，${result.message}）`}`);
    }
  }
  if (expect.errorClass !== undefined && !result.ok) {
    if (result.errorClass !== expect.errorClass) {
      failures.push(`errorClass 期望 ${expect.errorClass} 实际 ${result.errorClass}（${result.message}）`);
    }
  }
  if (result.ok) {
    const { meta } = result;
    for (const marker of expect.contains ?? []) {
      if (!meta.content.includes(marker)) failures.push(`content 应包含 ${marker}`);
    }
    for (const marker of expect.notContains ?? []) {
      if (meta.content.includes(marker)) failures.push(`content 不应包含 ${marker}`);
    }
    if (expect.titleContains && !meta.title.includes(expect.titleContains)) {
      failures.push(`title「${meta.title}」应包含「${expect.titleContains}」`);
    }
    if (expect.wordCountMin !== undefined && meta.wordCount < expect.wordCountMin) {
      failures.push(`wordCount ${meta.wordCount} 应 ≥ ${expect.wordCountMin}`);
    }
    if (expect.wordCountMax !== undefined && meta.wordCount > expect.wordCountMax) {
      failures.push(`wordCount ${meta.wordCount} 应 ≤ ${expect.wordCountMax}`);
    }
    if (expect.qualityHint === 'present' && !meta.qualityHint) {
      failures.push('qualityHint 应存在，实际为空');
    }
    if (expect.qualityHint === 'absent' && meta.qualityHint) {
      failures.push(`qualityHint 应为空，实际「${meta.qualityHint}」`);
    }
  } else if (
    expect.contains || expect.notContains || expect.titleContains
    || expect.wordCountMin !== undefined || expect.qualityHint
  ) {
    failures.push(`任务失败（${result.errorClass}），无法执行内容断言`);
  }
  return failures;
}

const ANTIBOT_ARTICLE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>反爬救活验证文章</title></head>
<body>
<article>
  <h1>反爬救活验证文章</h1>
  <p>DOGEAR-EVAL-MARK-ANTIBOT-1 本页面模拟轻反爬站点：静态 fetch 请求会被 403 拦截，
  只有携带真实浏览器指纹的导航请求才能拿到正文。DOGEAR-EVAL-MARK-ANTIBOT-1</p>
  <p>轻反爬前移的设计目标，是把那些对无头抓取不友好、但对真实浏览器渲染友好的页面，
  从「直接报错」变成「分流进浏览器层重试」。这类页面最典型的代表是启用了
  Cloudflare 挑战或自建 WAF 规则的内容站点，它们通常返回 403、429 或 503 状态码。</p>
  <p>分流判断只认结构化错误字段，不解析错误字符串：HTTP 状态码放在 status 字段，
  网络层错误码放在 code 字段。命中白名单的失败会跳过平台脚本与 Readability，
  因为此时根本拿不到原始 HTML，静态解析无从谈起，直接交给浏览器层拿真实渲染后的 DOM。</p>
  <p>浏览器层也救不活的场景则诚实报错：404、DNS 解析失败、SSL 证书错误、
  400、500、502、504 这些错误再怎么换渲染方式也无济于事，直接把结构化摘要返回给调用方，
  同时不创建 stub、不提交 AI 任务，避免用空壳内容误导用户。</p>
  <p>最后一段正文用于确保可见文本量超过渲染等待阈值，
  让管线的内容等待循环能够提前退出，缩短整体回归耗时。</p>
</article>
</body>
</html>`;

function startAntibotServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/blocked-article') {
        // undici fetch 不发 Sec-Fetch-* 头；真实浏览器导航带 sec-fetch-mode: navigate
        if (req.headers['sec-fetch-mode'] !== 'navigate') {
          res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('Forbidden');
          return;
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(ANTIBOT_ARTICLE_HTML);
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function closeServer(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

const SORRY_SERP_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>关于此网页上的异常流量</title></head>
<body>
<div>
  <p>我们的系统检测到您的计算机网络发出异常流量。此网页用于确认这些请求是由您而不是自动程序发出的。</p>
  <p>DOGEAR-EVAL-MARK-SORRY-PAGE 该页面模拟 Google 验证页，URL 含 /sorry/ 特征。</p>
</div>
</body>
</html>`;

const EMPTY_SERP_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>未找到结果</title></head>
<body>
<p>未找到与搜索匹配的结果。DOGEAR-EVAL-MARK-EMPTY-SERP 页面无任何 SERP 结构。</p>
</body>
</html>`;

function startSerpServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const route = (req.url || '').split('?')[0];
      const sendHtml = (html) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
      };
      if (route.startsWith('/sorry/')) {
        sendHtml(SORRY_SERP_HTML);
        return;
      }
      if (route.startsWith('/empty/')) {
        sendHtml(EMPTY_SERP_HTML);
        return;
      }
      if (route.startsWith('/ddg/')) {
        sendHtml(readFileSync(path.join(here, 'serp-ddg.html'), 'utf-8'));
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function assertSearchOutcome(failures, outcome, expect) {
  if (expect.ok !== undefined && outcome.ok !== expect.ok) {
    failures.push(`ok 期望 ${expect.ok} 实际 ${outcome.ok}${outcome.ok ? '' : `（errorClass=${outcome.errorClass}，${outcome.message}）`}`);
  }
  if (expect.engine !== undefined && outcome.engine !== expect.engine) {
    failures.push(`engine 期望 ${expect.engine} 实际 ${outcome.engine}`);
  }
  if (expect.ok === false) {
    if (expect.errorClass !== undefined && outcome.errorClass !== expect.errorClass) {
      failures.push(`errorClass 期望 ${expect.errorClass} 实际 ${outcome.errorClass}（${outcome.message}）`);
    }
    if (expect.degradationCount !== undefined && outcome.degradations.length !== expect.degradationCount) {
      failures.push(`degradations 长度期望 ${expect.degradationCount} 实际 ${outcome.degradations.length}`);
    }
    if (expect.messageContains && !outcome.message.includes(expect.messageContains)) {
      failures.push(`message 应包含「${expect.messageContains}」，实际「${outcome.message}」`);
    }
  }
  if (expect.ok === true) {
    const results = outcome.results;
    if (expect.count !== undefined && results.length !== expect.count) {
      failures.push(`结果条数期望 ${expect.count} 实际 ${results.length}`);
    }
    if (expect.maxCount !== undefined && results.length > expect.maxCount) {
      failures.push(`结果条数 ${results.length} 应 ≤ ${expect.maxCount}`);
    }
    results.forEach((r, i) => {
      if (r.rank !== i + 1) failures.push(`rank 应从 1 连续递增：results[${i}].rank=${r.rank}`);
      if (!r.title || !r.url || r.snippet === undefined) failures.push(`results[${i}] 字段缺失：${JSON.stringify(r)}`);
      if (!/^https?:/i.test(r.url)) failures.push(`results[${i}].url 应为 http(s) 绝对地址：${r.url}`);
    });
    for (const marker of expect.titlesContain ?? []) {
      if (!results.some((r) => r.title.includes(marker))) failures.push(`结果标题应包含「${marker}」`);
    }
    for (const bad of expect.urlExcludes ?? []) {
      if (results.some((r) => r.url.includes(bad))) failures.push(`结果 URL 不应包含「${bad}」`);
    }
    if (expect.degradationsEmpty && outcome.degradations.length !== 0) {
      failures.push(`degradations 应为空，实际 ${JSON.stringify(outcome.degradations)}`);
    }
    for (const d of expect.degradations ?? []) {
      const found = outcome.degradations.find((x) => x.from === d.from && x.to === d.to);
      if (!found) {
        failures.push(`应有降级记录 ${d.from}→${d.to}，实际 ${JSON.stringify(outcome.degradations)}`);
      } else if (d.reasonContains && !found.reason.includes(d.reasonContains)) {
        failures.push(`降级原因应包含「${d.reasonContains}」，实际「${found.reason}」`);
      }
    }
  }
}

async function runSearchTasks() {
  const { server, port } = await startSerpServer();
  const serpBase = `http://127.0.0.1:${port}`;
  const googleMockUrl = resolveUrl('{{BASE}}/serp-google.html');
  const ddgMockUrl = resolveUrl('{{BASE}}/serp-ddg.html');
  const bingMockUrl = resolveUrl('{{BASE}}/serp-bing.html');

  const searchCases = [
    {
      id: 'search-google-parse',
      scenario: 'Google mock SERP：5 条自然结果，顶部广告位与混排赞助商样本剔除',
      run: () => searchWeb('量子计算', { engine: 'google', serpUrls: { google: googleMockUrl } }),
      expect: {
        ok: true,
        engine: 'google',
        count: 5,
        titlesContain: ['DOGEAR-SERP-G1', 'DOGEAR-SERP-G5'],
        urlExcludes: ['ad.example-google-ads.com', 'ad.example-inline.com'],
        degradationsEmpty: true,
      },
    },
    {
      id: 'search-ddg-parse',
      scenario: 'DDG mock SERP：uddg 重定向参数解码为真实 URL，y.js 广告剔除',
      run: () => searchWeb('暗能量', { engine: 'ddg', serpUrls: { ddg: ddgMockUrl } }),
      expect: {
        ok: true,
        engine: 'ddg',
        count: 5,
        titlesContain: ['DOGEAR-SERP-D1', 'DOGEAR-SERP-D3', 'DOGEAR-SERP-D5'],
        urlExcludes: ['y.js', 'ad-ddg-example.com'],
        degradationsEmpty: true,
      },
      extraCheck: (failures, outcome) => {
        const first = outcome.results.find((r) => r.title.includes('DOGEAR-SERP-D1'));
        if (!first || first.url !== 'https://example.org/ddg-result-1') {
          failures.push(`uddg 参数应解码为 https://example.org/ddg-result-1，实际 ${first?.url}`);
        }
        const direct = outcome.results.find((r) => r.title.includes('DOGEAR-SERP-D3'));
        if (!direct || direct.url !== 'https://example.org/ddg-result-3-direct') {
          failures.push(`直接 https 链接应原样保留，实际 ${direct?.url}`);
        }
      },
    },
    {
      id: 'search-bing-parse',
      scenario: 'Bing mock SERP：6 条 b_algo 结果，b_ad 广告类剔除',
      run: () => searchWeb('深海', { engine: 'bing', serpUrls: { bing: bingMockUrl } }),
      expect: {
        ok: true,
        engine: 'bing',
        count: 6,
        titlesContain: ['DOGEAR-SERP-B1', 'DOGEAR-SERP-B6'],
        urlExcludes: ['ad-bing.example.com'],
        degradationsEmpty: true,
      },
    },
    {
      id: 'search-maxresults-clip',
      scenario: 'maxResults=3 真实裁剪 + clampMaxResults 夹紧（默认 8、下限 1、上限 15）',
      run: () => searchWeb('深海', { engine: 'bing', maxResults: 3, serpUrls: { bing: bingMockUrl } }),
      expect: {
        ok: true,
        engine: 'bing',
        count: 3,
        titlesContain: ['DOGEAR-SERP-B1'],
      },
      extraCheck: (failures, outcome) => {
        const cases = [
          [undefined, 8],
          [0, 1],
          [-5, 1],
          [3, 3],
          [8, 8],
          [16, 15],
          [99, 15],
        ];
        for (const [input, want] of cases) {
          const got = clampMaxResults(input);
          if (got !== want) failures.push(`clampMaxResults(${input}) 期望 ${want} 实际 ${got}`);
        }
        if (outcome.results.some((r) => r.title.includes('DOGEAR-SERP-B4'))) {
          failures.push('maxResults=3 不应包含第 4 条及之后的结果');
        }
      },
    },
    {
      id: 'search-auto-proxy-sorry-degrade',
      scenario: 'auto + 代理可达：Google 验证页（/sorry/）触发降级，DDG 兜底成功',
      run: (base) =>
        searchWeb('暗能量', {
          engine: 'auto',
          proxyServer: `127.0.0.1:${base.port}`,
          serpUrls: {
            google: `${base.url}/sorry/?q={q}`,
            ddg: `${base.url}/ddg/?q={q}`,
          },
        }),
      expect: {
        ok: true,
        engine: 'ddg',
        count: 5,
        titlesContain: ['DOGEAR-SERP-D1'],
        degradations: [{ from: 'google', to: 'ddg', reasonContains: '验证页' }],
      },
    },
    {
      id: 'search-auto-proxy-unreachable',
      scenario: 'auto + 代理不可达：健康探测失败，跳过代理引擎直接 Bing',
      run: () =>
        searchWeb('深海', {
          engine: 'auto',
          proxyServer: '127.0.0.1:1',
          serpUrls: { bing: bingMockUrl },
        }),
      expect: {
        ok: true,
        engine: 'bing',
        count: 6,
        degradationsEmpty: true,
      },
    },
    {
      id: 'search-auto-no-proxy-config',
      scenario: 'auto + 未配置代理：直接使用 Bing，不做探测',
      run: () => searchWeb('深海', { engine: 'auto', serpUrls: { bing: bingMockUrl } }),
      expect: {
        ok: true,
        engine: 'bing',
        count: 6,
        degradationsEmpty: true,
      },
    },
    {
      id: 'search-parse-empty-degrade',
      scenario: 'Google 解析空（parse_empty）降级 DDG 成功，降级原因记录',
      run: (base) =>
        searchWeb('量子计算', {
          engine: 'google',
          serpUrls: {
            google: `${base.url}/empty/?q={q}`,
            ddg: `${base.url}/ddg/?q={q}`,
          },
        }),
      expect: {
        ok: true,
        engine: 'ddg',
        count: 5,
        degradations: [{ from: 'google', to: 'ddg', reasonContains: '解析为空' }],
      },
    },
    {
      id: 'search-parse-empty-all-fail',
      scenario: '三级引擎全部解析空：整体失败 errorClass=parse_empty，降级链完整记录',
      run: (base) =>
        searchWeb('量子计算', {
          engine: 'google',
          serpUrls: {
            google: `${base.url}/empty/?q={q}`,
            ddg: `${base.url}/empty/?q={q}`,
            bing: `${base.url}/empty/?q={q}`,
          },
        }),
      expect: {
        ok: false,
        engine: 'bing',
        errorClass: 'parse_empty',
        degradationCount: 2,
        messageContains: '解析出结果',
      },
    },
  ];

  const base = { port, url: serpBase };
  try {
    for (const c of searchCases) {
      const startedAt = Date.now();
      let failures;
      let outcome;
      try {
        outcome = await c.run(base);
        failures = [];
        if (c.expect) assertSearchOutcome(failures, outcome, c.expect);
        if (c.extraCheck) c.extraCheck(failures, outcome);
      } catch (err) {
        failures = [`runner 异常：${err instanceof Error ? err.message : String(err)}`];
      }
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (failures.length === 0) {
        passed++;
        const summary = outcome?.ok
          ? `ok engine=${outcome.engine} results=${outcome.results.length}`
          : `errorClass=${outcome?.errorClass}`;
        rows.push({ id: c.id, status: 'PASS', detail: `${summary}（${seconds}s）` });
      } else {
        failed++;
        rows.push({ id: c.id, status: 'FAIL', detail: `${failures.join('；')}（${seconds}s）` });
      }
    }
  } finally {
    await closeServer(server);
  }
}

async function runAntibotTask(expect) {
  const failures = [];
  const { server, port } = await startAntibotServer();
  try {
    const blockedUrl = `http://127.0.0.1:${port}/blocked-article`;

    let fetchErr;

    try {
      await fetchRawHtml(blockedUrl);
      failures.push('fetchRawHtml 应被 403 拦截抛 FetchError，实际成功返回');
    } catch (err) {
      fetchErr = err;
      if (!(err instanceof FetchError)) {
        failures.push(`fetchRawHtml 应抛 FetchError，实际 ${err?.constructor?.name ?? typeof err}`);
      } else if (err.status !== 403) {
        failures.push(`FetchError.status 应为 403，实际 ${err.status}`);
      }
    }

    if (fetchErr && !isBrowserRetryableFetchError(fetchErr)) {
      failures.push('FetchError(status=403) 应命中浏览器分流白名单');
    }


    const result = await readArticleWithBrowser(blockedUrl, {
      taskMeta: { kind: 'article' },
      onAction: () => {},
    });
    if (!result.ok) {
      failures.push(`浏览器层应救活 403 页面，实际 errorClass=${result.errorClass}（${result.message}）`);
    } else {
      for (const marker of expect?.contains ?? []) {
        if (!result.meta.content.includes(marker)) failures.push(`content 应包含 ${marker}`);
      }
    }

    let notFoundErr;

    try {
      await fetchRawHtml(`http://127.0.0.1:${port}/plain-404`);
      failures.push('fetchRawHtml(404) 应抛 FetchError(status=404)，实际成功返回');
    } catch (err) {
      notFoundErr = err;
      if (!(err instanceof FetchError) || err.status !== 404) {
        failures.push(`404 应结构化为 FetchError(status=404)，实际 ${String(err)}`);
      }
      if (isBrowserRetryableFetchError(notFoundErr)) {
        failures.push('FetchError(status=404) 不应命中浏览器分流白名单');
      }
    }

    const denyCases = [
      new FetchError('not found', { status: 404 }),
      new FetchError('bad request', { status: 400 }),
      new FetchError('server error', { status: 500 }),
      new FetchError('bad gateway', { status: 502 }),
      new FetchError('gateway timeout', { status: 504 }),
      new FetchError('dns fail', { code: 'ENOTFOUND' }),
      new FetchError('cert fail', { code: 'CERT_HAS_EXPIRED' }),
      new FetchError('tls fail', { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }),
    ];
    const allowCases = [
      new FetchError('challenge', { status: 403 }),
      new FetchError('rate limit', { status: 429 }),
      new FetchError('service unavailable', { status: 503 }),
      new FetchError('reset', { code: 'ECONNRESET' }),
      new FetchError('timeout', { code: 'ETIMEDOUT' }),
      new FetchError('undici connect timeout', { code: 'UND_ERR_CONNECT_TIMEOUT' }),
    ];
    for (const c of denyCases) {
      if (isBrowserRetryableFetchError(c)) {
        failures.push(`白名单不应命中 ${JSON.stringify({ status: c.status, code: c.code })}`);
      }
    }
    for (const c of allowCases) {
      if (!isBrowserRetryableFetchError(c)) {
        failures.push(`白名单应命中 ${JSON.stringify({ status: c.status, code: c.code })}`);
      }
    }
  } finally {
    await closeServer(server);
  }
  return failures;
}

const rows = [];
let passed = 0;
let failed = 0;
let agentCount = 0;

for (const task of tasks) {
  if (task.type === 'agent') {
    agentCount++;
    rows.push({ id: task.id, status: 'SKIP-agent', detail: '模型任务不在零模型管线回归内，由 run-agent.mjs 单独采集，基线见 baseline.md' });
    continue;
  }
  const startedAt = Date.now();
  if (task.type === 'antibot') {
    let failures;
    try {
      failures = await runAntibotTask(task.expect);
    } catch (err) {
      failures = [`runner 异常：${err instanceof Error ? err.message : String(err)}`];
    }
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (failures.length === 0) {
      passed++;
      rows.push({ id: task.id, status: 'PASS', detail: `ok 白名单分流 → 浏览器层救活（${seconds}s）` });
    } else {
      failed++;
      rows.push({ id: task.id, status: 'FAIL', detail: `${failures.join('；')}（${seconds}s）` });
    }
    continue;
  }
  let result;
  try {
    result = await readArticleWithBrowser(resolveUrl(task.url), {
      taskMeta: { kind: 'article' },
      onAction: () => {},
    });
  } catch (err) {
    failed++;
    rows.push({ id: task.id, status: 'FAIL', detail: `runner 异常：${err instanceof Error ? err.message : String(err)}` });
    continue;
  }
  const failures = assertTask(task.expect ?? {}, result);
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  if (failures.length === 0) {
    passed++;
    const summary = result.ok
      ? `ok wordCount=${result.meta.wordCount} title=${result.meta.title}`
      : `errorClass=${result.errorClass}`;
    rows.push({ id: task.id, status: 'PASS', detail: `${summary}（${seconds}s）` });
  } else {
    failed++;
    rows.push({ id: task.id, status: 'FAIL', detail: `${failures.join('；')}（${seconds}s）` });
  }
}

await runSearchTasks();

await getBrowserManager().dispose();
try {
  rmSync(profileDir, { recursive: true, force: true });
} catch {
}

console.log('\n===== 浏览器管线回归报告（文章读取 + 搜索） =====');
for (const row of rows) {
  console.log(`[${row.status}] ${row.id} — ${row.detail}`);
}
console.log(`\n合计：${passed + failed} 管线任务 | PASS ${passed} | FAIL ${failed}${agentCount > 0 ? `（另有 ${agentCount} 个 agent 任务由 run-agent.mjs 采集，基线见 baseline.md）` : ''}`);
process.exit(failed > 0 ? 1 : 0);
