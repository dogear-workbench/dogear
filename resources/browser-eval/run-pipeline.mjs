import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
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

const profileDir = mkdtempSync(path.join(os.tmpdir(), 'dogear-eval-profile-'));
process.env.DOGEAR_CONFIG_DIR = profileDir;

const { readArticleWithBrowser } = await import(serviceUrl);
const { getBrowserManager } = await import(managerUrl);

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
