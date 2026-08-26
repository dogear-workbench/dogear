import { createContext, useContext, type ReactNode } from 'react';

const WorkspaceIdContext = createContext<string | null>(null);

export function WorkspaceIdProvider({ workspaceId, children }: {
  workspaceId: string | null;
  children: ReactNode;
}) {
  return (
    <WorkspaceIdContext.Provider value={workspaceId}>
      {children}
    </WorkspaceIdContext.Provider>
  );
}

export function useWorkspaceId() {
  return useContext(WorkspaceIdContext);
}
