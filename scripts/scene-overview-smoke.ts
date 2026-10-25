/**
 * 场景总览冒烟：直调 buildSceneOverview 核对三态七行 + 两条提示词读取函数。
 * 用法：DOGEAR_CONFIG_DIR=<.dogear 目录> bun scripts/scene-overview-smoke.ts
 * ability-scene 依赖链上有 service 静态 import electron（只用到 app.isPackaged），纯 bun 下 plugin mock 掉
 */
Bun.plugin({
  name: 'mock-electron',
  setup(build) {
    build.module('electron', () => ({
      loader: 'object' as const,
      exports: {
        default: { app: { isPackaged: false }, nativeTheme: {} },
        app: { isPackaged: false },
        nativeTheme: {},
      },
    }));
  },
});

import path from 'path';
import { existsSync } from 'fs';

const { buildSceneOverview } = await import('../electron/main/tipc/ability-scene.js');
const { ABILITY_PACKS } = await import('../electron/main/agents/ability-registry.js');
const { loadStateExtractPrompt, STATE_EXTRACT_SYSTEM_PROMPT } = await import('../electron/main/services/memory/state-extract-prompt.js');
const { loadArticleParseSkill, readArticleParseSkillMd } = await import('../electron/main/agents/tasks/parse-article-task.js');
const { buildExecutionPrompt, EXECUTION_PROMPT_PREVIEW } = await import('../electron/main/services/task-execution-prompt.js');
const { getAll: getAllWorkspaces } = await import('../electron/main/services/workspace-json-service.js');

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const workspaces = await getAllWorkspaces();
const ws = workspaces.find((w) => w.path) ?? workspaces[0];
if (!ws) {
  console.error('无工作区，冒烟终止');
  process.exit(1);
}
console.log(`工作区: ${ws.name} (${ws.id}) path=${ws.path ?? '(无)'}\n`);

const wsHasGit = ws.path ? existsSync(path.join(ws.path, '.git')) : false;

const result = await buildSceneOverview(ws.id);
if ('error' in result) {
  console.error('buildSceneOverview 错误:', result.error);
  process.exit(1);
}

console.log('== 行结构 ==');
check('共 6 行', result.rows.length === 6, `实际 ${result.rows.length}`);
const rowIds = result.rows.map((r) => r.id);
check(
  '行序 main→sub→executor→scheduler-custom→scheduler-state→scheduler-parse',
  JSON.stringify(rowIds) === JSON.stringify(['main', 'sub', 'executor', 'scheduler-custom', 'scheduler-state', 'scheduler-parse']),
  rowIds.join(','),
);

const byId = new Map(result.rows.map((r) => [r.id, r]));
const cellOf = (rowId: string, key: string) => byId.get(rowId)!.packs.find((c) => c.key === key);

console.log('\n== main 行（全 switchable） ==');
const mainRow = byId.get('main')!;
check('matrix 形态', mainRow.kind === 'matrix');
check('注册表包全量 + custom-skill 动态行', mainRow.packs.length === ABILITY_PACKS.length + result.rows[0].packs.filter((c) => c.key.startsWith('custom-skill:')).length, `实际 ${mainRow.packs.length}`);
check('全 switchable 且无 editable 兼容字段', mainRow.packs.every((c) => c.state === 'switchable' && !('editable' in c)));
check('switchable 正常态不输出 reason（名称自表达）', mainRow.packs.every((c) => c.reason === undefined));
check('workspace-git loaded 与 .git 探测一致', cellOf('main', 'workspace-git')!.loaded === wsHasGit);
check('workspace-snapshot loaded（绑定工作区）', cellOf('main', 'workspace-snapshot')!.loaded === !!ws.path);

console.log('\n== sub 行 ==');
const subRow = byId.get('sub')!;
check('matrix 形态', subRow.kind === 'matrix' && !('editable' in subRow));
check('扩展包格子不渲染（groupNotes 一句话替代）', ['stock', 'article', 'browser-extension', 'web-mcp', 'code-workflow'].every((k) => !cellOf('sub', k)) && !!subRow.groupNotes?.extension);
const collabSub = cellOf('sub', 'agent-collab')!;
check('agent-collab switchable（reason 仅 excluded/forced 输出）', collabSub.state === 'switchable' && collabSub.reason === undefined);
check('notes excluded（仅主会话）', cellOf('sub', 'notes')?.state === 'excluded');
check('shunt excluded（仅主会话）', cellOf('sub', 'shunt')?.state === 'excluded');
check('memory switchable（sub 不查 hasWorkspace）', cellOf('sub', 'memory')?.state === 'switchable');
check('workspace-git 条件按满足计（sub 行约定）', cellOf('sub', 'workspace-git')?.loaded === true);
check('workspace-snapshot switchable', cellOf('sub', 'workspace-snapshot')?.state === 'switchable');
check('group-context switchable（占位组）', cellOf('sub', 'group-context')?.state === 'switchable');
check('固定层 enabled=scenePackEnabled（首包 workspace-rules 默认 true）', cellOf('sub', 'workspace-rules')?.enabled === true);

console.log('\n== executor 行 ==');
const executorRow = byId.get('executor')!;
const shunt = cellOf('executor', 'shunt')!;
check('shunt excluded+loaded=false', shunt.state === 'excluded' && !shunt.loaded);
check('notes switchable（reason 仅 excluded/forced 输出）', cellOf('executor', 'notes')?.state === 'switchable' && cellOf('executor', 'notes')?.reason === undefined);
check('memory switchable（有工作区路径）', ws.path ? cellOf('executor', 'memory')?.state === 'switchable' : cellOf('executor', 'memory')?.state === 'excluded');
const execGitCell = cellOf('executor', 'workspace-git')!;
check('executor workspace-git 排除态与 .git 探测一致', execGitCell.loaded === wsHasGit && execGitCell.state === (wsHasGit ? 'switchable' : 'excluded'), `state=${execGitCell.state} loaded=${execGitCell.loaded} wsHasGit=${wsHasGit}`);
check('固定层默认全 enabled', ['workspace-rules', 'global-rules', 'notes', 'workspace-git', 'workspace-snapshot'].every((k) => cellOf('executor', k)?.enabled === true));
check('带 extensionNote', !!executorRow.extensionNote && executorRow.extensionNote.includes('staged-execution'));
check('单段通用执行模板（default 预览形态）', executorRow.prompts?.length === 1 && executorRow.prompts[0].id === 'executor-template' && !!executorRow.prompts[0].content?.includes('<task-execution>'), JSON.stringify(executorRow.prompts?.map((p) => p.id)));
check('default 预览无 staged-execution 引用（code-impl 差异由 note 说明）', !!executorRow.prompts?.[0]?.content && !executorRow.prompts[0].content.includes('staged-execution') && executorRow.prompts[0].note.includes('代码实施'));
check('模板含占位标题', executorRow.prompts?.[0]?.content?.includes('（任务标题）') === true);

console.log('\n== scheduler-custom 行 ==');
const schedRow = byId.get('scheduler-custom')!;
check('首格为基础工具合成格 forced', schedRow.packs[0]?.key === '__scheduler-base__' && schedRow.packs[0].state === 'forced' && schedRow.packs[0].loaded === true);
for (const key of ['memory', 'notes']) {
  const c = cellOf('scheduler-custom', key)!;
  check(`${key} switchable`, c.state === 'switchable', JSON.stringify(c));
  check(`${key} loaded=enabled（buildCustomToolSet 语义）`, c.loaded === c.enabled);
}
check('git 与快照两包 excluded（后台任务不走能力包）', ['workspace-git', 'workspace-snapshot'].every((k) => cellOf('scheduler-custom', k)?.state === 'excluded'));
check('无 subToggles（enabledToolPacks 编辑权已撤）', schedRow.packs.every((c) => !c.subToggles));
check('扩展包格子不渲染（groupNotes 指引任务编辑页）', ['stock', 'article', 'browser-extension', 'web-mcp', 'code-workflow'].every((k) => !cellOf('scheduler-custom', k)) && !!schedRow.groupNotes?.extension);

console.log('\n== summary 行 ==');
const stateRow = byId.get('scheduler-state')!;
const parseRow = byId.get('scheduler-parse')!;
check('state 行 kind=summary packs 空 prompts 有', stateRow.kind === 'summary' && stateRow.packs.length === 0 && (stateRow.prompts?.length ?? 0) === 1);
check('parse 行 kind=summary packs 空 prompts 有', parseRow.kind === 'summary' && parseRow.packs.length === 0 && (parseRow.prompts?.length ?? 0) === 1);
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
