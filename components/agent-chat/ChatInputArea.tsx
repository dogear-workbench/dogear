import type { RefObject } from 'react';
import { Brain, Shield, ChevronRight, X, ImagePlus, Send, Square, ShieldAlert, Sparkles, FileText } from 'lucide-react';
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
import type { PermissionMode } from '@/types/electron-api';
import type { PendingImage } from './hooks/useImageAttachment';
import { SlashCommandMenu } from './SlashCommandMenu';
import type { SlashCommandInfo } from '@/stores/slash-command-store';

// 权限模式 → 边框/图标颜色映射
const PERMISSION_MODE_STYLES: Record<PermissionMode, {
  border: string;
  focusRing: string;
  icon: string;
  label: string;
}> = {
  default: {
    border: 'border-orange-300 dark:border-orange-500/60',
    focusRing: 'has-[[data-slot=input-group-control]:focus-visible]:border-orange-400 has-[[data-slot=input-group-control]:focus-visible]:ring-orange-400/20',
    icon: 'text-orange-500',
    label: '需确认',
  },
  bypassPermissions: {
    border: 'border-green-300 dark:border-green-500/60',
    focusRing: 'has-[[data-slot=input-group-control]:focus-visible]:border-green-400 has-[[data-slot=input-group-control]:focus-visible]:ring-green-400/20',
    icon: 'text-green-500',
    label: '自动执行',
  },
  acceptEdits: {
    border: 'border-input',
    focusRing: '',
    icon: 'text-muted-foreground',
    label: '允许编辑',
  },
  plan: {
    border: 'border-blue-300 dark:border-blue-500/60',
    focusRing: 'has-[[data-slot=input-group-control]:focus-visible]:border-blue-400 has-[[data-slot=input-group-control]:focus-visible]:ring-blue-400/20',
    icon: 'text-blue-500',
    label: '仅规划',
  },
};

interface ChatInputAreaProps {
  input: string;
  setInput: (value: string) => void;
  isLoading: boolean;
  isSessionReady: boolean;
  sessionId: string | null;
  placeholder: string;
  showStatusHint: boolean;
  thinkingLevel: number;
  setThinkingLevel: (level: number) => void;
  permissionMode: PermissionMode;
  setPermissionMode: (mode: PermissionMode) => void;
  hasPendingUserAction: boolean;
  pendingImages: PendingImage[];
  imageInputRef: RefObject<HTMLInputElement | null>;
  handleSend: () => void;
  handleKeyPress: (e: React.KeyboardEvent) => void;
  handleImageFiles: (files: FileList | File[]) => void;
  removePendingImage: (index: number) => void;
  insertModeChangeNotice: (mode: string) => void;
  setIsLoading: (loading: boolean) => void;
  // 斜杠命令相关
  isSlashMenuOpen: boolean;
  filteredCommands: SlashCommandInfo[];
  filterQuery: string;
  onSlashCommandSelect: (cmd: SlashCommandInfo) => void;
  onSlashMenuClose: () => void;
  // 人设设置
  onTogglePromptSidebar?: () => void;
}

export function ChatInputArea({
  input,
  setInput,
  isLoading,
  isSessionReady,
  sessionId,
  placeholder,
  showStatusHint,
  thinkingLevel,
  setThinkingLevel,
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
  setIsLoading,
  isSlashMenuOpen,
  filteredCommands,
  filterQuery,
  onSlashCommandSelect,
  onSlashMenuClose,
  onTogglePromptSidebar,
}: ChatInputAreaProps) {
  // 从 reference store 读取引用数据
  const referencedArticles = useReferenceStore((s) => s.referencedArticles);
  const removeReferencedArticle = useReferenceStore((s) => s.removeReferencedArticle);
  const quotedSnippets = useReferenceStore((s) => s.quotedSnippets);
  const removeQuotedSnippet = useReferenceStore((s) => s.removeQuotedSnippet);
  const referencedFiles = useReferenceStore((s) => s.referencedFiles);
  const removeReferencedFile = useReferenceStore((s) => s.removeReferencedFile);

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
            {/* 顶部 Addon：引用芯片 + 图片预览 */}
            {(referencedArticles.length > 0 || quotedSnippets.length > 0 || referencedFiles.length > 0 || pendingImages.length > 0) && (
              <InputGroupAddon align="block-start" className="flex-col items-start gap-2 pt-3 pb-0">
                {/* 引用芯片 */}
                {(referencedArticles.length > 0 || quotedSnippets.length > 0 || referencedFiles.length > 0) && (
                  <div className="flex flex-wrap gap-1.5">
                    {/* 文章引用芯片 — 淡蓝 */}
                    {referencedArticles.map(article => (
                      <span
                        key={article.id}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-sky-50 border border-sky-200 rounded-full text-xs text-sky-700"
                        title={article.title}
                      >
                        <span className="max-w-[160px] truncate">{article.title}</span>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => removeReferencedArticle(article.id)}
                          className="flex-shrink-0 h-4 w-4 p-0 rounded-full hover:bg-sky-100"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </span>
                    ))}
                    {/* 文字片段引用芯片 — 淡紫灰 */}
                    {quotedSnippets.map(snippet => (
                      <span
                        key={snippet.id}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 border border-slate-200 rounded-full text-xs text-slate-600"
                        title={`来自《${snippet.articleTitle}》: ${snippet.text}`}
                      >
                        <span className="max-w-[120px] truncate">{`"${snippet.text}"`}</span>
                        <span className="text-slate-400 flex-shrink-0">- {snippet.articleTitle.length > 8 ? snippet.articleTitle.slice(0, 8) + '...' : snippet.articleTitle}</span>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => removeQuotedSnippet(snippet.id)}
                          className="flex-shrink-0 h-4 w-4 p-0 rounded-full hover:bg-slate-200"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </span>
                    ))}
                    {/* 文件引用芯片 — 淡石板绿 */}
                    {referencedFiles.map(file => (
                      <span
                        key={file.path}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-teal-50 border border-teal-200 rounded-full text-xs text-teal-700"
                        title={file.path}
                      >
                        <FileText className="w-3 h-3 flex-shrink-0" />
                        <span className="max-w-[160px] truncate">{file.name}</span>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => removeReferencedFile(file.path)}
                          className="flex-shrink-0 h-4 w-4 p-0 rounded-full hover:bg-teal-100"
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
                          className="w-16 h-16 object-cover rounded-md border border-gray-200"
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
              placeholder={placeholder}
              className="min-h-[2.5rem] max-h-[200px] overflow-y-auto px-3 py-3"
              rows={1}
              disabled={!isSessionReady}
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

              {/* 思考等级 DropdownMenu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <InputGroupButton
                    size="xs"
                    className={cn(
                      "gap-1",
                      thinkingLevel > 0 ? 'text-primary' : 'text-muted-foreground'
                    )}
                    title="思考深度"
                  >
                    <Brain size={14} />
                    <span className="text-xs">
                      {thinkingLevel === 0 ? '关闭' : thinkingLevel <= 2000 ? '低' : thinkingLevel <= 6000 ? '中' : '高'}
                    </span>
                    <ChevronRight size={12} className="rotate-90" />
                  </InputGroupButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[120px]">
                  <DropdownMenuLabel>思考深度</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup
                    value={String(thinkingLevel)}
                    onValueChange={async (value) => {
                      const newLevel = Number(value);
                      setThinkingLevel(newLevel);
                      if (sessionId) {
                        await client.setMaxThinkingTokens({
                          sessionId,
                          maxThinkingTokens: newLevel === 0 ? 0 : newLevel,
                        });
                      }
                    }}
                  >
                    <DropdownMenuRadioItem value="0">关闭</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="2000">低</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="6000">中</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="10000">高</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* 分隔 */}
              <span className="mx-0.5 h-4 w-px bg-border" />

              {/* 权限模式 DropdownMenu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <InputGroupButton
                    size="xs"
                    className={cn("gap-1", PERMISSION_MODE_STYLES[permissionMode]?.icon || 'text-muted-foreground')}
                    title="权限模式"
                  >
                    <Shield size={14} />
                    <span className="text-xs">
                      {PERMISSION_MODE_STYLES[permissionMode]?.label || '需确认'}
                    </span>
                    <ChevronRight size={12} className="rotate-90" />
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
                    <DropdownMenuRadioItem value="bypassPermissions">自动执行</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="acceptEdits">允许编辑</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="default">需确认</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="plan">仅规划</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* 人设按钮 */}
              {onTogglePromptSidebar && (
                <>
                  <span className="mx-0.5 h-4 w-px bg-border" />
                  <InputGroupButton
                    size="icon-xs"
                    onClick={onTogglePromptSidebar}
                    className="text-muted-foreground hover:text-foreground"
                    title="对话人设设置"
                  >
                    <Sparkles size={14} />
                  </InputGroupButton>
                </>
              )}

              {/* 发送/停止按钮（右侧） */}
              <div className="ml-auto">
                {isLoading ? (
                  <InputGroupButton
                    variant="destructive"
                    size="icon-xs"
                    onClick={async () => {
                      if (sessionId) {
                        await client.interruptQueryBasedSession({ sessionId });
                        setIsLoading(false);
                      }
                    }}
                    title="停止"
                  >
                    <Square size={14} />
                  </InputGroupButton>
                ) : (
                  <InputGroupButton
                    variant="default"
                    size="icon-xs"
                    onClick={handleSend}
                    disabled={(!input.trim() && pendingImages.length === 0) || !isSessionReady}
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
              {isSessionReady && <span className="text-green-600">● 就绪</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
