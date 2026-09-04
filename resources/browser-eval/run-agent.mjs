import { existsSync, copyFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');

const rawArgs = process.argv.slice(2);
function readArg(name) {
  const idx = rawArgs.indexOf(name);
  return idx >= 0 ? rawArgs[idx + 1] : undefined;
}
const onlyIds = readArg('--only')?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
const explicitModel = readArg('--model');

const profileDir = mkdtempSync(path.join(os.tmpdir(), 'dogear-agent-eval-'));
process.env.DOGEAR_CONFIG_DIR = profileDir;

const realSettingsPath = path.join(projectRoot, '.dogear', 'settings.json');
if (existsSync(realSettingsPath)) {
  copyFileSync(realSettingsPath, path.join(profileDir, 'settings.json'));
} else {
  console.error(`未找到真实设置文件（${realSettingsPath}），无法获得模型 API 配置`);
  process.exit(2);
}

register('./electron-hooks.mjs', pathToFileURL(path.join(here, 'electron-hooks.mjs')).href);

const piSessionUrl = pathToFileURL(path.join(projectRoot, 'dist', 'main', 'agents', 'pi-session', 'pi-session.js')).href;
const settingsServiceUrl = pathToFileURL(path.join(projectRoot, 'dist', 'main', 'services', 'settings-service.js')).href;
const browserManagerUrl = pathToFileURL(path.join(projectRoot, 'dist', 'main', 'services', 'browser', 'browser-manager.js')).href;

const { PiSession } = await import(piSessionUrl);
const { loadSettings, createDefaultBasicToolPermissions, BROWSER_PARSE_SUB_AGENT_PROFILE_ID } = await import(settingsServiceUrl);
const { getBrowserManager } = await import(browserManagerUrl);

const TASK_TIMEOUT_MS = 8 * 60 * 1000;
const CHEAP_TIERS = ['glm-4.5-air', 'deepseek-v4-flash', 'claude-haiku-4.5', 'glm-4-flash', 'deepseek-chat'];

function isProfileComplete(p) {
  return !!p?.apiKey && !!p?.baseUrl && (p.piModels?.length ?? 0) > 0;
}

function pickModelSelection(settings) {
  if (explicitModel) {
    const [profileId, tier] = explicitModel.split(':');
    const profile = settings.profiles[profileId];
    if (!profile || !isProfileComplete(profile)) throw new Error(`--model 指定的方案「${profileId}」不存在或配置不完整`);
    if (!(profile.piModels ?? []).some((m) => m.id === tier)) throw new Error(`模型「${tier}」不在方案「${profileId}」的清单里`);
    return { profileId, tier };
  }
  for (const tier of CHEAP_TIERS) {
    for (const profile of Object.values(settings.profiles)) {
      if (isProfileComplete(profile) && (profile.piModels ?? []).some((m) => m.id === tier)) {
        return { profileId: profile.id, tier };
      }
    }
  }
  const fallback = Object.values(settings.profiles).find(isProfileComplete);
  if (!fallback) throw new Error('没有任何配置完整的模型方案，无法执行 agent 任务');
  console.warn(`未命中已知便宜档，回退方案「${fallback.name}」首个模型`);
  return { profileId: fallback.id, tier: fallback.piModels[0].id };
}

const resolveUrl = (tpl) => tpl.replace('{{BASE}}', pathToFileURL(here.replace(/[\\/]$/, '')).href);

async function runAgentTask(task, modelSelection, subAgentProfile) {
  const wsDir = mkdtempSync(path.join(os.tmpdir(), 'dogear-agent-ws-'));
  const session = new PiSession(randomUUID(), {
    conversationId: `eval-${task.id}`,
    modelSelection,
    workspacePath: wsDir,
    additionalPaths: [],
    workspaceId: 'eval-browser-agent',
    harnessSessionId: null,
    enabledToolPacks: [],
    role: 'sub',
    subAgentProfile,
    permissionMode: 'autoExecute',
    basicToolPermissions: createDefaultBasicToolPermissions(),
  });

  let steps = 0;
  let toolCalls = [];
  let allText = '';
  let errMsgs = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let turnResult = null;

  session.on('message', (m) => {
    if (m.type === 'tool_use') {
      steps += 1;
      toolCalls.push(m.toolName);
    } else if (m.type === 'tool_result') {
      allText += `\n${m.toolOutput ?? ''}`;
    } else if (m.type === 'text') {
      allText += m.content ?? '';
    } else if (m.type === 'error') {
      errMsgs.push(m.error);
    }
  });
  session.on('complete', (r) => { turnResult = r; });
  session.on('usage', ({ entry }) => {
    tokensIn += entry?.usage?.inputTokens ?? 0;
    tokensOut += entry?.usage?.outputTokens ?? 0;
  });

  const startedAt = Date.now();
  let timeouted = false;
  try {
    await session.start();
    const url = resolveUrl(task.url);
    const goal = `${task.goal}\n\n页面 URL：${url}\n找到后在最终回复中原样引用该标记文本。`;
    await Promise.race([
      session.sendMessage(goal),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`任务超时（${TASK_TIMEOUT_MS / 60000} 分钟）`)), TASK_TIMEOUT_MS)),
    ]);
  } catch (err) {
    if (/超时/.test(err instanceof Error ? err.message : String(err))) timeouted = true;
    errMsgs.push(err instanceof Error ? err.message : String(err));
    await session.interrupt().catch(() => {});
  }
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  await session.close().catch(() => {});
  rmSync(wsDir, { recursive: true, force: true });

  if (timeouted) {
    return { id: task.id, status: 'FAIL', reason: 'timeout（超时中断）', steps, seconds, toolCalls, tokensIn, tokensOut, missing: [] };
  }
  if (turnResult && turnResult.subtype !== 'success') {
    const msg = turnResult.error?.message ?? errMsgs.join('；') ?? '未知错误';
    return { id: task.id, status: 'FAIL', reason: `turn_${turnResult.subtype}：${msg}`, steps, seconds, toolCalls, tokensIn, tokensOut, missing: [] };
  }
  const missing = (task.expect?.found ?? []).filter((mark) => !allText.includes(mark));
  if (missing.length > 0) {
    return { id: task.id, status: 'FAIL', reason: `断言未命中，缺标记：${missing.join('、')}`, steps, seconds, toolCalls, tokensIn, tokensOut, missing };
  }
  return { id: task.id, status: 'PASS', reason: '', steps, seconds, toolCalls, tokensIn, tokensOut, missing: [] };
}

const settings = await loadSettings();
const subAgentProfile = (settings.subAgent?.profiles ?? []).find((p) => p.id === BROWSER_PARSE_SUB_AGENT_PROFILE_ID);
if (!subAgentProfile) {
  console.error(`设置中不存在内置「浏览器解析」Profile（${BROWSER_PARSE_SUB_AGENT_PROFILE_ID}）`);
  process.exit(2);
}
if (subAgentProfile.enabled === false) {
  console.error('「浏览器解析」Profile 已被停用（enabled=false），无法执行 agent 任务');
  process.exit(2);
}
const modelSelection = pickModelSelection(settings);
const modelLabel = `${modelSelection.profileId}:${modelSelection.tier}`;

const allTasks = JSON.parse(readFileSync(path.join(here, 'tasks.json'), 'utf-8')).tasks;
const agentTasks = allTasks.filter((t) => t.type === 'agent' && (onlyIds.length === 0 || onlyIds.includes(t.id)));
if (agentTasks.length === 0) {
  console.error('没有匹配的 agent 任务');
  process.exit(2);
}

console.log(`===== 浏览器 agent 任务基线采集 =====`);
console.log(`模型：${modelLabel}（Profile「${subAgentProfile.name}」，browser=${subAgentProfile.enabledAbilities?.browser === true}）`);
console.log(`任务数：${agentTasks.length}\n`);

const results = [];
for (const task of agentTasks) {
  process.stdout.write(`▶ ${task.id} ... `);
  let result;
  try {
    result = await runAgentTask(task, modelSelection, subAgentProfile);
  } catch (err) {
    result = { id: task.id, status: 'FAIL', reason: `runner 异常：${err instanceof Error ? err.message : String(err)}`, steps: 0, seconds: '0.0', toolCalls: [], tokensIn: 0, tokensOut: 0, missing: [] };
  }
  results.push(result);
  const tokens = result.tokensIn + result.tokensOut > 0 ? `，tokens ${result.tokensIn}+${result.tokensOut}` : '';
  console.log(`${result.status}（${result.seconds}s，${result.steps} 步${tokens}）${result.reason ? `\n  └ ${result.reason}` : ''}`);
}

await getBrowserManager().dispose();
rmSync(profileDir, { recursive: true, force: true });

const passed = results.filter((r) => r.status === 'PASS').length;
const failed = results.length - passed;
console.log(`\n===== 合计：${results.length} 任务 | PASS ${passed} | FAIL ${failed} | 成功率 ${(passed / results.length * 100).toFixed(0)}% =====`);
process.exit(failed > 0 ? 1 : 0);
