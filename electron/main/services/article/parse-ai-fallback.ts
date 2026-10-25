/**
 * 文章解析后台 AI 兜底与执行历史落盘
 *
 * 从管线（pipeline.ts）拆出的两个 fire-and-forget 副作用：
 * - PARSE_ARTICLE 任务提交（AgentManager Worker 池）与执行历史（run-history）记录
 * - 解析历史 JSONL（{configDir}/article-parser/history.jsonl）追加
 * electron 侧依赖（article-parser-skills / agent-manager / run-history）一律动态导入，保持 Worker 线程可安全加载
 */
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { TaskType, TaskStatus, type AgentTask, type ParseArticlePayload } from '../../agents/task-types.js';
import { reportDone, reportRunning } from '../background-activity-service.js';
import { withFileLock } from '../safe-json.js';
import type { RunHistoryEntry, RunHistoryStatus } from '../scheduler/types.js';
import type { ArticleParseLayer } from './types.js';

function parseTaskName(platform: string | null): string {
  return `文章解析 · ${platform || '通用'}`;
}

function resolveParseHistoryStatus(status: TaskStatus, result: any, error?: string): RunHistoryStatus {
  if (status === TaskStatus.CANCELLED) return 'cancelled';
  if (status === TaskStatus.FAILED) return 'failed';
  if (error || result?.error) return 'failed';
  if (result?.parseStatus === 'failed') return 'failed';
  return 'completed';
}

function buildParseSummary(url: string, trigger: string, result: any, durationMs: number): string {
  const historyError = result?.error ? String(result.error) : undefined;
  return [
    url,
    `解析状态 ${result?.parseStatus ?? '-'} · 文章已保存 ${result?.articleSaved ? '是' : '否'} · 耗时 ${durationMs}ms`,
    `触发 ${trigger}`,
    ...(historyError ? [historyError] : []),
  ].join('\n');
}

// 先写历史再 reportDone（UI 轮询视角 done 即历史可见）；写历史失败不影响解析本身
async function recordParseRun(task: AgentTask, taskName: string, status: TaskStatus, result: any, error?: string): Promise<void> {
  const historyStatus = resolveParseHistoryStatus(status, result, error);
  let historyError: string | undefined;
  if (status === TaskStatus.FAILED) {
    historyError = error ?? result?.error ?? `任务终态 ${status}`;
  } else if (result?.error) {
    historyError = String(result.error);
  } else if (result?.parseStatus === 'failed') {
    historyError = '解析失败';
  }
  const now = Date.now();
  const entry: RunHistoryEntry = {
    id: uuidv4(),
    ts: now,
    planId: task.id,
    planName: taskName,
    source: 'parse-article',
    articleId: task.payload?.articleId,
    workspaceId: task.payload?.workspaceId,
    traceFile: result?.traceFile,
    kind: 'task',
    status: historyStatus,
    triggerReason: 'condition',
    startedAt: task.createdAt,
    endedAt: now,
    summary: buildParseSummary(task.payload?.url ?? '', task.payload?.trigger ?? '-', result, now - (task.createdAt ?? now)),
    error: historyError,
  };
  try {
    const { appendHistoryEntry } = await import('../scheduler/run-history-store.js');
    await appendHistoryEntry(entry);
  } catch (err) {
    console.warn('[article] 写文章解析执行历史失败:', err);
  }
  try {
    reportDone(task.id);
  } catch (err) {
    console.warn('[article] 清理文章解析运行注册表失败:', err);
  }
}

/**
 * 将 AI 解析任务提交到 AgentManager Worker 池。
 * fire-and-forget：失败只打印警告，不 throw。
 */
export async function submitAiParseTask(params: {
  articleId: string;
  /** 文章 md 绝对路径（占位文件，raw.html 同名伴随） */
  articlePath: string;
  workspaceId: string;
  workspacePath: string;
  url: string;
  platform: string | null;
  trigger: 'script_failed' | 'parse_failed' | 'user_requested';
  scriptError?: { type: string; message: string };
  readabilityError?: string;
}): Promise<void> {
  const taskId = uuidv4();
  let runningStarted = false;
  let submitted = false;
  try {
    const { getArticleParserSkillsDir } = await import('../article-parser-skills-service.js');
    const skillsDir = getArticleParserSkillsDir();
    const payload: ParseArticlePayload = {
      articleId: params.articleId,
      articlePath: params.articlePath,
      workspaceId: params.workspaceId,
      workspacePath: params.workspacePath,
      url: params.url,
      skillsDir,
      platform: params.platform,
      trigger: params.trigger,
      scriptError: params.scriptError,
      readabilityError: params.readabilityError,
      fixedParseSuccess: false,
    };
    const task: AgentTask = {
      id: taskId,
      type: TaskType.PARSE_ARTICLE,
      status: TaskStatus.PENDING,
      payload,
      createdAt: Date.now(),
    };
    const taskName = parseTaskName(params.platform);
    reportRunning(task.id, { source: 'parse-article', name: taskName });
    runningStarted = true;
    const { getAgentManager } = await import('../../agents/agent-manager.js');
    const manager = getAgentManager();
    submitted = true;
    void manager
      .submitTask(task, (_taskId, status, result, error) => {
        if (
          status !== TaskStatus.COMPLETED &&
          status !== TaskStatus.FAILED &&
          status !== TaskStatus.CANCELLED
        ) {
          return;
        }
        void recordParseRun(task, taskName, status, result, error);
      })
      .catch((err) => {
        console.warn('[article] 提交 PARSE_ARTICLE 任务失败:', err);
        try {
          reportDone(task.id);
        } catch (e) {
          console.warn('[article] 清理文章解析运行注册表失败:', e);
        }
      });
  } catch (err) {
    console.warn('[article] 准备 PARSE_ARTICLE 任务失败:', err);
  }
  if (runningStarted && !submitted) {
    try {
      reportDone(taskId);
    } catch {
      // 注册表清理失败可忽略
    }
  }
}

/**
 * 解析历史唯一 schema（history.jsonl 每行一条；管线层与 PARSE_ARTICLE 任务层共用）。
 * 存量文件可能混有旧 schema 行（缺部分字段），读取方按可选字段容错。
 * layer 标记本次解析发生在哪一层：script / readability / ai / fetch_fail。
 */
export interface ParseHistoryEntry {
  timestamp: string;
  articleId: string;
  url: string;
  platform?: string | null;
  trigger?: string;
  triggeredAi?: boolean;
  layer?: ArticleParseLayer;
  scriptUpdated?: string | null;
  articleSaved?: boolean;
  parseStatus?: string;
  readabilityError?: string;
  fetchError?: string;
  durationMs?: number;
  error?: string;
}

/**
 * 向解析历史 JSONL 文件追加一条记录（不阻塞主流程）。
 * skillsDir 缺省时主进程自取运行时目录；PARSE_ARTICLE 任务（Worker 线程）显式传入 payload.skillsDir。
 */
export async function appendParseHistoryEntry(entry: ParseHistoryEntry, opts?: { skillsDir?: string }) {
  try {
    let skillsDir = opts?.skillsDir;
    if (!skillsDir) {
      const { getArticleParserSkillsDir } = await import('../article-parser-skills-service.js');
      skillsDir = getArticleParserSkillsDir();
    }
    const historyPath = path.join(skillsDir, 'history.jsonl');
    const line = JSON.stringify(entry) + '\n';
    await withFileLock(historyPath, async () => {
      await fs.appendFile(historyPath, line, 'utf-8');
    });
  } catch {
    // history write failure should never block main flow
  }
}
