import { expect, test } from 'bun:test';
import {
  MAIN_AGENT_DELEGATION_APPEND,
  buildSubAgentProfileIndex,
  subAgentContractFor,
} from './session-append-templates.js';
import { createDefaultSubAgentProfile } from '../services/settings-types.js';

test('subAgentContractFor 有 outputPath：契约含交付路径行与形态二选一', () => {
  const contract = subAgentContractFor({ task: '调研某主题', outputPath: 'notes/2026-08/report.md' });
  expect(contract).toContain('**任务**：调研某主题');
  expect(contract).toContain('**交付路径**：notes/2026-08/report.md');
  expect(contract).toContain('复杂产出（报告/代码改动说明）用 dogear__SaveSharedNote');
  expect(contract).toContain('简单问答/验证类可直接在交付消息正文交付');
  expect(contract).toContain('交付消息须结构化自述');
  expect(contract).toContain('目标达成情况 / 未完成或跳过部分 / caveats / 交付物形态与位置');
});

test('subAgentContractFor 空 outputPath：不出现交付路径行，改为通讯型交付', () => {
  const contract = subAgentContractFor({ task: '验证一个结论', outputPath: '' });
  expect(contract).toContain('**任务**：验证一个结论');
  expect(contract).not.toContain('**交付路径**');
  expect(contract).toContain('**交付形态**：未指定交付文件，交付内容直接写在交付消息正文');
  expect(contract).toContain('交付消息须结构化自述');
});

test('MAIN_AGENT_DELEGATION_APPEND 含复用判断四条与验收闭环三分支', () => {
  const text = MAIN_AGENT_DELEGATION_APPEND;
  expect(text).toContain('### 子会话复用判断');
  expect(text).toContain('追问深挖（调研结果展开、验证结论）→ 优先原子会话，它的上下文还在');
  expect(text).toContain('失败/超时 → 先向原子会话发消息查询情况，它对自己的进度最清楚；盲目重派会丢掉已积累的上下文');
  expect(text).toContain('新任务与原子会话上下文无关（如一次性实施已完成）→ 新派');
  expect(text).toContain('追问链已很长、上下文价值稀释（auto-compact 有损压缩累积损耗）→ 换新会话从共享区产出起步');
  expect(text).toContain('### 验收闭环');
  expect(text).toContain('收到交付 ≠ 接受交付');
  expect(text).toContain('有缺口 → 用 dogear__SendMessage 向原子会话追问返工');
  expect(text).toContain('方向全错 → 重派新会话');
  expect(text).toContain('交付以收到子会话的 delivery 消息为准（送达事实）；是否合格由你验收判断');
  expect(text).not.toContain('不要重派或调起');
});

test('渲染目检：主会话规范 + Profile 索引 + 两种契约的完整渲染结果', () => {
  const fileContract = subAgentContractFor({ task: '<任务描述>', outputPath: '<交付路径>' });
  const commContract = subAgentContractFor({ task: '<任务描述>', outputPath: '' });
  const render = [
    MAIN_AGENT_DELEGATION_APPEND,
    '\n',
    buildSubAgentProfileIndex([createDefaultSubAgentProfile()]),
    '\n===== 契约（有 outputPath）=====',
    fileContract,
    '\n===== 契约（通讯型）=====',
    commContract,
  ].join('\n');
  console.log(render);
  expect(render).not.toContain('（未指定；直接通过 dogear__SendMessage 交付）');
});
