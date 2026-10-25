import { useCallback, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { ChatInputArea } from './ChatInputArea';
import { acceptImageFiles, fileToBase64Data } from './hooks/useImageAttachment';
import type { PendingState } from './hooks/usePendingState';
import { useDraftStore, draftAnchorId } from '@/stores/draft-store';
import { useGroupStore } from '@/stores/group-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useSlashCommandStore } from '@/stores/slash-command-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

const noop = () => {};

// 草稿态无 session，依赖会话的命令（含 useSendMessage 硬编码的 clear/compact/search）不得随首条消息落盘
const BLOCKED_SLASH_COMMANDS = new Set(['clear', 'compact', 'search']);

function isKnownSlashCommand(text: string) {
  const first = text.trim().split(/\s+/)[0];
  if (!first.startsWith('/')) return false;
  const name = first.slice(1).toLowerCase();
  return BLOCKED_SLASH_COMMANDS.has(name)
    || useSlashCommandStore.getState().allCommands.some((c) => c.name.toLowerCase() === name);
}

export function DraftChat() {
  const workspaceId = useWorkspaceStore((s) => s.workspace?.id ?? '');
  const slot = useDraftStore((s) => s.slots[workspaceId]);
  const groupId = slot?.groupId ?? null;
  const groupTitle = slot?.groupTitle ?? null;
  const input = slot?.input ?? '';
  const setInput = useDraftStore((s) => s.setInput);
  const modelSelection = slot?.modelSelection ?? null;
  const setModelSelection = useDraftStore((s) => s.setModelSelection);
  const setPermissionMode = useDraftStore((s) => s.setPermissionMode);
  const draftImages = slot?.pendingImages ?? [];
  const creating = useDraftStore((s) => s.creating);
  const createAndSend = useDraftStore((s) => s.createAndSend);

  const workspace = useWorkspaceStore((s) => s.workspace);
  const groups = useGroupStore((s) => s.groups);
  const settings = useSettingsStore((s) => s.settings);

  const imageInputRef = useRef<HTMLInputElement>(null);

  const workspaceName = workspace?.name ?? '';
  const topicName = groupId
    ? groups.find((g) => g.id === groupId)?.title || groupTitle || '话题'
    : null;

  const pendingImages = useMemo(
    () => draftImages.map((img) => ({ preview: `data:${img.media_type};base64,${img.data}` })),
    [draftImages],
  );

  const effectiveSelection = modelSelection ?? settings.ai.defaultModelSelection;
  const effectivePermissionMode = slot?.permissionMode ?? settings.ai.permissionMode;

  const handleImageFiles = useCallback(async (files: FileList | File[]) => {
    const accepted = await acceptImageFiles(files);
    if (accepted.length === 0) return;
    const images = await Promise.all(accepted.map(async (file) => ({
      media_type: file.type,
      data: await fileToBase64Data(file),
    })));
    const wsId = useWorkspaceStore.getState().workspace?.id;
    if (!wsId) return;
    const prev = useDraftStore.getState().slots[wsId]?.pendingImages ?? [];
    useDraftStore.getState().setPendingImages([...prev, ...images]);
  }, []);

  const removePendingImage = useCallback((index: number) => {
    const wsId = useWorkspaceStore.getState().workspace?.id;
    if (!wsId) return;
    const prev = useDraftStore.getState().slots[wsId]?.pendingImages ?? [];
    useDraftStore.getState().setPendingImages(prev.filter((_, i) => i !== index));
  }, []);

  const handleSend = useCallback(() => {
    const wsId = useWorkspaceStore.getState().workspace?.id;
    const slot = wsId ? useDraftStore.getState().slots[wsId] : undefined;
    if (!slot || (!slot.input.trim() && slot.pendingImages.length === 0)) return;
    if (slot.input.trim() && slot.pendingImages.length === 0 && isKnownSlashCommand(slot.input)) {
      toast.error('草稿态不支持斜杠命令', { description: '发送创建会话后再使用' });
      return;
    }
    void createAndSend();
  }, [createAndSend]);

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="flex-1 flex flex-col items-center justify-center gap-1.5">
        <p className="text-2xl font-semibold text-foreground">
          {topicName ? '新会话' : '新话题'}
        </p>
        <p className="text-sm text-muted-foreground">
          {topicName ? `${workspaceName} · ${topicName}` : workspaceName}
        </p>
      </div>

      <ChatInputArea
        input={input}
        setInput={setInput}
        pendingState={'idle' as PendingState}
        isPaused={false}
        isSessionReady={!creating}
        sessionId={null}
        conversationId={draftAnchorId(workspaceId)}
        placeholder="向 AI 助手提问..."
        showStatusHint={false}
        currentSelection={effectiveSelection}
        onSelectionChange={setModelSelection}
        permissionMode={effectivePermissionMode}
        setPermissionMode={setPermissionMode}
        hasPendingUserAction={false}
        pendingImages={pendingImages}
        imageInputRef={imageInputRef}
        handleSend={handleSend}
        handleKeyPress={handleKeyPress}
        handleImageFiles={handleImageFiles}
        removePendingImage={removePendingImage}
        insertModeChangeNotice={noop}
        onInterrupt={noop}
        isSlashMenuOpen={false}
        filteredCommands={[]}
        filterQuery=""
        onSlashCommandSelect={noop}
        onSlashMenuClose={noop}
      />
    </div>
  );
}
