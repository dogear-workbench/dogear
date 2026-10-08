import { useEffect, useState } from 'react';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import { useSettingsStore } from '@/stores/settings-store';
import { useConversationStore } from '@/stores/conversation-store';
import { resolveContext } from './usage-utils';
import type { ConversationUsage } from '@/types/usage';

/**
 * 订阅某对话的用量数据：首屏全量拉取，usageEntryAdded 事件触发重新拉取。
 * 当前上下文占用/上限派生自主进程写入的快照 usage.latestContext（maxTokens 为查表后的真实窗口）。
 * autoCompactPercent 来自当前对话的 profile（对话级 modelSelection 优先，否则回退全局默认），
 * 用来判定徽章是否进入「即将压缩」状态。
 */
export function useConversationUsage(conversationId: string | null) {
  const [usage, setUsage] = useState<ConversationUsage | null>(null);

  const autoCompactPercent = useSettingsStore(s => {
    const conv = conversationId
      ? useConversationStore.getState().conversations.find(c => c.id === conversationId)
      : null;
    const sel = conv?.modelSelection ?? s.settings.ai.defaultModelSelection;
    return sel ? (s.settings.profiles[sel.profileId]?.autoCompactPercent ?? 80) : 80;
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

  const context = resolveContext(usage?.latestContext, autoCompactPercent);

  return { usage, context };
}
