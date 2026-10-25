/**
 * 工作区 git 系工具组，按「是否依赖用户 git 仓库」拆两组：
 * dogear-git（workspace-git 包）= 只读五件套 + GitCommit/GitRevert，操作用户 Git 仓库（正式历史）；
 * dogear-snapshot（workspace-snapshot 包）= GitSnapshotList/Restore，走自动快照仓库（安全网），无 git 仓库也可用。
 * 远端操作（push/pull）不提供；GitRevert 的逐次确认在 permission-rules 挂 ask，工具包注册不覆盖。
 */
import { z } from 'zod';
import {
  GitServiceError,
  getUserRepoStatus,
  getUserRepoDiff,
  getUserRepoLog,
  getUserRepoShow,
  getUserRepoBlame,
  commitToUserRepo,
  revertUserRepo,
  listShadowHistory,
  restoreFromSnapshot,
  type UserLogEntry,
  type SnapshotEntry,
} from '../../services/git-service/index.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef, type ToolResult } from '../pi/tool-adapter.js';

export interface GitToolsOpts {
  workspaceId: string;
  workspacePath: string;
}

const MAX_TEXT_OUTPUT = 30_000;

const REL_PATH_DESC = '工作区内相对路径（如 src/index.ts、dogear/设计.md），越出工作区会报错';
const REF_DESC = 'git 引用：commit hash（可短 hash）、分支名、tag、HEAD、HEAD~1 等';

function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

function clip(text: string): string {
  if (text.length <= MAX_TEXT_OUTPUT) return text;
  return `${text.slice(0, MAX_TEXT_OUTPUT)}\n…（输出过长已截断，共 ${text.length} 字符，可用 relPath 缩小范围）`;
}

function formatTime(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

async function gitAction(fn: () => Promise<string>): Promise<ToolResult> {
  try {
    return textResult(await fn());
  } catch (error) {
    const message =
      error instanceof GitServiceError
        ? error.message
        : `git 操作失败: ${error instanceof Error ? error.message : String(error)}`;
    return errorResult(message);
  }
}

function logLine(e: UserLogEntry): string {
  return `${e.hash.slice(0, 8)}  ${formatTime(e.time)}  ${e.author}  ${e.message}`;
}

function snapshotLine(e: SnapshotEntry): string {
  return `${e.hash.slice(0, 8)}  ${formatTime(e.time)}  ${e.message}`;
}

export function createGitToolDefs(opts: GitToolsOpts): ToolDef[] {
  const { workspaceId, workspacePath } = opts;
  const relPathSchema = z.string().min(1).optional().describe(REL_PATH_DESC);

  return [
    defineTool(
      'dogear__GitStatus',
      '查看 git 状态',
      '查看工作区 git 仓库当前分支与未提交变更列表（无参数）。了解改动全貌、确认提交范围时用。',
      z.object({}),
      () =>
        gitAction(async () => {
          const s = await getUserRepoStatus(workspacePath);
          if (s.entries.length === 0) return `分支 ${s.branch}，工作区干净（无未提交变更）。`;
          const rows = s.entries.map((e) => `${e.indexStatus}${e.worktreeStatus} ${e.path}`).join('\n');
          return `分支 ${s.branch}，${s.entries.length} 个未提交变更：\n${rows}\n（两列状态码 = 暂存区/工作区；M 修改、A 新增、D 删除、R 重命名、?? 未跟踪）`;
        }),
    ),

    defineTool(
      'dogear__GitDiff',
      '查看未提交改动 diff',
      `查看工作区相对 HEAD 的未提交改动内容。relPath 省略时返回全部改动的 diff。动手改文件前先看这个，避免与他人未提交改动冲突。`,
      z.object({ relPath: relPathSchema }),
      (args) =>
        gitAction(async () => {
          const diff = await getUserRepoDiff(workspacePath, args.relPath);
          if (!diff.trim()) return '没有未提交的改动（工作区与 HEAD 一致）。';
          return clip(diff);
        }),
    ),

    defineTool(
      'dogear__GitLog',
      '查询提交历史',
      '查询工作区 git 提交历史。支持按文件路径过滤（relPath）、按 commit message 关键词搜索（keyword）、限制条数（limit，默认 20）。出方案或改代码前先查相关文件与关键词的既有实现和演变。',
      z.object({
        relPath: relPathSchema,
        keyword: z.string().min(1).optional().describe('按 commit message 关键词过滤（git log --grep）'),
        limit: z.number().int().min(1).max(200).optional().describe('最多返回条数，默认 20'),
      }),
      (args) =>
        gitAction(async () => {
          const entries = await getUserRepoLog(workspacePath, {
            relPath: args.relPath,
            keyword: args.keyword,
            limit: args.limit,
          });
          if (entries.length === 0) {
            const scope = args.relPath ? `（路径 ${args.relPath}）` : args.keyword ? `（关键词「${args.keyword}」）` : '';
            return `没有匹配的提交${scope}。`;
          }
          return `共 ${entries.length} 条提交：\n${entries.map(logLine).join('\n')}`;
        }),
    ),

    defineTool(
      'dogear__GitShow',
      '查看某次提交内容',
      `查看某次提交的完整信息（元数据 + diff）。relPath 省略时展示该提交全部改动。配合 GitLog 找到的 hash 使用，弄清「当初为什么这么做」。`,
      z.object({
        ref: z.string().min(1).describe(REF_DESC),
        relPath: relPathSchema,
      }),
      (args) =>
        gitAction(async () => {
          const show = await getUserRepoShow(workspacePath, args.ref, args.relPath);
          if (!show.trim()) return `${args.ref} 没有可展示的内容。`;
          return clip(show);
        }),
    ),

    defineTool(
      'dogear__GitBlame',
      '逐行追溯修改归属',
      `查看文件的逐行修改归属（哪次提交、谁、何时改的）。定位某段代码的来历与演变时用。`,
      z.object({
        relPath: z.string().min(1).describe(REL_PATH_DESC),
      }),
      (args) =>
        gitAction(async () => {
          const blame = await getUserRepoBlame(workspacePath, args.relPath);
          if (!blame.trim()) return `${args.relPath} 没有可追溯的内容（空文件或未被跟踪）。`;
          return clip(blame);
        }),
    ),

    defineTool(
      'dogear__GitCommit',
      '提交改动到 git 仓库',
      '将工作区未提交改动 commit 进工作区 git 仓库。message 必填且要写清做了什么；paths 省略时提交全部改动，传入时只提交指定文件。用于显式产出定稿落库（自动快照由系统负责，无需手动触发）。',
      z.object({
        message: z.string().min(1).describe('commit message，一行说清做了什么与为什么'),
        paths: z.array(z.string().min(1)).min(1).optional().describe('限定提交的文件相对路径列表；省略时提交全部改动'),
      }),
      (args) =>
        gitAction(async () => {
          const hash = await commitToUserRepo(workspacePath, args.message.trim(), args.paths);
          return `已提交 ${hash.slice(0, 8)}：${args.message.trim()}`;
        }),
    ),

    defineTool(
      'dogear__GitRevert',
      '回退文件或提交',
      `破坏性操作，需用户逐次确认。relPath 传入时将该文件回退到 ref 版本（只改工作区文件，不产生提交，可再 GitCommit 落库）；relPath 省略时对整个提交执行 git revert（产生一条反向提交）。回退前先跟用户确认范围。`,
      z.object({
        ref: z.string().min(1).describe(REF_DESC),
        relPath: relPathSchema,
      }),
      (args) =>
        gitAction(async () => {
          await revertUserRepo(workspacePath, args.ref, args.relPath);
          if (args.relPath) {
            return `已将 ${args.relPath} 回退到 ${args.ref}（仅工作区文件已改动，尚未提交；确认无误后可用 dogear__GitCommit 落库）。`;
          }
          return `已对提交 ${args.ref} 执行 revert（生成反向提交）。`;
        }),
    ),

  ];
}

export function createSnapshotToolDefs(opts: GitToolsOpts): ToolDef[] {
  const { workspaceId, workspacePath } = opts;
  const relPathSchema = z.string().min(1).optional().describe(REL_PATH_DESC);

  return [
    defineTool(
      'dogear__GitSnapshotList',
      '查看自动快照历史',
      '查看系统的自动快照列表（agent 写入与 UI 文件操作自动触发，含被 .gitignore 的私人文件）。relPath 省略时列出全部快照。message 格式：[snapshot] <来源> <路径> (conv:<会话ID>)。这是不依赖用户提交的安全网账本。',
      z.object({ relPath: relPathSchema }),
      (args) =>
        gitAction(async () => {
          const entries = await listShadowHistory(workspaceId, workspacePath, args.relPath);
          if (entries.length === 0) {
            return args.relPath ? `${args.relPath} 还没有自动快照。` : '还没有任何自动快照。';
          }
          return `共 ${entries.length} 条快照（新→旧）：\n${entries.map(snapshotLine).join('\n')}`;
        }),
    ),

    defineTool(
      'dogear__GitSnapshotRestore',
      '从自动快照恢复文件',
      `把文件恢复到某条自动快照的版本（ref 用 GitSnapshotList 返回的 hash）。恢复前会自动打一条 pre-restore 快照，本操作永远可逆；恢复只改工作区文件，确认无误后可自行提交落库（若工作区是 git 仓库）。改坏文件需要回滚时用，git 回退覆盖不了的文件（未提交过仓库的）也能恢复。`,
      z.object({
        ref: z.string().min(1).describe('自动快照 hash（dogear__GitSnapshotList 返回）'),
        relPath: relPathSchema,
      }),
      (args) =>
        gitAction(async () => {
          await restoreFromSnapshot(workspaceId, workspacePath, args.ref, args.relPath);
          const target = args.relPath ?? '整个工作区';
          return `已将 ${target} 恢复到快照 ${args.ref.slice(0, 8)}；恢复前的状态已自动存为 pre-restore 快照（GitSnapshotList 最新一条可查）。`;
        }),
    ),
  ];
}

registerToolGroup({
  server: 'dogear-git',
  label: 'git 版本管理',
  create: createGitToolDefs,
  placeholder: [{ workspaceId: '', workspacePath: '' }],
});

registerToolGroup({
  server: 'dogear-snapshot',
  label: '快照安全网',
  create: createSnapshotToolDefs,
  placeholder: [{ workspaceId: '', workspacePath: '' }],
});
