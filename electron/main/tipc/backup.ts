// electron/main/tipc/backup.ts
// 应用数据备份：状态查询 / 手动备份 / 列表 / 恢复 / 打开目录；配置实时读 settings.backup
import fs from 'fs/promises';
import electron from 'electron';
import { tipc } from '@egoist/tipc/main';
import * as backupService from '../services/backup-service/index.js';
import {
  BACKUP_CATEGORIES,
  GLOBAL_SCOPE,
  getCategoryDef,
  listWorkspaceIds,
  resolveCategoryConfig,
  type BackupCategoryKey,
  type BackupConfig,
  type BackupRunResult,
  type BackupScope,
} from '../services/backup-service/index.js';
import { backupDirPath } from '../services/backup-service/zip-pack.js';
import { loadSettings } from '../services/settings-service.js';

const t = tipc.create();
const { shell } = electron;

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function readBackupConfig(): Promise<BackupConfig | null> {
  const settings = await loadSettings();
  return settings.backup?.categories ?? null;
}

/** 分类在给定 scope 列表下逐个备份，单项失败不中断（配置的 keep 生效） */
async function runCategoryScopes(category: BackupCategoryKey, scopes: BackupScope[]): Promise<BackupRunResult[]> {
  const config = await readBackupConfig();
  const conf = resolveCategoryConfig(getCategoryDef(category), config ?? undefined);
  const results: BackupRunResult[] = [];
  for (const scope of scopes) {
    try {
      results.push(await backupService.runBackup(category, scope, { keep: conf.keep }));
    } catch (err) {
      results.push({ key: category, scope, fileName: null, size: 0, pruned: [], error: errMessage(err) });
    }
  }
  return results;
}

export const backupRouter = {
  getBackupStatus: t.procedure.action(async () => ({
    status: await backupService.getBackupStatus(await readBackupConfig()),
  })),

  // category+scope 成对=单项；只给 category=该分类全部适用 scope；只给 scope=该 scope 适用分类；都缺=全量
  runBackup: t.procedure
    .input<{ category?: BackupCategoryKey; scope?: BackupScope }>()
    .action(async ({ input }): Promise<{ results: BackupRunResult[] } | { error: string }> => {
      try {
        const { category, scope } = input ?? {};
        if (category && scope) {
          return { results: await runCategoryScopes(category, [scope]) };
        }
        if (category) {
          const def = getCategoryDef(category);
          const scopes: BackupScope[] = [
            ...(def.scopes.includes('global') ? [GLOBAL_SCOPE] : []),
            ...(def.scopes.includes('workspace') ? await listWorkspaceIds() : []),
          ];
          return { results: await runCategoryScopes(category, scopes) };
        }
        if (scope) {
          const scopeType = scope === GLOBAL_SCOPE ? 'global' : 'workspace';
          const keys = BACKUP_CATEGORIES.filter((d) => d.scopes.includes(scopeType)).map((d) => d.key);
          const results: BackupRunResult[] = [];
          for (const key of keys) results.push(...(await runCategoryScopes(key, [scope])));
          return { results };
        }
        return { results: await backupService.runBackupAll(await readBackupConfig()) };
      } catch (err) {
        return { error: errMessage(err) };
      }
    }),

  listBackups: t.procedure
    .input<{ category: BackupCategoryKey; scope: BackupScope }>()
    .action(async ({ input }) => {
      try {
        return { backups: await backupService.listBackups(input.category, input.scope) };
      } catch (err) {
        return { error: errMessage(err) };
      }
    }),

  restoreBackup: t.procedure
    .input<{ category: BackupCategoryKey; scope: BackupScope; fileName: string }>()
    .action(async ({ input }) => {
      try {
        return await backupService.restoreBackup(input.category, input.scope, input.fileName);
      } catch (err) {
        return { error: errMessage(err) };
      }
    }),

  openBackupDir: t.procedure
    .input<{ scope?: BackupScope }>()
    .action(async ({ input }) => {
      try {
        const dir = backupDirPath((input ?? {}).scope ?? GLOBAL_SCOPE);
        await fs.mkdir(dir, { recursive: true });
        const errMsg = await shell.openPath(dir);
        if (errMsg) return { error: errMsg };
        return { success: true };
      } catch (err) {
        return { error: errMessage(err) };
      }
    }),
};
