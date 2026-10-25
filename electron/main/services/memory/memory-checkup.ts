/**
 * 记忆库体检：纯代码检测全链条 + 每周体检定时任务补建
 *
 * 立场：检测全自动，裁决不自动——无歧义项（孤儿索引/垃圾文件）直接修，
 * 重复对/死重/过时候选只出「建议 + 理由」，等用户拍板（报告经 agent 写成笔记卡片）。
 */
import type { MemoryScope } from './memory-types.js';
import { readIndex } from './memory-indexer.js';
import {
  listAllMemoryTargets,
  repairMemoryTargets,
  type MemoryRepairOutcome,
} from './memory-maintenance.js';
import { topicSimilarity, TOPIC_SIMILARITY_THRESHOLD } from './memory-similarity.js';
import { readMemoryUsage, usageKey } from './memory-usage.js';
import { loadTasks, saveTasks } from '../scheduler/plan-store.js';
import { getDefault as getDefaultWorkspace } from '../workspace-json-service.js';
import type { CustomScheduledTask } from '../scheduler/types.js';

const DEAD_WEIGHT_AGE_DAYS = 60;
const STALE_AGE_DAYS = 90;

export interface CheckupTopicRef {
  scope: MemoryScope;
  workspaceId: string;
  slug: string;
  title: string;
  keywords: string[];
  updated: string;
  ageDays: number;
  usageCount: number;
  lastUsed?: string;
}

export interface MemoryCheckupReport {
  generatedAt: string;
  targets: Array<{ scope: MemoryScope; workspaceId: string; topicCount: number }>;
  autoFixed: MemoryRepairOutcome[];
  duplicatePairs: Array<{ similarity: number; older: CheckupTopicRef; newer: CheckupTopicRef }>;
  deadWeight: CheckupTopicRef[];
  staleCandidates: Array<{ ref: CheckupTopicRef; supersededBy: CheckupTopicRef }>;
  statsCollectedSince?: string;
}

function ageDays(iso: string): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.floor((Date.now() - t) / 86_400_000);
}

export async function runMemoryCheckup(opts: { workspaceIds?: string[] } = {}): Promise<MemoryCheckupReport> {
  const filter = opts.workspaceIds ? new Set(opts.workspaceIds) : null;
  let targets = await listAllMemoryTargets();
  if (filter) targets = targets.filter((t) => t.scope === 'global' || filter.has(t.workspaceId));

  const autoFixed = (
    await repairMemoryTargets(targets).catch((err) => {
      console.warn('[memory-checkup] 无歧义修复失败:', err);
      return { outcomes: [] as MemoryRepairOutcome[] };
    })
  ).outcomes;

  const usage = await readMemoryUsage();
  const refs: CheckupTopicRef[] = [];
  const targetMeta: MemoryCheckupReport['targets'] = [];
  for (const target of targets) {
    const index = await readIndex(target.workspaceId, target.scope);
    targetMeta.push({ scope: target.scope, workspaceId: target.workspaceId, topicCount: index.topics.length });
    for (const entry of index.topics) {
      const stat = usage?.entries[usageKey(target.scope, target.workspaceId, entry.slug)];
      refs.push({
        scope: target.scope,
        workspaceId: target.workspaceId,
        slug: entry.slug,
        title: entry.title,
        keywords: entry.keywords,
        updated: entry.updated,
        ageDays: ageDays(entry.updated),
        usageCount: stat?.count ?? 0,
        lastUsed: stat?.lastUsed,
      });
    }
  }

  const duplicatePairs: MemoryCheckupReport['duplicatePairs'] = [];
  for (let i = 0; i < refs.length; i++) {
    for (let j = i + 1; j < refs.length; j++) {
      const a = refs[i];
      const b = refs[j];
      const similarity = topicSimilarity(a, b);
      if (similarity < TOPIC_SIMILARITY_THRESHOLD) continue;
      const [older, newer] = a.updated <= b.updated ? [a, b] : [b, a];
      duplicatePairs.push({ similarity: Math.round(similarity * 100) / 100, older, newer });
    }
  }

  // 死重判定的统计前提：usage 文件存在（统计体系已开始收集）才评「从未召回」
  const deadWeight = usage ? refs.filter((r) => r.usageCount === 0 && r.ageDays > DEAD_WEIGHT_AGE_DAYS) : [];
  const staleCandidates = duplicatePairs
    .filter((p) => p.older.ageDays > STALE_AGE_DAYS)
    .map((p) => ({ ref: p.older, supersededBy: p.newer }));

  return {
    generatedAt: new Date().toISOString(),
    targets: targetMeta,
    autoFixed,
    duplicatePairs,
    deadWeight,
    staleCandidates,
    statsCollectedSince: usage?.since,
  };
}

// ── 每周体检定时任务补建（幂等：已存在即跳过；用户显式删除后按 id 不复活）──

export const MEMORY_CHECKUP_TASK_ID = 'builtin-memory-checkup-weekly';

const MEMORY_CHECKUP_PROMPT = [
  '你是 Dogear 记忆库体检 agent，执行每周记忆体检。全程只做检测与报告：除体检工具自带的无歧义修复外，不写入、不删除、不合并任何记忆。',
  '',
  '1. 调用 dogear__MemoryCheckup 工具（不传参数）。工具会自动修复无歧义问题（孤儿索引重建、.bak/.conflict 垃圾清理），并返回检测报告（重复对 / 死重 / 过时候选 / 使用统计）。',
  '2. 阅读报告中的待裁决项，逐条形成建议与一句话理由：重复对 → 建议合并保留较新（删旧前先确认新主题内容已覆盖旧主题要点）；死重（60 天未召回）→ 建议删除；过时候选（90 天以上且被同主题新记忆覆盖）→ 标记存疑。拿不准的一律建议保留——记忆是资产，误删成本大于保留成本。注意：使用统计自 statsCollectedSince 起收集，早于该日期的主题「从未使用」只覆盖统计期，判断死重时须说明此保留意见。',
  '3. 用 dogear__CreateNote 写体检报告卡片：标题「记忆库体检 YYYY-MM-DD」（用今天日期），正文分「已自动修复」「建议处理（逐条：主题、位置、建议、理由）」「无需处理」三段，标签 ["待议"]。用户看到卡片后自行拍板，不要替用户执行删除或合并。',
  '4. 最后输出 100 字以内总结。若工具调用失败，直接说明失败原因并结束，不做其他动作。',
].join('\n');

export async function ensureMemoryCheckupTask(): Promise<void> {
  const tasks = await loadTasks();
  if (tasks.some((t) => t.id === MEMORY_CHECKUP_TASK_ID)) return;
  const workspace = await getDefaultWorkspace().catch(() => null);
  if (!workspace) return;
  const now = Date.now();
  const task: CustomScheduledTask = {
    id: MEMORY_CHECKUP_TASK_ID,
    name: '记忆库每周体检',
    kind: 'custom',
    enabled: true,
    triggers: [{ id: 'weekly-monday-0900', type: 'daily_at', at: '09:00', weekdays: [1] }],
    workspaceId: workspace.id,
    prompt: MEMORY_CHECKUP_PROMPT,
    createdAt: now,
    updatedAt: now,
  };
  await saveTasks([...tasks, task]);
  console.log('[memory-checkup] 已补建每周体检定时任务');
}
