import { useEffect, useState } from 'react';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import { useSettingsStore } from '@/stores/settings-store';
import { useConversationStore } from '@/stores/conversation-store';
import { resolveContext } from './usage-utils';
import type { ConversationUsage } from '@/types/usage';

/**
 * 订阅某对话的用量数据：首屏全量拉取，usageEntryAdded 事件触发重新拉取。
 * 当前上下文占用/上限派生自 SDK 真实快照 usage.latestContext。
 * autoCompactWindow 来自当前对话的 profile（对话级 modelSelection 优先，否则回退全局默认），
 * 用来把进度条上限限制到用户设定的自动压缩窗口。
 */
export function useConversationUsage(conversationId: string | null) {
  const [usage, setUsage] = useState<ConversationUsage | null>(null);

  const autoCompactWindow = useSettingsStore(s => {
    const conv = conversationId
      ? useConversationStore.getState().conversations.find(c => c.id === conversationId)
      : null;
    const sel = conv?.modelSelection ?? s.settings.ai.defaultModelSelection;
    return sel ? (s.settings.profiles[sel.profileId]?.autoCompactWindow ?? 0) : 0;
  });

  useEffect(() => {
    if (!conversationId) {
      setUsage(null);
      return;
    }
    let cancelled = false;

    const fetchUsage = () => {
      client.getUsage({ conversationId })
        .then(data => {
          if (!cancelled) setUsage(data);
        })
        .catch(() => {});
    };

    fetchUsage();

    const unsubscribe = rendererEvents.usageEntryAdded.listen(data => {
      if (data.conversationId === conversationId) fetchUsage();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [conversationId]);

  const context = resolveContext(usage?.latestContext, autoCompactWindow);

  return { usage, context };
}
