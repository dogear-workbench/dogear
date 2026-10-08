import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { buildTurns, type Turn } from '../components/agent-chat/turns';
import { aggregateTasks } from '../components/agent-chat/task-aggregator';
import type { ContentBlock, Message } from '../components/agent-chat/types';

const SCENARIOS = [50, 100, 300] as const;
const ITERATIONS = 20;
const WARMUP_ITERATIONS = 3;
const ESTIMATE_HEIGHT = 400;
const VIEWPORT_HEIGHT = 800;
const BUFFER_TURNS = 1;
const JSONL_DIR = 'tmp/chat-render-benchmark';

type ModeMetrics = {
  renderedTurns: number;
  renderedMessages: number;
  visiblePlaceholders: number;
  derivedMs: number;
};

type ScenarioResult = {
  rounds: number;
  messages: number;
  turns: number;
  modeA: ModeMetrics;
  modeB: ModeMetrics;
  buildTurnsMs: number;
  aggregateTasksMs: number;
};

function makeBlock(type: ContentBlock['type'], timestamp: number, extra: Partial<ContentBlock> = {}): ContentBlock {
  return { type, timestamp, ...extra };
}

function makeMessages(rounds: number): Message[] {
  const messages: Message[] = [];
  for (let round = 0; round < rounds; round += 1) {
    const timestamp = round * 1000;
    const userId = `seed-user-${round}`;
    const assistantId = `seed-assistant-${round}`;
    messages.push({
      role: 'user',
      id: userId,
      content: `Question ${round}: inspect the deterministic benchmark fixture.`,
      timestamp,
      images: round % 10 === 0 ? [{ preview: `https://example.test/image-${round}.png` }] : undefined,
    });
    const blocks: ContentBlock[] = [
      makeBlock('text', timestamp + 1, {
        content: `## Result ${round}\n\n${'Long markdown paragraph with repeated content. '.repeat(12)}\n\n- item one\n- item two\n- item three`,
      }),
      makeBlock('thinking', timestamp + 2, {
        content: `${'Reasoning detail '.repeat(18)}for round ${round}.`,
      }),
      makeBlock('tool_use', timestamp + 3, {
        toolName: 'TaskCreate',
        toolUseId: `tool-create-${round}`,
        toolInput: { subject: `Task ${round}`, activeForm: `Working on task ${round}` },
        toolOutput: `Task #task-${round} created successfully: Task ${round}`,
      }),
      makeBlock('tool_use', timestamp + 4, {
        toolName: 'Read',
        toolUseId: `tool-read-${round}`,
        toolInput: { path: `src/example-${round}.ts` },
        toolOutput: `${'const value = 1;\n'.repeat(40)}`,
      }),
      makeBlock('tool_result', timestamp + 5, {
        toolUseId: `tool-read-${round}`,
        toolOutput: 'ok',
      }),
    ];
    messages.push({
      role: 'assistant',
      id: assistantId,
      sdkUuid: assistantId,
      entryIds: [assistantId],
      content: `Result ${round}`,
      timestamp: timestamp + 6,
      model: 'benchmark-model',
      contentBlocks: blocks,
    });
  }
  return messages;
}

function getVisibleTurns(turns: Turn[], scrollTop: number): Set<string> {
  const visible = new Set<string>();
  const viewTop = scrollTop - VIEWPORT_HEIGHT * BUFFER_TURNS;
  const viewBottom = scrollTop + VIEWPORT_HEIGHT + VIEWPORT_HEIGHT * BUFFER_TURNS;
  let cumulativeHeight = 0;
  for (const turn of turns) {
    const turnTop = cumulativeHeight;
    const turnBottom = turnTop + ESTIMATE_HEIGHT;
    cumulativeHeight = turnBottom;
    if (turnBottom < viewTop) continue;
    if (turnTop > viewBottom) break;
    visible.add(turn.turnId);
  }
  return visible;
}

function measure(iterations: number, operation: () => void): number {
  for (let i = 0; i < WARMUP_ITERATIONS; i += 1) operation();
  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) operation();
  return (performance.now() - start) / iterations;
}

function runScenario(rounds: number): ScenarioResult {
  const messages = makeMessages(rounds);
  const structure = buildTurns(messages, { collapsed: false });
  const visibleTurnIds = getVisibleTurns(structure.turns, Math.floor((rounds * ESTIMATE_HEIGHT) / 2));
  const visibleTurns = structure.turns.filter((turn) => visibleTurnIds.has(turn.turnId));
  const visibleMessages = visibleTurns.reduce((total, turn) => total + turn.memberIds.length, 0);
  const fullMessages = structure.turns.reduce((total, turn) => total + turn.memberIds.length, 0);
  const modeA: ModeMetrics = {
    renderedTurns: visibleTurns.length,
    renderedMessages: visibleMessages,
    visiblePlaceholders: structure.turns.length - visibleTurns.length,
    derivedMs: measure(ITERATIONS, () => {
      consume(getVisibleTurns(structure.turns, Math.floor((rounds * ESTIMATE_HEIGHT) / 2)).size);
    }),
  };
  const modeB: ModeMetrics = {
    renderedTurns: structure.turns.length,
    renderedMessages: fullMessages,
    visiblePlaceholders: 0,
    derivedMs: measure(ITERATIONS, () => {
      consume(structure.turns.reduce((total, turn) => total + turn.memberIds.length, 0));
    }),
  };
  return {
    rounds,
    messages: messages.length,
    turns: structure.turns.length,
    modeA,
    modeB,
    buildTurnsMs: measure(ITERATIONS, () => {
      buildTurns(messages, { collapsed: false });
    }),
    aggregateTasksMs: measure(ITERATIONS, () => {
      aggregateTasks(messages);
    }),
  };
}

function formatMs(value: number): string {
  return value.toFixed(3);
}

function consume(value: number): void {
  if (value < 0) throw new Error('benchmark invariant failed');
}

async function writeSeeds() {
  await mkdir(JSONL_DIR, { recursive: true });
  await Promise.all(SCENARIOS.map(async (rounds) => {
    const messages = makeMessages(rounds);
    const lines = messages.map((message) => JSON.stringify(message)).join('\n') + '\n';
    await writeFile(`${JSONL_DIR}/${rounds}-turns.jsonl`, lines, 'utf8');
  }));
}

function printResult(result: ScenarioResult) {
  console.log(`\n${result.rounds} 轮: messages=${result.messages}, turns=${result.turns}`);
  console.log(`A 手写虚拟化: renderedTurns=${result.modeA.renderedTurns}, renderedMessages=${result.modeA.renderedMessages}, placeholders=${result.modeA.visiblePlaceholders}, visible-window=${formatMs(result.modeA.derivedMs)}ms`);
  console.log(`B 完整 DOM: renderedTurns=${result.modeB.renderedTurns}, renderedMessages=${result.modeB.renderedMessages}, placeholders=${result.modeB.visiblePlaceholders}, full-list=${formatMs(result.modeB.derivedMs)}ms`);
  console.log(`共享派生: buildTurns=${formatMs(result.buildTurnsMs)}ms, aggregateTasks=${formatMs(result.aggregateTasksMs)}ms`);
}

await writeSeeds();
console.log(`seed JSONL: ${JSONL_DIR}/{50,100,300}-turns.jsonl`);
for (const rounds of SCENARIOS) printResult(runScenario(rounds));
console.log('指标范围：纯函数/数据量基准；未包含 React commit、DOM layout/paint、滚动 FPS 或 Electron GUI。');
