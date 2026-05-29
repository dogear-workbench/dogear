import { useEffect, useState } from 'react';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import { useSettingsStore } from '@/stores/settings-store';
import { resolveContextLimit } from './usage-utils';
import type { ConversationUsage, ConversationUsageEntry } from '@/types/usage';

/** 取一条 entry 的主模型 usage（input token 最多的那个），用于解析上下文上限 */
function pickMainModelUsage(entry: ConversationUsageEntry | undefined) {
  if (!entry) return undefined;
  const models = Object.values(entry.modelUsage ?? {});
  if (models.length === 0) return undefined;
  return models.reduce((a, b) => (b.inputTokens > a.inputTokens ? b : a));
}

/**
 * 订阅某对话的用量数据：首屏全量拉取，usageEntryAdded 事件触发重新拉取。
 * 同时从 settings 读取当前 profile 的 1M 上下文开关，派生上下文上限。
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
      client.getUsage
        .invoke({ conversationId })
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

  const lastEntry = usage?.entries[usage.entries.length - 1];
  const contextLimit = resolveContextLimit(pickMainModelUsage(lastEntry), enable1MContext);

  return { usage, enable1MContext, contextLimit };
}
