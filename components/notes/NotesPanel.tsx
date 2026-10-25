import { useEffect } from 'react';
import { registerHotkey } from '@/lib/hotkey-registry';
import { useNotesStore } from '@/stores/notes-store';
import { NotesTimelinePane } from '@/components/notes/NotesTimelinePane';
import { NotesSearchProvider } from '@/components/notes/NotesSearchProvider';
import { useSessionStore, NOTES_TAB_ID } from '@/stores/session-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useUIStore } from '@/stores/ui-store';
import { useSettingsStore } from '@/stores/settings-store';
import { applyStoredNotesListWidth } from '@/hooks/use-panel-linkage';

export function NotesPanel() {
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const loadedWorkspaceId = useNotesStore((s) => s.loadedWorkspaceId);
  const loadNotes = useNotesStore((s) => s.loadNotes);
  const subscribeNotesChanged = useNotesStore((s) => s.subscribeNotesChanged);
  const setActiveNoteId = useNotesStore((s) => s.setActiveNoteId);

  const toggleListHidden = useUIStore((s) => s.toggleNotesListHidden);
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  const storedNotesListWidth = useSettingsStore((s) => s.settings.ui?.notesListWidth);

  const isActive = activeTabId === NOTES_TAB_ID;
  const workspaceId = workspace?.id ?? null;

  // 详情归属特定工作区的卡片，切工作区时关闭，避免跨区 id 悬空
  useEffect(() => {
    setActiveNoteId(null);
  }, [workspaceId, setActiveNoteId]);

  useEffect(() => {
    return subscribeNotesChanged();
  }, [subscribeNotesChanged]);

  // 设置加载后初始化笔记左栏宽度（clamp 220~420），后续设置变化同步跟进
  useEffect(() => {
    if (settingsLoaded) {
      applyStoredNotesListWidth(storedNotesListWidth);
    }
  }, [settingsLoaded, storedNotesListWidth]);

  useEffect(() => {
    if (!isActive || !workspace || loadedWorkspaceId === workspace.id) return;
    void loadNotes(workspace.id);
  }, [isActive, workspace, loadedWorkspaceId, loadNotes]);

  // 面板常驻挂载，仅笔记 tab 可见时生效，避免后台 tab 误触
  useEffect(() => {
    return registerHotkey('notes-toggle-list', () => {
      if (!isActive) return;
      toggleListHidden();
    });
  }, [isActive, toggleListHidden]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <NotesSearchProvider />
      <NotesTimelinePane />
    </div>
  );
}
