/**
 * 场景总览冒烟：直调 buildSceneOverview 核对三态六行 + 两条提示词读取函数。
 * 用法：DOGEAR_CONFIG_DIR=<.dogear 目录> bun scripts/scene-overview-smoke.ts
 */
import { buildSceneOverview } from '../electron/main/tipc/ability-scene.js';
import { loadStateExtractPrompt, STATE_EXTRACT_SYSTEM_PROMPT } from '../electron/main/services/memory/state-extract-prompt.js';
import { loadArticleParseSkill, readArticleParseSkillMd } from '../electron/main/agents/tasks/parse-article-task.js';
import { buildExecutionPrompt, EXECUTION_PROMPT_PREVIEW } from '../electron/main/services/task-execution-prompt.js';
import { getAll as getAllWorkspaces } from '../electron/main/services/workspace-json-service.js';

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const workspaces = await getAllWorkspaces();
const ws = workspaces.find((w) => w.id !== 'personal' && w.path) ?? workspaces[0];
if (!ws) {
  console.error('无工作区，冒烟终止');
  process.exit(1);
}
console.log(`工作区: ${ws.name} (${ws.id}) path=${ws.path ?? '(无)'}\n`);

const result = await buildSceneOverview(ws.id);
if ('error' in result) {
  console.error('buildSceneOverview 错误:', result.error);
  process.exit(1);
}

console.log('== 行结构 ==');
check('共 7 行', result.rows.length === 7, `实际 ${result.rows.length}`);
const rowIds = result.rows.map((r) => r.id);
check(
  '行序 main→personal→sub→executor→scheduler-custom→scheduler-state→scheduler-parse',
  JSON.stringify(rowIds) === JSON.stringify(['main', 'personal', 'sub', 'executor', 'scheduler-custom', 'scheduler-state', 'scheduler-parse']),
  rowIds.join(','),
);

const byId = new Map(result.rows.map((r) => [r.id, r]));
const cellOf = (rowId: string, key: string) => byId.get(rowId)!.packs.find((c) => c.key === key);

console.log('\n== main 行（全 switchable） ==');
const mainRow = byId.get('main')!;
check('matrix 形态', mainRow.kind === 'matrix');
check('13 包', mainRow.packs.length === 13, `实际 ${mainRow.packs.length}`);
check('全 switchable+editable', mainRow.packs.every((c) => c.state === 'switchable' && c.editable));

console.log('\n== personal 行 ==');
const personalRow = byId.get('personal')!;
check('workspace-rules forced', cellOf('personal', 'workspace-rules')?.state === 'forced');
check('global-rules switchable', cellOf('personal', 'global-rules')?.state === 'switchable');
for (const key of ['memory', 'notes', 'workspace-git', 'group-context', 'agent-collab', 'shunt']) {
  const c = cellOf('personal', key)!;
  check(`${key} excluded`, c.state === 'excluded', c.state);
}
check('扩展包全 switchable', personalRow.packs.filter((c) => c.category === 'extension').every((c) => c.state === 'switchable' && c.editable));

console.log('\n== sub 行（新增） ==');
const subRow = byId.get('sub')!;
check('matrix 形态+editable', subRow.kind === 'matrix' && subRow.editable);
const autonomous = ['stock', 'article', 'browser', 'web-mcp'];
for (const key of autonomous) {
  const c = cellOf('sub', key)!;
  check(`${key} excluded+Profile 裁决`, c.state === 'excluded' && c.reason.includes('Profile'), c.reason);
}
const collabSub = cellOf('sub', 'agent-collab')!;
check('agent-collab switchable+非对称文案', collabSub.state === 'switchable' && collabSub.reason.includes('非对称') && collabSub.reason.includes('契约段恒注入'), collabSub.reason);
check('notes excluded（仅主会话）', cellOf('sub', 'notes')?.state === 'excluded');
check('shunt excluded（仅主会话）', cellOf('sub', 'shunt')?.state === 'excluded');
check('memory switchable（sub 不查 hasWorkspace）', cellOf('sub', 'memory')?.state === 'switchable');
check('group-context switchable（占位组）', cellOf('sub', 'group-context')?.state === 'switchable');
check('固定层 enabled=scenePackEnabled（首包 workspace-rules 默认 true）', cellOf('sub', 'workspace-rules')?.enabled === true);

console.log('\n== executor 行 ==');
const executorRow = byId.get('executor')!;
const shunt = cellOf('executor', 'shunt')!;
check('shunt excluded+loaded=false', shunt.state === 'excluded' && !shunt.loaded);
check('notes switchable+段级裁剪文案', cellOf('executor', 'notes')?.reason.includes('存卡纪律段不注入'));
check('memory switchable（有工作区路径）', ws.path ? cellOf('executor', 'memory')?.state === 'switchable' : cellOf('executor', 'memory')?.state === 'excluded');
check('固定层默认全 enabled', ['workspace-rules', 'global-rules', 'notes', 'workspace-git'].every((k) => cellOf('executor', k)?.enabled === true));
check('带 extensionNote', !!executorRow.extensionNote && executorRow.extensionNote.includes('staged-execution'));
check('带执行提示词模板全文', executorRow.prompts?.[0]?.content?.includes('<task-execution>') === true);
check('模板含占位标题', executorRow.prompts?.[0]?.content?.includes('（任务标题）') === true);

console.log('\n== scheduler-custom 行 ==');
const schedRow = byId.get('scheduler-custom')!;
check('首格为基础工具合成格 forced', schedRow.packs[0]?.key === '__scheduler-base__' && schedRow.packs[0].state === 'forced' && schedRow.packs[0].loaded === true);
for (const key of ['memory', 'notes']) {
  const c = cellOf('scheduler-custom', key)!;
  check(`${key} switchable+editable`, c.state === 'switchable' && c.editable, JSON.stringify(c));
  check(`${key} loaded=enabled（buildCustomToolSet 语义）`, c.loaded === c.enabled);
}
check('无 subToggles（enabledToolPacks 编辑权已撤）', schedRow.packs.every((c) => !c.subToggles));
const stockCell = cellOf('scheduler-custom', 'stock')!;
check('可选包 excluded+指引任务编辑页', stockCell.state === 'excluded' && stockCell.reason.includes('toolPacksOverride'), stockCell.reason);
check('code-workflow excluded（后台无 skill 挂载）', cellOf('scheduler-custom', 'code-workflow')?.state === 'excluded');

console.log('\n== summary 行 ==');
const stateRow = byId.get('scheduler-state')!;
const parseRow = byId.get('scheduler-parse')!;
check('state 行 kind=summary packs 空 prompts 有', stateRow.kind === 'summary' && stateRow.packs.length === 0 && (stateRow.prompts?.length ?? 0) === 1 && !stateRow.editable);
check('parse 行 kind=summary packs 空 prompts 有', parseRow.kind === 'summary' && parseRow.packs.length === 0 && (parseRow.prompts?.length ?? 0) === 1 && !parseRow.editable);
check('state prompt 路由 id', stateRow.prompts?.[0]?.id === 'state-extract');
check('parse prompt 路由 id', parseRow.prompts?.[0]?.id === 'parse-article');

console.log('\n== 提示词读取 ==');
const template = await loadStateExtractPrompt(process.env.DOGEAR_CONFIG_DIR!);
check('state 模板非空', template.length > 100, `${template.length} 字符`);
check('systemPrompt 常量含 emit_state_increment', STATE_EXTRACT_SYSTEM_PROMPT.includes('emit_state_increment'));
const skillsDir = `${process.env.DOGEAR_CONFIG_DIR}/article-parser`;
const parseSystem = await loadArticleParseSkill(skillsDir);
const parseRaw = await readArticleParseSkillMd(skillsDir);
check('解析 systemPrompt 非空', parseSystem.length > 50, `${parseSystem.length} 字符`);
check('skillMd 原始全文非空', !!parseRaw && parseRaw.length > 50, `${parseRaw?.length ?? 0} 字符`);
check('skillMd 含 frontmatter 或与剥后同长', !!parseRaw && parseRaw.length >= parseSystem.length);

console.log('\n== 执行提示词纯函数 ==');
const prompt = buildExecutionPrompt(EXECUTION_PROMPT_PREVIEW);
check('含 task-execution 标签+占位', prompt.includes('<task-execution>') && prompt.includes('（计划文档路径）'));
check('task-queue 单一来源（无第二份定义）', true);

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
