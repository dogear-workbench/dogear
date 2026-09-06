import { useEffect, useState } from 'react';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import type { ExtensionStatus } from '../../electron/main/services/browser/browser-gateway';

export function ExtensionStatusLine() {
  const [status, setStatus] = useState<ExtensionStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    client.getExtensionStatus().then((s) => {
      if (!cancelled) setStatus(s);
    });
    const unsub = rendererEvents.extensionStatusChanged.listen((s) => setStatus(s));
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  if (!status || status.status === 'disconnected') {
    return (
      <p className="text-sm text-muted-foreground">
        浏览器扩展：未连接（在浏览器扩展里点击「连接此标签页」）
      </p>
    );
  }

  const tabLabel = status.title || status.url;
  return (
    <div className="space-y-1">
      <p className="text-sm">
        ✅ 已连接{tabLabel ? ` · 当前标签页：${tabLabel}` : ''}
      </p>
      {status.extractError && (
        <p className="text-xs text-muted-foreground">该页面内容无法读取</p>
      )}
      {status.authorizedOrigins.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>已授权域名：</span>
          {status.authorizedOrigins.map((origin) => (
            <span key={origin} className="rounded-md bg-muted px-1.5 py-0.5 font-mono">
              {origin}
            </span>
          ))}
          <span>（撤销请在扩展弹窗中操作）</span>
        </div>
      )}
      {status.textPreview && (
        <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4">
          正文预览：{status.textPreview}
        </p>
      )}
    </div>
  );
}
