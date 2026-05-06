import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { CORE_PROFILE_SOFT_LIMIT } from './types';

interface Props {
  workspacePath: string;
}

export function CoreProfilePanel({ workspacePath }: Props) {
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [updated, setUpdated] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await client.getCoreProfile({ workspacePath });
      if ('profile' in result) {
        const text = result.profile?.content ?? '';
        setContent(text);
        setSavedContent(text);
        setUpdated(result.profile?.updated ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => { load(); }, [load]);

  const dirty = content !== savedContent;

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await client.updateCoreProfile({ workspacePath, content });
      if ('success' in result && result.success) {
        setSavedContent(content);
        // 重新读取拿最新 updated 时间
        const fresh = await client.getCoreProfile({ workspacePath });
        if ('profile' in fresh && fresh.profile) {
          setUpdated(fresh.profile.updated);
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setContent(savedContent);
  };

  const charCount = content.length;
  const overLimit = charCount > CORE_PROFILE_SOFT_LIMIT;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        每次会话启动时，核心档案作为系统提示词的一部分自动注入（建议 ≤ {CORE_PROFILE_SOFT_LIMIT} 字符）。
        内容通常包含用户身份、当前主线、强偏好等高频引用的上下文。
      </p>
      {updated && (
        <p className="text-xs text-muted-foreground">
          更新时间：{new Date(updated).toLocaleString('zh-CN')}
        </p>
      )}
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={loading ? '加载中...' : '# 用户画像\n## 身份\n...\n## 当前主线\n...\n## 强偏好\n...'}
        className="min-h-[300px] font-mono text-sm resize-y"
        disabled={loading}
      />
      <div className="flex items-center justify-between">
        <span className={cn('text-xs', overLimit ? 'text-destructive' : 'text-muted-foreground')}>
          当前字符数：{charCount} {overLimit && `（超出 ${CORE_PROFILE_SOFT_LIMIT}，仍可保存）`}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" disabled={!dirty || saving} onClick={handleCancel}>
            取消
          </Button>
          <Button size="sm" disabled={!dirty || saving} onClick={handleSave}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>
    </div>
  );
}
