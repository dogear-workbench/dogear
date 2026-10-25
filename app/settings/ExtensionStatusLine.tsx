import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, FolderOpen, RotateCcw, Download } from 'lucide-react';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { showConfirm } from '@/stores/confirm-store';
import { rendererEvents } from '@/lib/events';
import type { ExtensionStatus } from '../../electron/main/services/browser/browser-gateway';

type BrowserActionPolicy = Awaited<ReturnType<typeof client.getBrowserActionPolicy>>;
type ExtensionTarget = Awaited<ReturnType<typeof client.getExtensionDirPath>>;

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

/** 自定义副本动作条：builtin → 复制到自定义；custom → 恢复默认 + 落后时覆盖副本；动作后经 onUpdated 回传新目标状态 */
function ExtensionCustomBar({ target, onUpdated }: { target: ExtensionTarget; onUpdated: (t: ExtensionTarget) => void }) {
  const [busy, setBusy] = useState(false);

  const applyResult = async (action: () => Promise<{ ok: boolean; target?: ExtensionTarget; error?: string }>) => {
    setBusy(true);
    try {
      const r = await action();
      if (r.ok && r.target) onUpdated(r.target);
      else if (!r.ok) toast.error('操作失败', { description: r.error });
    } finally {
      setBusy(false);
    }
  };

  const handleCopyToCustom = () =>
    applyResult(async () => {
      const r = await client.copyExtensionToCustom();
      if (r.ok) {
        toast.success('已复制到自定义区', {
          description: '浏览器需在扩展管理页移除旧目录，再对自定义副本重新「加载已解压的扩展程序」，之后改副本即可自定义扩展',
        });
      }
      return r;
    });

  const handleOverwrite = async () => {
    const ok = await showConfirm('更新自定义副本', '将用当前内置版整体覆盖自定义副本，副本上的修改会丢失。');
    if (!ok) return;
    applyResult(async () => {
      const r = await client.copyExtensionToCustom();
      if (r.ok) toast.success('已更新为当前内置版', { description: '请在浏览器扩展管理页点击「重新加载」生效' });
      return r;
    });
  };

  const handleReset = async () => {
    const ok = await showConfirm('恢复默认扩展', '将删除自定义副本（含你的修改），浏览器加载回内置目录，自定义修改不可找回。');
    if (!ok) return;
    applyResult(async () => {
      const r = await client.resetExtensionCustom();
      if (r.ok) {
        toast.success('已恢复默认', {
          description: '浏览器需在扩展管理页移除自定义副本，再对内置目录重新「加载已解压的扩展程序」',
        });
      }
      return r;
    });
  };

  return (
    <div className="space-y-1.5">
      {target.source === 'custom' && target.outdated && (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          内置扩展已更新，自定义副本版本落后；可恢复默认后重新复制，或用内置版覆盖副本
        </p>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        {target.source === 'builtin' ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void handleCopyToCustom()}>
            <Download /> 复制到自定义
          </Button>
        ) : (
          <>
            {target.outdated && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void handleOverwrite()}>
                <Download /> 用内置版覆盖副本
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void handleReset()}>
              <RotateCcw /> 恢复默认
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function ExtensionInstallGuide({
  target,
  isMac,
  onTargetUpdated,
}: {
  target: ExtensionTarget | null | undefined;
  isMac: boolean;
  onTargetUpdated: (t: ExtensionTarget) => void;
}) {
  const dirPath = target === undefined ? undefined : target.path;

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
        <>
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
          {target && <ExtensionCustomBar target={target} onUpdated={onTargetUpdated} />}
        </>
      )}
      <p className="text-xs text-muted-foreground">
        应用更新后扩展文件会随之更新，需重启浏览器后在扩展管理页重新加载。
        自定义副本随「自定义资源」在设备间同步，内置目录不会同步。
        {isMac ? ' macOS 需先点下方「注册到浏览器」完成 NM host 注册，再进行上述安装。' : ''}
      </p>
    </div>
  );
}

export function ExtensionStatusLine() {
  const [status, setStatus] = useState<ExtensionStatus | null>(null);
  const [target, setTarget] = useState<ExtensionTarget | null | undefined>(undefined);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    let cancelled = false;
    client.getExtensionStatus().then((s) => {
      if (!cancelled) setStatus(s);
    });
    client.getExtensionDirPath().then((t) => {
      if (!cancelled) setTarget(t);
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
    return <ExtensionInstallGuide target={target} isMac={isMac} onTargetUpdated={setTarget} />;
  }

  const tabLabel = status.title || status.url;
  return (
    <div className="space-y-1.5">
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
      {target?.source === 'custom' && (
        <div className="space-y-1.5 rounded-lg bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">
            当前加载自定义副本：<span className="font-mono">{target.path}</span>
          </p>
          <ExtensionCustomBar target={target} onUpdated={setTarget} />
        </div>
      )}
    </div>
  );
}
