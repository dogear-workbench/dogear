import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import { toast } from 'sonner';
import { Download, RefreshCw, CheckCircle2, Loader2, Save } from 'lucide-react';

interface UpdateInfo {
  version: string;
  type: 'hotfix' | 'full';
  pubDate?: string;
  hotfix?: { url: string; size?: number; sha256: string };
  full?: { url: string };
}

interface CheckResult {
  hasUpdate: boolean;
  type?: 'hotfix' | 'full';
  info?: UpdateInfo;
  error?: string;
}

export function AboutTab() {
  const [version, setVersion] = useState('');
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<{ percent: number; transferred: number; total: number } | null>(null);
  const [reloading, setReloading] = useState(false);
  const [serverUrl, setServerUrl] = useState('http://localhost:9527');
  const [savingUrl, setSavingUrl] = useState(false);

  useEffect(() => {
    client.getAppVersion().then(({ version }) => setVersion(version));
    client.getUpdateConfig().then(({ serverUrl }) => {
      if (serverUrl) setServerUrl(serverUrl);
    });
  }, []);

  useEffect(() => {
    const unsub = rendererEvents.updateProgress.listen((data) => {
      setProgress(data);
    });
    return () => unsub();
  }, []);

  const handleCheck = useCallback(async () => {
    setChecking(true);
    setCheckResult(null);
    try {
      const result = await client.checkForUpdates();
      setCheckResult(result);
      if (result.error) {
        toast.error('检查更新失败', { description: result.error });
      } else if (!result.hasUpdate) {
        toast.success('已是最新版本');
      }
    } catch (err) {
      toast.error('检查更新失败', { description: String(err) });
    } finally {
      setChecking(false);
    }
  }, []);

  const handleApplyHotfix = useCallback(async () => {
    if (!checkResult?.info?.hotfix) return;
    setDownloading(true);
    setProgress({ percent: 0, transferred: 0, total: 0 });
    try {
      const { success, error } = await client.downloadAndApplyHotfix({
        url: checkResult.info.hotfix.url,
        sha256: checkResult.info.hotfix.sha256,
      });
      if (success) {
        setReloading(true);
        toast.success('更新完成，正在刷新...');
        setTimeout(() => window.location.reload(), 1500);
      } else {
        toast.error('热更新失败', { description: error });
        setDownloading(false);
        setProgress(null);
      }
    } catch (err) {
      toast.error('热更新失败', { description: String(err) });
      setDownloading(false);
      setProgress(null);
    }
  }, [checkResult]);

  const handleDownloadFull = useCallback(async () => {
    if (!checkResult?.info?.full) return;
    setDownloading(true);
    setProgress({ percent: 0, transferred: 0, total: 0 });
    try {
      const { success, error } = await client.downloadAndRunFullUpdate({
        url: checkResult.info.full.url,
      });
      if (success) {
        toast.success('下载完成，安装程序已启动');
      } else {
        toast.error('下载安装包失败', { description: error });
      }
    } catch (err) {
      toast.error('下载安装包失败', { description: String(err) });
    } finally {
      setDownloading(false);
      setProgress(null);
    }
  }, [checkResult]);

  const handleSaveServerUrl = useCallback(async () => {
    setSavingUrl(true);
    try {
      const { success, error } = await client.setUpdateConfig({ serverUrl });
      if (success) {
        toast.success('更新服务地址已保存');
      } else {
        toast.error('保存失败', { description: error });
      }
    } finally {
      setSavingUrl(false);
    }
  }, [serverUrl]);

  const busy = checking || downloading || reloading;

  return (
    <div className="max-w-2xl py-6 px-6">
      <h2 className="text-lg font-semibold mb-1">关于</h2>
      <p className="text-sm text-muted-foreground mb-6">版本信息与更新检查</p>

      <div className="space-y-8">
        {/* 版本信息 + 检查更新 */}
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">当前版本</span>
            <span className="text-sm font-mono font-medium">{version || '加载中...'}</span>
          </div>

          <Button onClick={handleCheck} disabled={busy} variant="outline" size="sm">
            {checking ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                检查中...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                检查更新
              </>
            )}
          </Button>

          {/* 检查结果 */}
          {checkResult && !checkResult.error && !checkResult.hasUpdate && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              已是最新版本
            </div>
          )}

          {checkResult?.hasUpdate && checkResult.info && (
            <div className="p-4 rounded-lg border bg-muted/30 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">发现新版本</span>
                <span className="text-sm font-mono">{checkResult.info.version}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                  {checkResult.type === 'hotfix' ? '热更新' : '全量更新'}
                </span>
              </div>

              {checkResult.info.pubDate && (
                <p className="text-xs text-muted-foreground">
                  发布时间：{new Date(checkResult.info.pubDate).toLocaleString('zh-CN')}
                </p>
              )}

              {checkResult.type === 'hotfix' ? (
                <Button onClick={handleApplyHotfix} disabled={busy} size="sm">
                  {downloading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      下载中...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4 mr-2" />
                      下载并应用
                    </>
                  )}
                </Button>
              ) : (
                <Button onClick={handleDownloadFull} disabled={busy} size="sm">
                  {downloading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      下载中...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4 mr-2" />
                      下载安装包
                    </>
                  )}
                </Button>
              )}
            </div>
          )}

          {/* 下载进度条 */}
          {downloading && progress && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {(progress.transferred / 1024 / 1024).toFixed(1)} MB
                  {progress.total > 0 && ` / ${(progress.total / 1024 / 1024).toFixed(1)} MB`}
                </span>
                <span>{progress.percent}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          )}

          {reloading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              更新完成，正在刷新...
            </div>
          )}
        </div>

        {/* 更新服务地址 */}
        <div className="space-y-2">
          <label className="text-sm font-medium">更新服务地址</label>
          <p className="text-xs text-muted-foreground">
            用于检查更新和下载补丁的 HTTP 服务地址。
          </p>
          <div className="flex items-center gap-2">
            <Input
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://localhost:9527"
              className="flex-1"
              disabled={busy}
            />
            <Button onClick={handleSaveServerUrl} disabled={busy || savingUrl} variant="outline" size="sm">
              {savingUrl ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Save className="w-4 h-4 mr-1" />
                  保存
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
