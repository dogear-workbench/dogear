import { useEffect, useState } from 'react';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import { useSettingsStore } from '@/stores/settings-store';
import { resolveContext } from './usage-utils';
import type { ConversationUsage } from '@/types/usage';

/**
 * 订阅某对话的用量数据：首屏全量拉取，usageEntryAdded 事件触发重新拉取。
 * 当前上下文占用/上限派生自 SDK 真实快照 usage.latestContext。
 * enable1MContext 既用于徽章上的 1M 标记，也驱动 resolveContext 把上限兜底到 1M。
 */
export function useConversationUsage(conversationId: string | null) {
  const [usage, setUsage] = useState<ConversationUsage | null>(null);

  const enable1MContext = useSettingsStore(
    s => s.settings.profiles[s.settings.ai.activeProfileId]?.enable1MContext ?? false,
  );

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

  const context = resolveContext(usage?.latestContext, enable1MContext);

  return { usage, enable1MContext, context };
}
