import fs from 'fs/promises';
import path from 'path';
import {
  JsonlSessionRepo,
  type JsonlSessionMetadata,
  type Session,
} from '@earendil-works/pi-agent-core';
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node';
import { getConfigDir } from '../../services/settings-service.js';

export interface PiHarnessSession {
  id: string;
  filePath: string;
  createdAt: string;
}

export interface PiHarnessForkOptions {
  entryId?: string;
  position?: 'before' | 'at';
  id?: string;
}

interface WorkspaceRepository {
  repo: JsonlSessionRepo;
  cwd: string;
}

function getSessionsRoot(workspaceId: string): string {
  return path.join(getConfigDir(), 'workspaces', workspaceId, 'sessions');
}

// 镜像 pi-agent-core jsonl-repo 的 encodeCwd：session 按 <encodeCwd(cwd)>/<ts>_<sessionId>.jsonl 平铺，
// 文件名是稳定命名契约（session-id-repair.ts 同样依赖），按 id 直查只需 readdir，避免全量读 header
function encodeCwdMirror(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
}

const SESSION_FILE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_[0-9a-f-]+\.jsonl$/i;

function toSessionInfo(metadata: JsonlSessionMetadata): PiHarnessSession {
  return {
    id: metadata.id,
    filePath: metadata.path,
    createdAt: metadata.createdAt,
  };
}

export class PiSessionRepository {
  private repositories = new Map<string, WorkspaceRepository>();
  // 按 workspaceId 缓存的 session 列表；上游 JsonlSessionRepo 没有按 id 直查的 API，
  // 每次 open/delete/fork/getSessionPath 都要 list() 全量扫目录，工作区会话数一多就会变慢。
  // create/delete/fork 会改变文件集合，因此各自完成后立即失效对应缓存。
  private metadataCache = new Map<string, JsonlSessionMetadata[]>();

  private getWorkspaceRepository(workspaceId: string): WorkspaceRepository {
    let repository = this.repositories.get(workspaceId);
    if (!repository) {
      const cwd = path.join(getConfigDir(), 'workspaces', workspaceId);
      repository = {
        cwd,
        repo: new JsonlSessionRepo({
          fs: new NodeExecutionEnv({ cwd }),
          sessionsRoot: getSessionsRoot(workspaceId),
        }),
      };
      this.repositories.set(workspaceId, repository);
    }
    return repository;
  }

  private async listMetadata(workspaceId: string): Promise<JsonlSessionMetadata[]> {
    const cached = this.metadataCache.get(workspaceId);
    if (cached) return cached;
    const { repo, cwd } = this.getWorkspaceRepository(workspaceId);
    const list = await repo.list({ cwd });
    this.metadataCache.set(workspaceId, list);
    return list;
  }

  private async findMetadata(workspaceId: string, sessionId: string): Promise<JsonlSessionMetadata> {
    const metadata = (await this.listMetadata(workspaceId)).find((item) => item.id === sessionId);
    if (!metadata) throw new Error(`Harness session not found: ${sessionId}`);
    return metadata;
  }

  private async findSessionPathDirect(workspaceId: string, sessionId: string): Promise<JsonlSessionMetadata | null> {
    const cwd = path.join(getConfigDir(), 'workspaces', workspaceId);
    const dir = path.join(getSessionsRoot(workspaceId), encodeCwdMirror(cwd));
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      return null;
    }
    const suffix = `_${sessionId}.jsonl`;
    const hit = files.find((file) => file.toLowerCase().endsWith(suffix));
    if (!hit) return null;
    const m = SESSION_FILE_RE.exec(hit);
    if (!m) return null;
    return {
      id: sessionId,
      createdAt: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7]}Z`,
      path: path.join(dir, hit),
      cwd,
    };
  }

  private async resolveMetadata(workspaceId: string, sessionId: string): Promise<JsonlSessionMetadata> {
    const direct = await this.findSessionPathDirect(workspaceId, sessionId);
    if (direct) return direct;
    return this.findMetadata(workspaceId, sessionId);
  }

  async create(workspaceId: string, sessionId?: string): Promise<{ session: Session<JsonlSessionMetadata>; info: PiHarnessSession }> {
    const { repo, cwd } = this.getWorkspaceRepository(workspaceId);
    const session = await repo.create({ cwd, id: sessionId });
    const metadata = await session.getMetadata();
    this.metadataCache.delete(workspaceId);
    return { session, info: toSessionInfo(metadata) };
  }

  async open(workspaceId: string, sessionId: string): Promise<Session<JsonlSessionMetadata>> {
    const { repo } = this.getWorkspaceRepository(workspaceId);
    return repo.open(await this.resolveMetadata(workspaceId, sessionId));
  }

  async getSessionPath(workspaceId: string, sessionId: string): Promise<string> {
    return (await this.resolveMetadata(workspaceId, sessionId)).path;
  }

  async delete(workspaceId: string, sessionId: string): Promise<boolean> {
    const { repo } = this.getWorkspaceRepository(workspaceId);
    const metadata = (await this.listMetadata(workspaceId)).find((item) => item.id === sessionId);
    if (!metadata) return false;
    try {
      await repo.delete(metadata);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.metadataCache.delete(workspaceId);
      return false;
    }
    this.metadataCache.delete(workspaceId);
    return true;
  }

  /**
   * 将 session JSONL 从一个工作区搬到另一个工作区：在目标 repo 侧 create 同 id session
   * （得到符合存储布局的路径与 header），把源文件 header 之后的行原样拼接过去，
   * header 的 cwd/timestamp 改写为源会话值，最后删源文件并失效两侧 metadata 缓存。
   * 调用方须保证该 session 无打开的实例（先 closeSession）。
   * @returns 搬运后的目标文件绝对路径
   */
  async relocateSession(fromWorkspaceId: string, toWorkspaceId: string, sessionId: string): Promise<string> {
    const metadata = await this.resolveMetadata(fromWorkspaceId, sessionId);
    const toCwd = path.join(getConfigDir(), 'workspaces', toWorkspaceId);
    const { repo: toRepo } = this.getWorkspaceRepository(toWorkspaceId);
    const session = await toRepo.create({ cwd: toCwd, id: sessionId });
    const created = await session.getMetadata();
    try {
      const srcText = await fs.readFile(metadata.path, 'utf-8');
      const lines = srcText.split('\n');
      const header = JSON.parse(lines[0]) as Record<string, unknown>;
      header.cwd = toCwd;
      if (typeof header.timestamp === 'string') header.timestamp = metadata.createdAt;
      const body = lines.slice(1).join('\n');
      await fs.writeFile(created.path, `${JSON.stringify(header)}\n${body}`);
    } catch (error) {
      await fs.rm(created.path, { force: true }).catch(() => {});
      throw error;
    }
    await fs.unlink(metadata.path);
    this.metadataCache.delete(fromWorkspaceId);
    this.metadataCache.delete(toWorkspaceId);
    return created.path;
  }

  async fork(
    workspaceId: string,
    sourceSessionId: string,
    options: PiHarnessForkOptions = {},
  ): Promise<{ session: Session<JsonlSessionMetadata>; info: PiHarnessSession }> {
    const { repo, cwd } = this.getWorkspaceRepository(workspaceId);
    const session = await repo.fork(await this.resolveMetadata(workspaceId, sourceSessionId), {
      cwd,
      ...options,
    });
    const metadata = await session.getMetadata();
    this.metadataCache.delete(workspaceId);
    return { session, info: toSessionInfo(metadata) };
  }

  /** 旁路写盘（如恢复会话备份）后失效缓存；create/delete/fork 等内部路径已自行失效 */
  invalidateMetadataCache(workspaceId?: string): void {
    if (workspaceId === undefined) this.metadataCache.clear();
    else this.metadataCache.delete(workspaceId);
  }
}

let repository: PiSessionRepository | null = null;

export function getPiSessionRepository(): PiSessionRepository {
  if (!repository) repository = new PiSessionRepository();
  return repository;
}
