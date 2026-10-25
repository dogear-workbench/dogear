import { useEffect } from 'react';
import { NotebookPen } from 'lucide-react';
import { client } from '@/lib/client';
import { useSessionStore, NOTES_TAB_ID } from '@/stores/session-store';
import { useNotesStore } from '@/stores/notes-store';
import { useUIStore } from '@/stores/ui-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { registerProvider, unregisterProvider, type SearchProvider } from '@/stores/search-store';

async function searchNotes(query: string) {
  const q = query.trim();
  if (!q) return [];
  const workspace = useWorkspaceStore.getState().workspace;
  if (!workspace) return [];
  try {
    const result = await client.searchNotes({ workspaceId: workspace.id, query: q });
    if ('notes' in result) {
      return (result.notes ?? []).map((note) => ({
        id: `notes:${note.id}`,
        title: note.title || '（无标题）',
        description: note.snippet,
        icon: NotebookPen,
        onSelect: () => {
          const ui = useUIStore.getState();
          if (ui.notesListHidden) ui.toggleNotesListHidden();
          useNotesStore.getState().setActiveNoteId(note.id);
        },
      }));
    }
    console.error('[notes] searchNotes 失败:', result.error);
  } catch (error) {
    console.error('[notes] searchNotes 失败:', error);
  }
  return [];
}

export function NotesSearchProvider() {
  useEffect(() => {
    const provider: SearchProvider = {
      id: 'notes',
      placeholder: '搜索笔记',
      isActive: () => useSessionStore.getState().activeTabId === NOTES_TAB_ID,
      search: searchNotes,
    };
    registerProvider(provider);
    return () => unregisterProvider(provider.id);
  }, []);
  return null;
}
