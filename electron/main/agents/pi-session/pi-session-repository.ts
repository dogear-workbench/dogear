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

  async delete(workspaceId: string, sessionId: string): Promise<void> {
    const { repo } = this.getWorkspaceRepository(workspaceId);
    await repo.delete(await this.findMetadata(workspaceId, sessionId));
    this.metadataCache.delete(workspaceId);
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
