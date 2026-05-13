import * as workspaceJsonService from './workspace-json-service.js';
export type { Workspace } from './workspace-json-service.js';

export async function getCurrentWorkspace() {
  return (await workspaceJsonService.getDefault()) || null;
}
