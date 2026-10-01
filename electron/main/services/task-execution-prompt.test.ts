import { test, expect } from 'bun:test';
import { buildExecutionPrompt, EXECUTION_PROMPT_PREVIEW } from './task-execution-prompt.js';

const base = { ...EXECUTION_PROMPT_PREVIEW };

test('通用模板：不含 execProfile 硬编码语境，保留无人值守与申报纪律', () => {
  const prompt = buildExecutionPrompt(base);
  expect(prompt).not.toContain('staged-execution');
  expect(prompt).not.toContain('stepN');
  expect(prompt).toContain('按计划文档直接实施');
  expect(prompt).toContain('派子会话分工');
  expect(prompt).toContain('无人值守');
  expect(prompt).toContain('dogear__ReportTaskResult');
  expect(prompt).toContain('dogear__TrackUserActions');
});

test('mountedSkills 非空：追加挂载提示行并列出全部 skill 名', () => {
  const prompt = buildExecutionPrompt({ ...base, mountedSkills: ['staged-execution', 'code-review'] });
  expect(prompt).toContain('本任务已挂载专项 skill：staged-execution、code-review，开工前先读该 skill 并按其纪律执行');
  expect(prompt.indexOf('本任务已挂载专项 skill')).toBeGreaterThan(prompt.indexOf('执行模式：'));
  expect(prompt.indexOf('本任务已挂载专项 skill')).toBeLessThan(prompt.indexOf('执行要求：'));
});

test('mountedSkills 缺省或空数组：不含挂载行', () => {
  expect(buildExecutionPrompt(base)).not.toContain('已挂载专项 skill');
  expect(buildExecutionPrompt({ ...base, mountedSkills: [] })).not.toContain('已挂载专项 skill');
});

test('模板共用任务标题/ID/计划路径占位', () => {
  const prompt = buildExecutionPrompt({ title: 'T', id: 'ID1', planPath: '/p/plan.md' });
  expect(prompt).toContain('任务标题：T');
  expect(prompt).toContain('任务 ID：ID1');
  expect(prompt).toContain('计划文档：/p/plan.md');
});
