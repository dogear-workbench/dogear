/**
 * 任务系统 agent 工具（dogear-tasks 工具组，仅挂主会话）
 *
 * 任务产生唯一入口：会话侧 dogear__CreateTask 挂载落计划栏（planPath 必传，任务=完全体）；UI 不做「转任务」按钮。
 * originSessionId 由挂载点闭包注入（与 notes source 同款决策），不让 LLM 抄会话 ID。
 * autoExecute 走「先 createTask 落 plan 再 executeTask」两步：同标题 plan 态任务已存在时 createTask 直接拒绝，不会撞车。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import * as taskService from '../../services/task-service.js';
import type { Task, TaskStatus } from '../../services/task-service.js';
import type { ExecProfile } from '../../services/task-execution-prompt.js';
import { getTaskQueue } from '../../services/task-queue.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';

/** 挂载上下文：CreateTask 自动写入任务来源会话，agent 无需也不应传会话标识 */
export interface TaskToolSourceContext {
  workspaceId: string;
  conversationId: string;
}

function errorResult(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true as const };
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

const EXEC_PROFILE_LABEL: Record<ExecProfile, string> = {
  default: '默认',
  'code-impl': '代码实施',
};

const LIST_STATUS_ORDER: TaskStatus[] = ['plan', 'backlog', 'queued', 'running', 'review', 'rejected', 'interrupted', 'done'];
const LIST_DONE_LIMIT = 20;

function taskLine(task: Task): string {
  const parts = [`${task.id} [${task.status}] 《${task.title}》`];
  parts.push(`类型: ${EXEC_PROFILE_LABEL[task.execProfile ?? 'default']}`);
  parts.push(`plan: ${task.planPath ?? '（缺失）'}`);
  if (task.result) parts.push(`结果: ${task.result.slice(0, 100)}`);
  return `- ${parts.join(' | ')}`;
}

/**
 * 创建任务工具中立定义（ToolDef[]）
 * @param workspaceId - 存储定位（configDir/workspaces/{wsid}/tasks.json）
 * @param workspacePath - 工作区磁盘根（planPath 相对解析）
 */
export function createTaskToolDefs(workspaceId: string, workspacePath: string, sourceContext?: TaskToolSourceContext): ToolDef[] {
  return [
    defineTool(
      'dogear__CreateTask',
      '挂载实施任务',
      '将实施任务挂到计划栏。默认落计划（plan），由用户决定何时推进执行；与用户聊透方案后挂载。\n' +
        '任务须是完全体：planPath 必传且文件须已落盘；方案未定型先记笔记卡片，落盘 plan 文档后再挂载。\n' +
        '同标题计划（plan 态）任务已存在时拒绝创建，标题勿重复。\n' +
        'execProfile 必填二选一：要动代码或仓库内产品文件填 code-impl（执行会话挂 code-discipline 工程纪律，分步 plan 再叠加 staged-execution 编排）；调研/整理类填 default。\n' +
        'autoExecute=true 仅当用户明确要求立即执行：直接转入执行队列（串行执行，完成后待审核并系统通知）。\n' +
        '存入计划栏时告知用户（标题与任务 ID）。',
      z.object({
        title: z.string().min(1).describe('任务标题，简短概括要实施的内容'),
        planPath: z.string().min(1).describe('plan 文档路径（绝对路径，或相对工作区根的相对路径），必传；文件须已落盘'),
        execProfile: z
          .enum(['default', 'code-impl'])
          .describe(
            "必填二选一：要动代码或仓库内产品文件填 'code-impl'（执行会话挂 code-discipline 工程纪律，分步 plan 再叠加 staged-execution 编排）；调研/整理类填 'default'",
          ),
        autoExecute: z.boolean().optional().describe('仅当用户明确要求立即执行时传 true：直接转入执行队列；默认 false 落计划栏'),
      }),
      async (args) => {
        const planPath = path.resolve(workspacePath, args.planPath);
        try {
          await fs.access(planPath);
        } catch {
          return errorResult(`plan 文件不存在: ${planPath}，请先落盘 plan 文档再挂载（方案未定型先记笔记）。`);
        }
        try {
          const created = await taskService.createTask(workspaceId, workspacePath, {
            title: args.title,
            planPath,
            execProfile: args.execProfile,
            originSessionId: sourceContext?.conversationId,
            status: 'plan',
          });
          const profileLine = `\n- 类型: ${EXEC_PROFILE_LABEL[created.execProfile ?? 'default']}`;
          if (args.autoExecute === true) {
            const task = await taskService.executeTask(workspaceId, workspacePath, created.id);
            getTaskQueue().kick();
            return textResult(
              `✅ 任务已排队\n- 任务 ID: ${task.id}\n- 标题: ${task.title}${profileLine}\n- plan: ${task.planPath}\n` +
                '队列串行执行：轮到后会自动创建执行会话按 plan 实施，完成进入待审核并系统通知。',
            );
          }
          return textResult(
            `✅ 任务已存入计划栏\n- 任务 ID: ${created.id}\n- 标题: ${created.title}${profileLine}\n- plan: ${created.planPath}\n` +
              '计划任务不会自动执行；用户确认后可用 dogear__ExecuteTask 转入队列。',
          );
        } catch (error) {
          return errorResult(`挂载任务失败: ${error}`);
        }
      },
    ),

    defineTool(
      'dogear__UpdateTask',
      '修正任务信息',
      '修改一个计划（plan）或待办（backlog）任务的标题、plan 文档路径或类型（execProfile）；queued 之后执行会话已按原配置创建，不再可改。\n' +
        '使用场景：修正挂载错误——标题写偏、plan 路径漂移、execProfile 填错。\n' +
        'execProfile 判断标准：要动代码或仓库内产品文件填 code-impl，调研/整理类填 default。\n' +
        'title 改名与 plan 态同标题任务冲突时拒绝；planPath 传相对路径则相对工作区根解析，文件须已落盘。',
      z.object({
        taskId: z.string().min(1).describe('任务 ID（dogear__ListTasks 查看）'),
        title: z.string().min(1).optional().describe('新标题'),
        planPath: z.string().min(1).optional().describe('新 plan 文档路径（绝对路径，或相对工作区根的相对路径），文件须已落盘'),
        execProfile: z
          .enum(['default', 'code-impl'])
          .optional()
          .describe("要动代码或仓库内产品文件填 'code-impl'；调研/整理类填 'default'"),
      }).refine(
        (v) => v.title !== undefined || v.planPath !== undefined || v.execProfile !== undefined,
        { message: 'title / planPath / execProfile 至少提供一项' },
      ),
      async (args) => {
        try {
          const existing = await taskService.getTask(workspaceId, args.taskId);
          if (!existing) return errorResult(`任务 ${args.taskId} 不存在，可用 dogear__ListTasks 查看。`);
          if (args.planPath !== undefined) {
            const planPath = path.resolve(workspacePath, args.planPath);
            try {
              await fs.access(planPath);
            } catch {
              return errorResult(`plan 文件不存在: ${planPath}，请先落盘 plan 文档再更新。`);
            }
          }
          const task = await taskService.updateTask(workspaceId, workspacePath, args.taskId, {
            ...(args.title !== undefined && { title: args.title }),
            ...(args.planPath !== undefined && { planPath: args.planPath }),
            ...(args.execProfile !== undefined && { execProfile: args.execProfile }),
          });
          return textResult(`✅ 任务已更新\n${taskLine(task)}`);
        } catch (error) {
          return errorResult(`更新任务失败: ${error}`);
        }
      },
    ),

    defineTool(
      'dogear__DeleteTask',
      '删除任务',
      '删除任务（软删除，移入回收站，可在 UI 任务面板恢复）；任何状态均可删除。\n' +
        '使用场景：用户明确要求放弃/移除任务时调用。\n' +
        '注意：任务处于 running 时删除，其执行会话的结果申报将无法回写。',
      z.object({
        taskId: z.string().min(1).describe('任务 ID（dogear__ListTasks 查看）'),
      }),
      async (args) => {
        try {
          const existing = await taskService.getTask(workspaceId, args.taskId);
          if (!existing) return errorResult(`任务 ${args.taskId} 不存在，可用 dogear__ListTasks 查看。`);
          const task = await taskService.deleteTask(workspaceId, workspacePath, args.taskId);
          const runningHint =
            task.status === 'running' ? '\n⚠️ 该任务删除时处于执行中，执行会话的结果申报将无法回写。' : '';
          return textResult(`✅ 任务已删除（移入回收站，可在 UI 任务面板恢复）\n${taskLine(task)}${runningHint}`);
        } catch (error) {
          return errorResult(`删除任务失败: ${error}`);
        }
      },
    ),

    defineTool(
      'dogear__ExecuteTask',
      '执行任务',
      '将一个计划（plan）或待办（backlog）任务转入执行队列（queued），轮到后会自动创建执行会话按 plan 实施；对 plan 态任务执行等价于用户确认。\n' +
        '任务尚无 plan 文档（planPath 缺失）会报错——先落盘 plan 文档，再用 dogear__CreateTask 重新挂载（planPath 必传）。',
      z.object({
        taskId: z.string().min(1).describe('任务 ID（dogear__ListTasks 查看）'),
      }),
      async (args) => {
        try {
          const existing = await taskService.getTask(workspaceId, args.taskId);
          if (!existing) return errorResult(`任务 ${args.taskId} 不存在，可用 dogear__ListTasks 查看。`);
          if (!existing.planPath) {
            return errorResult(
              `任务《${existing.title}》尚无 plan 文档，无法执行；请落盘 plan 文档后用 dogear__CreateTask 重新挂载（planPath 必传）。`,
            );
          }
          const task = await taskService.executeTask(workspaceId, workspacePath, args.taskId);
          getTaskQueue().kick();
          return textResult(
            `✅ 任务已转入队列\n- 任务 ID: ${task.id}\n- 标题: ${task.title}\n- plan: ${task.planPath}\n` +
            '队列串行执行：轮到后会自动创建执行会话按 plan 实施，完成进入待审核并系统通知。',
          );
        } catch (error) {
          return errorResult(`执行任务失败: ${error}`);
        }
      },
    ),

    defineTool(
      'dogear__ListTasks',
      '列出实施任务',
      '列出实施任务及其状态（plan 计划 / backlog 待办 / queued 排队 / running 执行中 / review 待审核 / done 已通过 / rejected 已打回 / interrupted 已中断）。status 省略时列出全部，其中已完成任务仅显示最近 20 条（需要完整清单传 status=\'done\'）；看计划用 status=\'plan\'，看待办用 status=\'backlog\'，看中断待处理用 status=\'interrupted\'。',
      z.object({
        status: z.enum(['plan', 'backlog', 'queued', 'running', 'review', 'done', 'rejected', 'interrupted']).optional().describe('按状态过滤'),
      }),
      async (args) => {
        try {
          const tasks = await taskService.listTasks(workspaceId);
          const filtered = args.status ? tasks.filter((t) => t.status === args.status) : tasks;
          if (filtered.length === 0) {
            return textResult(args.status ? `没有 ${args.status} 状态的任务。` : '当前没有任何任务。');
          }
          if (args.status) {
            return textResult(`共 ${filtered.length} 个任务：\n\n${filtered.map(taskLine).join('\n')}`);
          }
          const shown: Task[] = [];
          let doneTotal = 0;
          let doneTruncated = false;
          for (const status of LIST_STATUS_ORDER) {
            const group = filtered.filter((t) => t.status === status);
            if (status === 'done') {
              doneTotal = group.length;
              doneTruncated = group.length > LIST_DONE_LIMIT;
              shown.push(...group.slice(0, LIST_DONE_LIMIT));
            } else {
              shown.push(...group);
            }
          }
          const tail = doneTruncated
            ? `\n\n⚠️ 已完成任务仅显示最近 20 条（共 ${doneTotal} 条），需要完整清单请传 status='done'`
            : '';
          return textResult(`共 ${filtered.length} 个任务：\n\n${shown.map(taskLine).join('\n')}${tail}`);
        } catch (error) {
          return errorResult(`列出任务失败: ${error}`);
        }
      },
    ),

    defineTool(
      'dogear__ReportTaskResult',
      '申报任务执行完成',
      '申报任务执行完成（仅任务执行会话可用）：整个计划实施完成后调用，按当前会话归属校验，命中后任务进入待审核（review）并系统通知用户审核；执行过程就在本会话，无需另行整理结果摘要。\n' +
        '必须用户本人完成的事项（登录/授权/线下操作/人工拍板）同时调用 dogear__TrackUserActions 提议勾选卡，不要只写在回复里。任务已被中断时继续工作并申报同样有效（中断后让会话继续，完成后申报）。',
      z.object({}),
      async () => {
        if (!sourceContext) return errorResult('当前上下文缺少会话标识，无法申报任务结果。');
        try {
          const task = await taskService.reportTaskResult(workspaceId, workspacePath, sourceContext.conversationId);
          if (!task) {
            const mine = (await taskService.listTasks(workspaceId)).find(
              (t) => t.execSessionId === sourceContext.conversationId,
            );
            if (mine && ['review', 'done'].includes(mine.status)) {
              return textResult(`任务《${mine.title}》已申报完成（当前状态 ${mine.status}），无需重复申报。`);
            }
            return errorResult('当前会话不是任何待申报任务（running/interrupted/rejected）的执行会话，无法申报。');
          }
          return textResult(
            `✅ 任务已申报完成\n- 任务 ID: ${task.id}\n- 标题: ${task.title}\n- 状态: review（待审核）\n` +
              '用户会收到系统通知，等待其审核（通过 → done / 打回 → rejected）。',
          );
        } catch (error) {
          return errorResult(`申报任务结果失败: ${error}`);
        }
      },
    ),
  ];
}

registerToolGroup({
  server: 'dogear-tasks',
  label: '任务系统',
  create: createTaskToolDefs,
  placeholder: ['', '', { workspaceId: '', conversationId: '' }],
});
