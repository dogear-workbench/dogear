import { test, expect } from 'bun:test';
import { buildExecutionPrompt, EXECUTION_PROMPT_PREVIEW } from './task-execution-prompt.js';

const base = { ...EXECUTION_PROMPT_PREVIEW };

test('code-impl 分支：含 staged-execution 语境与分步实施语义', () => {
  const prompt = buildExecutionPrompt({ ...base, execProfile: 'code-impl' });
  expect(prompt).toContain('staged-execution');
  expect(prompt).toContain('stepN 分步结构');
  expect(prompt).toContain('dogear__ReportTaskResult');
});

test('缺省 execProfile 等价 code-impl（task-queue 现状兼容语义）', () => {
  expect(buildExecutionPrompt({ ...base })).toBe(buildExecutionPrompt({ ...base, execProfile: 'code-impl' }));
});

test('default 分支：不含 staged-execution / 分步引用，保留无人值守与申报纪律', () => {
  const prompt = buildExecutionPrompt({ ...base, execProfile: 'default' });
  expect(prompt).not.toContain('staged-execution');
  expect(prompt).not.toContain('stepN');
  expect(prompt).toContain('按计划文档直接实施');
  expect(prompt).toContain('无人值守');
  expect(prompt).toContain('dogear__ReportTaskResult');
  expect(prompt).toContain('dogear__TrackUserActions');
});

test('两类模板共用任务标题/ID/计划路径占位', () => {
  const input = { title: 'T', id: 'ID1', planPath: '/p/plan.md', execProfile: 'default' as const };
  const prompt = buildExecutionPrompt(input);
  expect(prompt).toContain('任务标题：T');
  expect(prompt).toContain('任务 ID：ID1');
  expect(prompt).toContain('计划文档：/p/plan.md');
});
