import { createContext, useContext, type ReactNode } from 'react';

const WorkspaceIdContext = createContext<string | null>(null);
const GroupIdContext = createContext<string | null>(null);

export function WorkspaceIdProvider({ workspaceId, groupId, children }: {
  workspaceId: string | null;
  groupId?: string | null;
  children: ReactNode;
}) {
  return (
    <WorkspaceIdContext.Provider value={workspaceId}>
      <GroupIdContext.Provider value={groupId ?? null}>
        {children}
      </GroupIdContext.Provider>
    </WorkspaceIdContext.Provider>
  );
}

export function useWorkspaceId() {
  return useContext(WorkspaceIdContext);
}

export function useGroupId() {
  return useContext(GroupIdContext);
}
