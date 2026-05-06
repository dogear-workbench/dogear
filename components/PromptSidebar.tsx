import { useState, useEffect, useCallback } from 'react';
import { X, RotateCcw, Settings, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useUIStore } from '@/stores/ui-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useConversationStore } from '@/stores/conversation-store';

export function PromptSidebar() {
  const open = useUIStore((s) => s.promptSidebarOpen);
  const close = useUIStore((s) => s.closePromptSidebar);
  const openSettings = useUIStore((s) => s.openSettings);
  const settings = useSettingsStore((s) => s.settings);
  const selectedConversation = useConversationStore((s) => s.selectedConversation);
  const updateConversationPersona = useConversationStore((s) => s.updateConversationPersona);
  const triggerSessionRestart = useConversationStore((s) => s.triggerSessionRestart);

  const personas = settings.personas || [];

  // 本地编辑状态
  const [localPersonaId, setLocalPersonaId] = useState<string | undefined>(undefined);
  const [localTempPrompt, setLocalTempPrompt] = useState('');
  const [saving, setSaving] = useState(false);

  // 当面板打开或选中对话变化时，同步本地状态
  useEffect(() => {
    if (open && selectedConversation) {
      setLocalPersonaId(selectedConversation.persona_id || undefined);
      setLocalTempPrompt(selectedConversation.temp_prompt || '');
    }
  }, [open, selectedConversation]);

  // 判断是否有未保存的变更
  const savedPersonaId = selectedConversation?.persona_id || undefined;
  const savedTempPrompt = selectedConversation?.temp_prompt || '';
  const isDirty = localPersonaId !== savedPersonaId || localTempPrompt !== savedTempPrompt;

  // 保存并重启会话
  const handleSaveAndRestart = useCallback(async () => {
    if (!selectedConversation?.id) return;
    setSaving(true);
    try {
      await updateConversationPersona(
        selectedConversation.id,
        localPersonaId,
        localTempPrompt || undefined,
      );
      triggerSessionRestart();
      close();
    } finally {
      setSaving(false);
    }
  }, [selectedConversation, localPersonaId, localTempPrompt, updateConversationPersona, triggerSessionRestart, close]);

  // 打开设置页面的人设管理标签
  const handleOpenPersonaSettings = () => {
    close();
    openSettings();
  };

  // 当前选中的人设信息
  const currentPersona = personas.find((p) => p.id === localPersonaId);

  return (
    <>
      {/* 遮罩 */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/20"
          onClick={close}
        />
      )}

      {/* 侧边栏面板 */}
      <div
        className={cn(
          'fixed right-0 top-0 bottom-0 z-50 w-80 bg-background border-l shadow-lg',
          'flex flex-col transition-transform duration-200 ease-in-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-sm font-semibold">对话设置</h3>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={close}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {!selectedConversation ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground p-4">
            <p className="text-sm text-center">请先选择一个对话</p>
          </div>
        ) : (
          <>
            {/* 内容 */}
            <div className="flex-1 overflow-y-auto">
              {/* 当前状态摘要 */}
              <div className="px-4 py-3 border-b bg-muted/30">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <User className="w-3.5 h-3.5" />
                  <span>人设：{currentPersona?.name || '无'}</span>
                </div>
                {localTempPrompt && (
                  <div className="text-xs text-muted-foreground mt-1 ml-5.5">
                    对话规则：已设置
                  </div>
                )}
              </div>

              {/* 人设选择列表 */}
              <div className="px-4 py-3 space-y-2">
                <label className="text-xs font-medium text-muted-foreground">选择人设</label>
                <ScrollArea className="max-h-[240px]">
                  <div className="space-y-1 pr-2">
                    {/* 无人设选项 */}
                    <div
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer text-sm',
                        !localPersonaId ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50',
                      )}
                      onClick={() => setLocalPersonaId(undefined)}
                    >
                      <div className={cn(
                        'w-3.5 h-3.5 rounded-full border-2 flex-shrink-0',
                        !localPersonaId ? 'border-primary bg-primary' : 'border-muted-foreground/40',
                      )}>
                        {!localPersonaId && (
                          <div className="w-full h-full rounded-full bg-primary flex items-center justify-center">
                            <div className="w-1.5 h-1.5 rounded-full bg-background" />
                          </div>
                        )}
                      </div>
                      <span className="text-muted-foreground">无人设</span>
                    </div>

                    {/* 人设列表 */}
                    {personas.map((persona) => (
                      <div
                        key={persona.id}
                        className={cn(
                          'flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer text-sm',
                          localPersonaId === persona.id ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50',
                        )}
                        onClick={() => setLocalPersonaId(persona.id)}
                      >
                        <div className={cn(
                          'w-3.5 h-3.5 rounded-full border-2 flex-shrink-0',
                          localPersonaId === persona.id ? 'border-primary bg-primary' : 'border-muted-foreground/40',
                        )}>
                          {localPersonaId === persona.id && (
                            <div className="w-full h-full rounded-full bg-primary flex items-center justify-center">
                              <div className="w-1.5 h-1.5 rounded-full bg-background" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{persona.name}</div>
                          {persona.description && (
                            <div className="text-xs text-muted-foreground truncate">{persona.description}</div>
                          )}
                        </div>
                      </div>
                    ))}

                    {personas.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-4">
                        还没有人设，在设置中创建
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </div>

              {/* 分隔线 */}
              <div className="border-t mx-4" />

              {/* 对话规则（持久绑定此对话） */}
              <div className="px-4 py-3 space-y-2">
                <label className="text-xs font-medium text-muted-foreground">对话规则</label>
                <Textarea
                  value={localTempPrompt}
                  onChange={(e) => setLocalTempPrompt(e.target.value)}
                  placeholder="为当前对话添加专属规则（会跟随对话保存）..."
                  className="min-h-[100px] text-sm resize-y"
                />
                <p className="text-xs text-muted-foreground">
                  仅对当前对话生效，与对话一同保存（包括归档后）。
                </p>
              </div>
            </div>

            {/* 底部 */}
            <div className="border-t px-4 py-3 space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleOpenPersonaSettings}
              >
                <Settings className="h-3.5 w-3.5 mr-1" />
                在设置中管理人设
              </Button>
              <Button
                size="sm"
                className="w-full"
                onClick={handleSaveAndRestart}
                disabled={!isDirty || saving}
              >
                <RotateCcw className={cn("h-3.5 w-3.5 mr-1", saving && "animate-spin")} />
                {saving ? '保存中...' : '保存并重启会话'}
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
