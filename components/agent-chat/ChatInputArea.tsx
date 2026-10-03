import { memo, useMemo, useEffect, useRef, useState, useCallback, type RefObject } from 'react';
import { toast } from 'sonner';
import { Shield, ChevronRight, ChevronDown, X, Globe, ImagePlus, Send, Square, ShieldAlert, FileText, MessageSquare, MessageSquareQuote, Folder, StickyNote, Pause, Hourglass, Split } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { client } from '@/lib/client';
import { useReferenceStore } from '@/stores/reference-store';
import { useHandoffDraftStore } from '@/stores/handoff-draft-store';
import { SHUNT_ACTION_META, type ShuntAction } from './shunt-suggestions';
import { useInputFocusStore } from '@/stores/input-focus-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { PermissionMode } from '@/types/electron-api';
import type { ModelSelection } from '@/types/settings';
import type { PendingImage } from './hooks/useImageAttachment';
import { SlashCommandMenu } from './SlashCommandMenu';
import { UsageBadge } from './usage-badge/UsageBadge';
import { ModelSelector } from '@/components/ModelSelector';
import type { PendingState } from './hooks/usePendingState';
import type { SlashCommandInfo } from '@/stores/slash-command-store';

const PERMISSION_MODE_STYLES: Record<PermissionMode, {
  border: string;
  focusRing: string;
  icon: string;
  label: string;
}> = {
  default: {
    border: 'border-orange-300 dark:border-orange-500/60',
    focusRing: 'has-[[data-slot=input-group-control]:focus-visible]:border-orange-400 has-[[data-slot=input-group-control]:focus-visible]:ring-orange-400/20 dark:has-[[data-slot=input-group-control]:focus-visible]:border-orange-500 dark:has-[[data-slot=input-group-control]:focus-visible]:ring-orange-500/20',
    icon: 'text-orange-500',
    label: '需确认',
  },
  autoExecute: {
    border: 'border-green-300 dark:border-green-500/60',
    focusRing: 'has-[[data-slot=input-group-control]:focus-visible]:border-green-400 has-[[data-slot=input-group-control]:focus-visible]:ring-green-400/20 dark:has-[[data-slot=input-group-control]:focus-visible]:border-green-500 dark:has-[[data-slot=input-group-control]:focus-visible]:ring-green-500/20',
    icon: 'text-green-500',
    label: '自动执行',
  },
};

interface ChatInputAreaProps {
  input: string;
  setInput: (value: string) => void;
  pendingState: PendingState;
  isPaused: boolean;
  isSessionReady: boolean;
  sessionId: string | null;
  conversationId: string | null;
  placeholder: string;
  showStatusHint: boolean;
  currentSelection: ModelSelection | null;
  onSelectionChange: (s: ModelSelection | null) => void;
  permissionMode: PermissionMode;
  setPermissionMode: (mode: PermissionMode) => void;
  hasPendingUserAction: boolean;
  isSubSession?: boolean;
  /** run settled 但仍有 running 直属子会话：状态行展示「等待子会话交付中」，不改变输入框行为 */
  awaitingDelivery?: boolean;
  pendingImages: PendingImage[];
  imageInputRef: RefObject<HTMLInputElement | null>;
  handleSend: () => void;
  handleKeyPress: (e: React.KeyboardEvent) => void;
  handleImageFiles: (files: FileList | File[]) => void;
  removePendingImage: (index: number) => void;
  insertModeChangeNotice: (mode: string) => void;
  onInterrupt: () => void | Promise<void>;
  // 斜杠命令相关
  isSlashMenuOpen: boolean;
  filteredCommands: SlashCommandInfo[];
  filterQuery: string;
  onSlashCommandSelect: (cmd: SlashCommandInfo) => void;
  onSlashMenuClose: () => void;
}

export const ChatInputArea = memo(function ChatInputArea({
  input,
  setInput,
  pendingState,
  isPaused,
  isSessionReady,
  sessionId,
  conversationId,
  placeholder,
  showStatusHint,
  currentSelection,
  onSelectionChange,
  permissionMode,
  setPermissionMode,
  hasPendingUserAction,
  pendingImages,
  imageInputRef,
  handleSend,
  handleKeyPress,
  handleImageFiles,
  removePendingImage,
  insertModeChangeNotice,
  onInterrupt,
  isSlashMenuOpen,
  filteredCommands,
  filterQuery,
  onSlashCommandSelect,
  onSlashMenuClose,
  isSubSession,
  awaitingDelivery = false,
}: ChatInputAreaProps) {
  const settings = useSettingsStore((s) => s.settings);
  const isModelMissing = !currentSelection;
  const effectivePlaceholder = isModelMissing ? '请先选择模型' : placeholder;
  // 从 reference store 读取引用数据，只取锚定本会话的项
  const allReferencedArticles = useReferenceStore((s) => s.referencedArticles);
  const removeReferencedArticle = useReferenceStore((s) => s.removeReferencedArticle);
  const allQuotedSnippets = useReferenceStore((s) => s.quotedSnippets);
  const removeQuotedSnippet = useReferenceStore((s) => s.removeQuotedSnippet);
  const allMessageSnippets = useReferenceStore((s) => s.messageSnippets);
  const removeMessageSnippet = useReferenceStore((s) => s.removeMessageSnippet);
  const allReferencedFiles = useReferenceStore((s) => s.referencedFiles);
  const removeReferencedFile = useReferenceStore((s) => s.removeReferencedFile);
  const allReferencedConversations = useReferenceStore((s) => s.referencedConversations);
  const removeReferencedConversation = useReferenceStore((s) => s.removeReferencedConversation);
  const allReferencedSharedFiles = useReferenceStore((s) => s.referencedSharedFiles);
  const removeReferencedSharedFile = useReferenceStore((s) => s.removeReferencedSharedFile);
  const allReferencedNotes = useReferenceStore((s) => s.referencedNotes);
  const removeReferencedNote = useReferenceStore((s) => s.removeReferencedNote);
  const shuntBubble = useReferenceStore((s) => (conversationId ? s.shuntBubbles[conversationId] : undefined));
  const removeShuntBubble = useReferenceStore((s) => s.removeShuntBubble);
  const allHandoffDrafts = useHandoffDraftStore((s) => s.draftsByConversation);
  const removeHandoffDraft = useHandoffDraftStore((s) => s.removeDraft);
  const handoffDrafts = useMemo(
    () => (conversationId ? allHandoffDrafts[conversationId] ?? [] : []),
    [allHandoffDrafts, conversationId]
  );
  const [expandedDraftIds, setExpandedDraftIds] = useState<Set<string>>(new Set());
  const toggleDraftExpanded = useCallback((id: string) => {
    setExpandedDraftIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const referencedArticles = useMemo(
    () => allReferencedArticles.filter((a) => a.anchorConversationId === conversationId),
    [allReferencedArticles, conversationId]
  );
  const quotedSnippets = useMemo(
    () => allQuotedSnippets.filter((s) => s.anchorConversationId === conversationId),
    [allQuotedSnippets, conversationId]
  );
  const messageSnippets = useMemo(
    () => allMessageSnippets.filter((s) => s.anchorConversationId === conversationId),
    [allMessageSnippets, conversationId]
  );
  const referencedFiles = useMemo(
    () => allReferencedFiles.filter((f) => f.anchorConversationId === conversationId),
    [allReferencedFiles, conversationId]
  );
  const referencedConversations = useMemo(
    () => allReferencedConversations.filter((c) => c.anchorConversationId === conversationId),
    [allReferencedConversations, conversationId]
  );
  const referencedSharedFiles = useMemo(
    () => allReferencedSharedFiles.filter((f) => f.anchorConversationId === conversationId),
    [allReferencedSharedFiles, conversationId]
  );
  const referencedNotes = useMemo(
    () => allReferencedNotes.filter((n) => n.anchorConversationId === conversationId),
    [allReferencedNotes, conversationId]
  );
  const shuntMeta = shuntBubble ? SHUNT_ACTION_META[shuntBubble.action as ShuntAction] : null;

  // 引用跳转等场景的聚焦请求：seq 变化即聚焦本会话输入框
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const focusSeq = useInputFocusStore((s) => (conversationId ? s.focusSeq[conversationId] : undefined));
  useEffect(() => {
    if (focusSeq === undefined) return;
    textareaRef.current?.focus();
  }, [focusSeq]);

  // 暂停请求已受理但未到 turn 边界期间（running 仍 true）显示「暂停中…」，paused 广播后自动复位
  const [pauseRequested, setPauseRequested] = useState(false);
  useEffect(() => {
    if (pendingState !== 'running') setPauseRequested(false);
  }, [pendingState]);

  const handlePause = useCallback(async () => {
    if (!sessionId) return;
    try {
      const result = await client.pauseQueryBasedSession({ sessionId });
      if ('error' in result) {
        toast.error('暂停请求失败', { description: result.error });
        return;
      }
      if (!result.success) {
        toast.info('当前没有运行中的任务');
        return;
      }
      setPauseRequested(true);
    } catch (e) {
      console.warn('暂停请求失败:', e);
      toast.error('暂停请求失败');
    }
  }, [sessionId]);

  return (
    <div className="p-3">
      {hasPendingUserAction ? (
        // 有未处理的权限请求或 AskUser 问题时，显示提示而非输入框
        <div className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground bg-secondary rounded-lg border border-border">
          <ShieldAlert size={16} />
          <span>请先处理上方的权限请求或问题</span>
        </div>
      ) : (
        <>
          {/* 主输入容器 — InputGroup + Textarea + Addon */}
          <div className="relative">
            {/* 斜杠命令浮动菜单 */}
            <SlashCommandMenu
              commands={filteredCommands}
              isOpen={isSlashMenuOpen}
              filterQuery={filterQuery}
              onSelect={onSlashCommandSelect}
              onClose={onSlashMenuClose}
            />
          </div>
          <InputGroup className={cn(
              "rounded-xl bg-muted/50 h-auto flex-col transition-colors",
              PERMISSION_MODE_STYLES[permissionMode]?.border,
              PERMISSION_MODE_STYLES[permissionMode]?.focusRing,
            )}>
            {/* 顶部 Addon：分流气泡 + 移交草稿 + 引用芯片 + 图片预览 */}
            {(handoffDrafts.length > 0 || shuntBubble || referencedArticles.length > 0 || quotedSnippets.length > 0 || messageSnippets.length > 0 || referencedFiles.length > 0 || referencedConversations.length > 0 || referencedSharedFiles.length > 0 || referencedNotes.length > 0 || pendingImages.length > 0) && (
              <InputGroupAddon align="block-start" className="flex-col items-start gap-2 pt-3 pb-0">
                {/* 分流操作气泡：建议卡点击后插入，发送时转为 <shunt> 标签，可删除或忽略 */}
                {shuntBubble && shuntMeta && (
                  <div className="flex items-center gap-2 w-full px-2.5 py-1.5 bg-violet-50 border border-violet-200 rounded-lg text-xs text-violet-700 dark:bg-violet-950/40 dark:border-violet-800/60 dark:text-violet-300">
                    <Split size={12} className="flex-shrink-0" />
                    <span className="flex-shrink-0 font-medium">分流 · {shuntMeta.label}</span>
                    <span className="truncate" title={shuntBubble.summary}>{shuntBubble.summary}</span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => removeShuntBubble(conversationId!)}
                      className="flex-shrink-0 ml-auto h-4 w-4 p-0 rounded-full hover:bg-violet-100 dark:hover:bg-violet-900/40"
                      title="移除分流指令，作为普通消息发送"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                )}
                {/* 浏览器移交草稿：待编辑引用块，发送时转为「来自浏览器一键移交」文本块拼在用户文本之前 */}
                {handoffDrafts.length > 0 && (
                  <div className="flex flex-col gap-1.5 w-full">
                    {handoffDrafts.map((d) => {
                      const hasExcerpt = !!(d.selectionText || d.textExcerpt);
                      const expanded = expandedDraftIds.has(d.id);
                      return (
                        <div
                          key={d.id}
                          className="w-full px-2.5 py-1.5 bg-cyan-50 border border-cyan-200 rounded-lg text-xs text-cyan-800 dark:bg-cyan-950/40 dark:border-cyan-800/60 dark:text-cyan-200"
                        >
                          <div className="flex items-center gap-2">
                            <Globe size={12} className="flex-shrink-0" />
                            <span className="flex-shrink-0 font-medium">浏览器移交</span>
                            <span className="truncate" title={d.title || d.url}>{d.title || d.url}</span>
                            {hasExcerpt && (
                              <button
                                type="button"
                                onClick={() => toggleDraftExpanded(d.id)}
                                className="flex-shrink-0 p-0.5 rounded hover:bg-cyan-100 dark:hover:bg-cyan-900/40"
                                title={expanded ? '收起快照' : '展开快照'}
                              >
                                <ChevronDown className={cn('w-3 h-3 transition-transform', expanded && 'rotate-180')} />
                              </button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => removeHandoffDraft(conversationId!, d.id)}
                              className="flex-shrink-0 ml-auto h-4 w-4 p-0 rounded-full hover:bg-cyan-100 dark:hover:bg-cyan-900/40"
                              title="移除该移交草稿"
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                          <div className="truncate text-cyan-600/70 dark:text-cyan-400/70" title={d.url}>{d.url}</div>
                          {expanded && hasExcerpt && (
                            <div className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-white/60 dark:bg-black/20 p-1.5 text-cyan-900/80 dark:text-cyan-100/80">
                              {d.selectionText && <div>【选中内容】{d.selectionText}</div>}
                              {d.textExcerpt && <div>【正文快照】{d.textExcerpt}</div>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {/* 引用芯片 */}
                {(referencedArticles.length > 0 || quotedSnippets.length > 0 || messageSnippets.length > 0 || referencedFiles.length > 0 || referencedConversations.length > 0 || referencedSharedFiles.length > 0 || referencedNotes.length > 0) && (
                  <div className="flex flex-wrap gap-1.5">
                    {/* 文章引用芯片 — 淡蓝 */}
                    {referencedArticles.map(article => (
                      <span
                        key={article.id}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-sky-50 border border-sky-200 rounded-full text-xs text-sky-700 dark:bg-sky-950/40 dark:border-sky-800/60 dark:text-sky-300"
                        title={article.title}
                      >
                        <span className="max-w-[160px] truncate">{article.title}</span>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => removeReferencedArticle(article.id)}
                          className="flex-shrink-0 h-4 w-4 p-0 rounded-full hover:bg-sky-100 dark:hover:bg-sky-900/40"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </span>
                    ))}
                    {/* 文字片段引用芯片 — 淡紫灰 */}
                    {quotedSnippets.map(snippet => (
                      <span
                        key={snippet.id}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 border border-slate-200 rounded-full text-xs text-slate-600 dark:bg-slate-800/60 dark:border-slate-700 dark:text-slate-300"
                        title={`来自《${snippet.articleTitle}》: ${snippet.text}`}
                      >
                        <span className="max-w-[120px] truncate">{`"${snippet.text}"`}</span>
                        <span className="text-slate-400 flex-shrink-0">- {snippet.articleTitle.length > 8 ? snippet.articleTitle.slice(0, 8) + '...' : snippet.articleTitle}</span>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => removeQuotedSnippet(snippet.id)}
                          className="flex-shrink-0 h-4 w-4 p-0 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </span>
                    ))}
                    {/* 会话消息片段芯片 — 灰蓝 */}
                    {messageSnippets.map(snippet => (
                      <span
                        key={snippet.id}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-50 border border-indigo-200 rounded-full text-xs text-indigo-700 dark:bg-indigo-950/40 dark:border-indigo-800/60 dark:text-indigo-300"
                        title={`来自会话消息 · ${new Date(snippet.timestamp).toLocaleString('zh-CN', { hour12: false })}: ${snippet.text}`}
                      >
                        <MessageSquareQuote className="w-3 h-3 flex-shrink-0" />
                        <span className="max-w-[120px] truncate">{`"${snippet.text}"`}</span>
                        <span className="text-indigo-400 flex-shrink-0">{new Date(snippet.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => removeMessageSnippet(snippet.id)}
                          className="flex-shrink-0 h-4 w-4 p-0 rounded-full hover:bg-indigo-100 dark:hover:bg-indigo-900/40"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </span>
                    ))}
                    {/* 文件/文件夹引用芯片 — 淡石板绿 */}
                    {referencedFiles.map(file => (
                      <span
                        key={file.path}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-teal-50 border border-teal-200 rounded-full text-xs text-teal-700 dark:bg-teal-950/40 dark:border-teal-800/60 dark:text-teal-300"
                        title={file.path}
                      >
                        {file.type === 'folder'
                          ? <Folder className="w-3 h-3 flex-shrink-0" />
                          : <FileText className="w-3 h-3 flex-shrink-0" />}
                        <span className="max-w-[160px] truncate">{file.name}</span>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => removeReferencedFile(file.path)}
                          className="flex-shrink-0 h-4 w-4 p-0 rounded-full hover:bg-teal-100 dark:hover:bg-teal-900/40"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </span>
                    ))}
                    {/* 会话引用芯片 — 淡紫 */}
                    {referencedConversations.map(conv => (
                      <span
                        key={conv.conversationId}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-purple-50 border border-purple-200 rounded-full text-xs text-purple-700 dark:bg-purple-950/40 dark:border-purple-800/60 dark:text-purple-300"
                        title={`引用会话: ${conv.title}`}
                      >
                        <MessageSquare className="w-3 h-3 flex-shrink-0" />
                        <span className="max-w-[160px] truncate">{conv.title}</span>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => removeReferencedConversation(conv.conversationId)}
                          className="flex-shrink-0 h-4 w-4 p-0 rounded-full hover:bg-purple-100 dark:hover:bg-purple-900/40"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </span>
                    ))}
                    {/* 共享文件引用芯片 — 淡青柠 */}
                    {referencedSharedFiles.map(file => (
                      <span
                        key={file.absPath}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-lime-50 border border-lime-200 rounded-full text-xs text-lime-700 dark:bg-lime-950/40 dark:border-lime-800/60 dark:text-lime-300"
                        title={file.absPath}
                      >
                        <Folder className="w-3 h-3 flex-shrink-0" />
                        <span className="max-w-[160px] truncate">{file.relPath}</span>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => removeReferencedSharedFile(file.absPath)}
                          className="flex-shrink-0 h-4 w-4 p-0 rounded-full hover:bg-lime-100 dark:hover:bg-lime-900/40"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </span>
                    ))}
                    {/* 笔记引用芯片 — 玫粉 */}
                    {referencedNotes.map(note => (
                      <span
                        key={note.noteId}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-rose-50 border border-rose-200 rounded-full text-xs text-rose-700 dark:bg-rose-950/40 dark:border-rose-800/60 dark:text-rose-300"
                        title={`引用笔记: ${note.title}`}
                      >
                        <StickyNote className="w-3 h-3 flex-shrink-0" />
                        <span className="max-w-[160px] truncate">{note.title}</span>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => removeReferencedNote(note.noteId)}
                          className="flex-shrink-0 h-4 w-4 p-0 rounded-full hover:bg-rose-100 dark:hover:bg-rose-900/40"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </span>
                    ))}
                  </div>
                )}

                {/* 图片预览 */}
                {pendingImages.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {pendingImages.map((img, i) => (
                      <div key={i} className="relative group/img">
                        <img
                          src={img.preview}
                          alt={`待发送 ${i + 1}`}
                          className="w-16 h-16 object-cover rounded-md border border-gray-200 dark:border-gray-700"
                        />
                        <Button
                          variant="destructive"
                          size="icon-xs"
                          onClick={() => removePendingImage(i)}
                          className="absolute -top-1.5 -right-1.5 w-4 h-4 p-0 rounded-full opacity-0 group-hover/img:opacity-100 transition-opacity"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </InputGroupAddon>
            )}

            {/* 无边框 Textarea */}
            <InputGroupTextarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyPress}
              onPaste={(e) => {
                const items = e.clipboardData?.items;
                if (!items) return;
                const imageFiles: File[] = [];
                for (const item of items) {
                  if (item.type.startsWith('image/')) {
                    const file = item.getAsFile();
                    if (file) imageFiles.push(file);
                  }
                }
                if (imageFiles.length > 0) {
                  e.preventDefault();
                  handleImageFiles(imageFiles);
                }
              }}
              placeholder={effectivePlaceholder}
              className="min-h-[2.5rem] max-h-[200px] overflow-y-auto px-3 py-3"
              rows={1}
              disabled={!isSessionReady || isModelMissing}
            />

            {/* 隐藏的文件选择器 */}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) handleImageFiles(e.target.files);
                e.target.value = '';
              }}
            />

            {/* 底部工具行 Addon */}
            <InputGroupAddon align="block-end" className="flex-row items-center gap-1 pb-2">
              {/* 附件按钮 */}
              <InputGroupButton
                size="icon-xs"
                onClick={() => imageInputRef.current?.click()}
                className="text-muted-foreground hover:text-foreground"
                title="上传图片"
                disabled={!isSessionReady}
              >
                <ImagePlus size={14} />
              </InputGroupButton>

              {/* 模型选择 */}
              <ModelSelector
                settings={settings}
                value={currentSelection}
                onChange={onSelectionChange}
                allowUnset={false}
                triggerVariant="inline"
              />

              {/* 分隔 */}
              <span className="mx-0.5 h-4 w-px bg-border" />

              {/* 权限模式 DropdownMenu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <InputGroupButton
                    size="xs"
                    className={cn("gap-1", PERMISSION_MODE_STYLES[permissionMode]?.icon || 'text-muted-foreground')}
                    title="权限模式"
                    disabled={isSubSession}
                  >
                    <Shield size={14} />
                    <span className="text-xs">
                      {isSubSession ? '自动执行（子会话固定）' : (PERMISSION_MODE_STYLES[permissionMode]?.label || '需确认')}
                    </span>
                    {!isSubSession && <ChevronRight size={12} className="rotate-90" />}
                  </InputGroupButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[120px]">
                  <DropdownMenuLabel>权限模式</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup
                    value={permissionMode}
                    onValueChange={async (value) => {
                      const newMode = value as PermissionMode;
                      setPermissionMode(newMode);
                      if (sessionId) {
                        await client.setPermissionMode({ sessionId, mode: newMode });
                        insertModeChangeNotice(newMode);
                      }
                    }}
                  >
                    <DropdownMenuRadioItem value="autoExecute">自动执行</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="default">需确认</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* 上下文用量徽章 */}
              <UsageBadge conversationId={conversationId} isStreaming={pendingState === 'running'} />

              {/* 发送/停止按钮（右侧） */}
              <div className="ml-auto flex items-center gap-1">
                {pendingState === 'running' && (
                  <InputGroupButton
                    size="xs"
                    onClick={() => { void handlePause(); }}
                    disabled={pauseRequested}
                    title={pauseRequested ? '暂停中…（完成当前步骤后暂停）' : '暂停（完成当前步骤后暂停）'}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Pause size={14} />
                    <span className="text-xs">{pauseRequested ? '暂停中…' : '暂停'}</span>
                  </InputGroupButton>
                )}
                {(input.trim() || pendingImages.length > 0 || shuntBubble || handoffDrafts.length > 0) ? (
                  // 有输入内容/分流气泡 → 始终显示发送按钮（运行中时插话发送，Agent 在下一轮窗口接收）
                  <InputGroupButton
                    variant="default"
                    size="icon-xs"
                    onClick={handleSend}
                    disabled={!isSessionReady || isModelMissing}
                    title={isModelMissing ? "请先选择模型" : (pendingState !== 'idle' ? "插话发送 (Ctrl+Enter)" : "发送 (Ctrl+Enter)")}
                  >
                    <Send size={14} />
                  </InputGroupButton>
                ) : pendingState !== 'idle' ? (
                  // 无内容 + 运行中/有插话队列 → 停止按钮
                  <InputGroupButton
                    variant="destructive"
                    size="icon-xs"
                    onClick={() => { void onInterrupt(); }}
                    title={pendingState === 'flushing' ? '停止（清空插话队列）' : '停止'}
                  >
                    <Square size={14} />
                  </InputGroupButton>
                ) : (
                  // 无内容 + 空闲 → 禁用发送按钮
                  <InputGroupButton
                    variant="default"
                    size="icon-xs"
                    onClick={handleSend}
                    disabled
                    title="发送 (Ctrl+Enter)"
                  >
                    <Send size={14} />
                  </InputGroupButton>
                )}
              </div>
            </InputGroupAddon>
          </InputGroup>

          {/* 容器外：会话状态 */}
          {showStatusHint && (
            <div className="mt-1.5 px-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span>{sessionId ? `${sessionId.substring(0, 8)}...` : '连接中...'}</span>
              {isPaused ? (
                <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <Pause size={12} />
                  已暂停 · 发送消息继续
                </span>
              ) : awaitingDelivery ? (
                <span className="flex items-center gap-1 text-orange-600 dark:text-orange-400">
                  <Hourglass size={12} />
                  等待子会话交付中 · 可继续对话
                </span>
              ) : (
                isSessionReady && <span className="text-green-600 dark:text-green-400">● 就绪</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
});
