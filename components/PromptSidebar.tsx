import { useState, useEffect, useCallback } from 'react';
import { X, Save, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useUIStore } from '@/stores/ui-store';
import { useSettingsStore } from '@/stores/settings-store';

export function PromptSidebar() {
  const open = useUIStore((s) => s.promptSidebarOpen);
  const close = useUIStore((s) => s.closePromptSidebar);
  const settings = useSettingsStore((s) => s.settings);
  const saveSettings = useSettingsStore((s) => s.saveSettings);
  const restartActiveSessions = useSettingsStore((s) => s.restartActiveSessions);

  // 本地编辑状态
  const [localValue, setLocalValue] = useState('');
  const [saving, setSaving] = useState(false);

  // 当面板打开或 settings 变化时同步
  useEffect(() => {
    if (open) {
      setLocalValue(settings.ai.systemPromptAppend || '');
    }
  }, [open, settings.ai.systemPromptAppend]);

  const savedValue = settings.ai.systemPromptAppend || '';
  const isDirty = localValue !== savedValue;

  const handleSave = useCallback(async (restart: boolean) => {
    setSaving(true);
    try {
      const updated = {
        ...settings,
        ai: { ...settings.ai, systemPromptAppend: localValue || undefined },
      };
      await saveSettings(updated);
      if (restart) {
        await restartActiveSessions();
      }
      close();
    } finally {
      setSaving(false);
    }
  }, [settings, localValue, saveSettings, restartActiveSessions, close]);

  // 当前 settingSources 状态（只读展示）
  const sources = settings.ai.settingSources || ['user'];

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
          <h3 className="text-sm font-semibold">自定义系统提示</h3>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={close}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 说明 */}
          <p className="text-xs text-muted-foreground">
            此内容将追加到 Claude Code 预设系统提示词之后。修改后需重启会话才能生效。
          </p>

          {/* 编辑区 */}
          <Textarea
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            placeholder="例如：始终使用中文回答&#10;优先搜索书籍内容再回答&#10;回答时引用具体章节"
            className="min-h-[200px] text-sm resize-y"
          />

          {/* settingSources 状态 */}
          <div className="rounded-md border p-3 space-y-1">
            <p className="text-xs font-medium text-muted-foreground">设置源加载状态</p>
            <div className="flex gap-2">
              <span className={cn(
                'text-xs px-2 py-0.5 rounded-full border',
                sources.includes('user')
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'bg-muted text-muted-foreground',
              )}>
                user
              </span>
              <span className={cn(
                'text-xs px-2 py-0.5 rounded-full border',
                sources.includes('project')
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'bg-muted text-muted-foreground',
              )}>
                project
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              在设置 → 工作区配置中管理
            </p>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="border-t px-4 py-3 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={close}
            disabled={saving}
          >
            取消
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => handleSave(false)}
            disabled={!isDirty || saving}
          >
            <Save className="h-3.5 w-3.5 mr-1" />
            保存
          </Button>
          <Button
            size="sm"
            className="flex-1"
            onClick={() => handleSave(true)}
            disabled={!isDirty || saving}
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            保存并重启
          </Button>
        </div>
      </div>
    </>
  );
}
