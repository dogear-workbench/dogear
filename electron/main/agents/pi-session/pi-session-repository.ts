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

  private async findMetadata(workspaceId: string, sessionId: string): Promise<JsonlSessionMetadata> {
    const { repo, cwd } = this.getWorkspaceRepository(workspaceId);
    const metadata = (await repo.list({ cwd })).find((item) => item.id === sessionId);
    if (!metadata) throw new Error(`Harness session not found: ${sessionId}`);
    return metadata;
  }

  async create(workspaceId: string, sessionId?: string): Promise<{ session: Session<JsonlSessionMetadata>; info: PiHarnessSession }> {
    const { repo, cwd } = this.getWorkspaceRepository(workspaceId);
    const session = await repo.create({ cwd, id: sessionId });
    const metadata = await session.getMetadata();
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
    return { session, info: toSessionInfo(metadata) };
  }
}

let repository: PiSessionRepository | null = null;

export function getPiSessionRepository(): PiSessionRepository {
  if (!repository) repository = new PiSessionRepository();
  return repository;
}
