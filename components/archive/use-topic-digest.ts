import { useCallback, useEffect, useRef, useState } from 'react';
import { client } from '@/lib/client';
import type { TopicDigest } from './types';

export function useTopicDigest(workspaceId: string, topicId: string | null) {
  const [digest, setDigest] = useState<TopicDigest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<{ topicId: string; digest: TopicDigest } | null>(null);
  const requestRef = useRef(0);

  const fetchDigest = useCallback((id: string, force: boolean) => {
    if (!force) {
      const cached = cacheRef.current;
      if (cached && cached.topicId === id) {
        setDigest(cached.digest);
        setError(null);
        setLoading(false);
        return;
      }
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    client.getArchivedTopicDigest({ workspaceId, groupId: id }).then((result) => {
      if (requestRef.current !== requestId) return;
      if (result.error || !result.digest) {
        setError(result.error || '话题摘要数据缺失');
        setDigest(null);
      } else {
        cacheRef.current = { topicId: id, digest: result.digest };
        setDigest(result.digest);
      }
      setLoading(false);
    });
  }, [workspaceId]);

  useEffect(() => {
    if (!topicId) {
      setDigest(null);
      setError(null);
      setLoading(false);
      return;
    }
    fetchDigest(topicId, false);
  }, [topicId, fetchDigest]);

  const retry = useCallback(() => {
    if (topicId) fetchDigest(topicId, true);
  }, [topicId, fetchDigest]);

  return { digest, loading, error, retry };
}
