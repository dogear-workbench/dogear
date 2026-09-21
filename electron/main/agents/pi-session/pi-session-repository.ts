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

  async create(workspaceId: string, sessionId?: string): Promise<{ session: Session<JsonlSessionMetadata>; info: PiHarnessSession }> {
    const { repo, cwd } = this.getWorkspaceRepository(workspaceId);
    const session = await repo.create({ cwd, id: sessionId });
    const metadata = await session.getMetadata();
    this.metadataCache.delete(workspaceId);
    return { session, info: toSessionInfo(metadata) };
  }

  async open(workspaceId: string, sessionId: string): Promise<Session<JsonlSessionMetadata>> {
    const { repo } = this.getWorkspaceRepository(workspaceId);
    return repo.open(await this.findMetadata(workspaceId, sessionId));
  }

  async getSessionPath(workspaceId: string, sessionId: string): Promise<string> {
    return (await this.findMetadata(workspaceId, sessionId)).path;
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
    const metadata = await this.findMetadata(fromWorkspaceId, sessionId);
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
    const session = await repo.fork(await this.findMetadata(workspaceId, sourceSessionId), {
      cwd,
      ...options,
    });
    const metadata = await session.getMetadata();
    this.metadataCache.delete(workspaceId);
    return { session, info: toSessionInfo(metadata) };
  }
}

let repository: PiSessionRepository | null = null;

export function getPiSessionRepository(): PiSessionRepository {
  if (!repository) repository = new PiSessionRepository();
  return repository;
}
