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

const profileDir = mkdtempSync(path.join(os.tmpdir(), 'dogear-eval-profile-'));
process.env.DOGEAR_CONFIG_DIR = profileDir;

const { readArticleWithBrowser } = await import(serviceUrl);
const { getBrowserManager } = await import(managerUrl);
const { fetchRawHtml, FetchError, isBrowserRetryableFetchError } = await import(articleServiceUrl);

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
let skipped = 0;

for (const task of tasks) {
  if (task.type === 'agent') {
    skipped++;
    rows.push({ id: task.id, status: 'SKIPPED-agent-not-configured', detail: 'Agent 任务层基线未配置，见 baseline.md' });
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

await getBrowserManager().dispose();
try {
  rmSync(profileDir, { recursive: true, force: true });
} catch {
}

console.log('\n===== 浏览器文章读取管线回归报告 =====');
for (const row of rows) {
  console.log(`[${row.status}] ${row.id} — ${row.detail}`);
}
console.log(`\n合计：${tasks.length} 任务 | PASS ${passed} | FAIL ${failed} | SKIP ${skipped}`);
process.exit(failed > 0 ? 1 : 0);
