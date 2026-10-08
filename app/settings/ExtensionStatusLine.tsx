import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import type { ExtensionStatus } from '../../electron/main/services/browser/browser-gateway';

type BrowserActionPolicy = Awaited<ReturnType<typeof client.getBrowserActionPolicy>>;

export function ExtensionActionPolicyNote() {
  const [policy, setPolicy] = useState<BrowserActionPolicy | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => client.getBrowserActionPolicy().then((p) => {
      if (!cancelled) setPolicy(p);
    });
    refresh();
    const unsub = rendererEvents.settingsChanged.listen(refresh);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  if (!policy) return null;
  return (
    <div className="space-y-1 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
      <p className="font-medium text-foreground/80">Agent 操作动作分级</p>
      <ul className="list-disc space-y-0.5 pl-4">
        {policy.levels.map((level) => (
          <li key={level}>{level}</li>
        ))}
      </ul>
      <p className="pt-1">
        支付与网银黑名单（确认也不放行）：<span className="font-mono">{policy.paymentBlockedHosts.join('、')}</span>
      </p>
    </div>
  );
}

function ExtensionInstallGuide({ dirPath, isMac }: { dirPath: string | null | undefined; isMac: boolean }) {
  const handleCopy = async () => {
    if (!dirPath) return;
    try {
      await navigator.clipboard.writeText(dirPath);
      toast.success('已复制扩展目录路径');
    } catch (err) {
      toast.error('复制失败', { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleOpenDir = () => {
    if (!dirPath) return;
    client.openFileInFolder({ filePath: dirPath });
  };

  return (
    <div className="space-y-2 rounded-lg bg-muted/40 p-3">
      <p className="text-sm font-medium">浏览器扩展：未连接，按以下步骤安装</p>
      <ol className="list-decimal space-y-0.5 pl-5 text-xs text-muted-foreground">
        <li>
          打开 <span className="font-mono text-foreground/80">chrome://extensions</span>
          （Edge 为 <span className="font-mono text-foreground/80">edge://extensions</span>）
        </li>
        <li>开启「开发者模式」</li>
        <li>点「加载已解压的扩展程序」，选择下方目录</li>
      </ol>
      {dirPath === null ? (
        <p className="text-xs text-muted-foreground">未找到扩展目录，请重新安装应用</p>
      ) : dirPath === undefined ? null : (
        <div className="flex items-center gap-2">
          <code
            className="min-w-0 flex-1 truncate rounded border bg-background px-2 py-1.5 font-mono text-xs"
            title={dirPath}
          >
            {dirPath}
          </code>
          <Button size="sm" variant="outline" onClick={handleCopy}>
            <Copy /> 复制
          </Button>
          <Button size="sm" variant="outline" onClick={handleOpenDir}>
            <FolderOpen /> 打开扩展目录
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        应用更新后扩展文件会随之更新，需重启浏览器后在扩展管理页重新加载。
        {isMac ? ' macOS 需先点下方「注册到浏览器」完成 NM host 注册，再进行上述安装。' : ''}
      </p>
    </div>
  );
}

export function ExtensionStatusLine() {
  const [status, setStatus] = useState<ExtensionStatus | null>(null);
  const [dirPath, setDirPath] = useState<string | null | undefined>(undefined);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    let cancelled = false;
    client.getExtensionStatus().then((s) => {
      if (!cancelled) setStatus(s);
    });
    client.getExtensionDirPath().then((r) => {
      if (!cancelled) setDirPath(r.path);
    });
    client.getPlatform().then((p) => {
      if (!cancelled) setIsMac(p === 'darwin');
    });
    const unsub = rendererEvents.extensionStatusChanged.listen((s) => setStatus(s));
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  if (!status || status.status === 'disconnected') {
    return <ExtensionInstallGuide dirPath={dirPath} isMac={isMac} />;
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
      {status.textPreview && (
        <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4">
          正文预览：{status.textPreview}
        </p>
      )}
    </div>
  );
}
