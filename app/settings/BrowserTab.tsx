/**
 * 设置页「浏览器」Tab：联网搜索、浏览器扩展与网页拦截
 */
import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import type { AppSettings } from '@/types/settings';
import type { SettingsSearchEntry } from './search-index';
import { ExtensionActionPolicyNote, ExtensionStatusLine } from './ExtensionStatusLine';
import { PaymentBlockedHostsSection } from './PaymentBlockedHostsSection';
import { TaskBrowserSection } from './TaskBrowserSection';

export const BROWSER_SEARCH_ENTRIES: SettingsSearchEntry[] = [
  { label: '搜索引擎', description: '联网搜索使用的引擎，失败自动降级', keywords: ['search', 'auto', 'google', 'bing'] },
  { label: '代理地址', description: 'Google / DuckDuckGo 走代理，其余直连；留空只用 Bing', keywords: ['proxy'] },
  { label: '浏览器扩展', description: '连接后可读取浏览器当前标签页的标题、网址与正文预览' },
  { label: '任务浏览器', description: '扩展通道不可用时自动拉起的浏览器与账户' },
  { label: '联网搜索 API Key', description: '联网搜索工具包的 Key，在智谱套餐页创建', keywords: ['glm', 'bigmodel', '智谱'] },
  { label: '支付与网银黑名单', description: '禁止 Agent 访问的支付网银域名列表' },
];

const inputCls = "h-9 w-full px-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring";

interface BrowserTabProps {
  local: AppSettings;
  setLocal: Dispatch<SetStateAction<AppSettings>>;
}

export function BrowserTab({ local, setLocal }: BrowserTabProps) {
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    let cancelled = false;
    client.getPlatform().then((p) => {
      if (!cancelled) setIsMac(p === 'darwin');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRegisterNmHost = async () => {
    try {
      const res = await client.registerNmHost();
      const failed = res.results.filter((r) => !r.ok);
      if (failed.length > 0) {
        toast.error('部分浏览器注册失败', {
          description: failed.map((f) => `${f.browser}：${f.error}`).join('；'),
        });
        return;
      }
      toast.success(`已注册到 ${res.results.map((r) => r.browser).join('、')}`, {
        description: '在浏览器扩展管理页重新加载 Dogear 扩展即可连接',
      });
    } catch (err) {
      toast.error('注册失败', { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleUnregisterNmHost = async () => {
    try {
      const res = await client.unregisterNmHost();
      const failed = res.filter((r) => !r.ok);
      if (failed.length > 0) {
        toast.error('部分浏览器注销失败', {
          description: failed.map((f) => `${f.browser}：${f.error}`).join('；'),
        });
        return;
      }
      toast.success('已从所有浏览器注销');
    } catch (err) {
      toast.error('注销失败', { description: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-6 px-6">
      <h2 className="text-lg font-semibold mb-1">浏览器</h2>
      <p className="text-sm text-muted-foreground mb-6">联网搜索、浏览器扩展与网页拦截</p>
      <div className="space-y-6">
        {/* 搜索 */}
        <div className="space-y-3">
          <label className="text-sm font-medium">搜索</label>
          <div className="space-y-4 rounded-lg border p-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">搜索引擎</label>
              <p className="text-xs text-muted-foreground">代理可用时首选 Google，失败自动降级。</p>
              <select
                className="h-9 w-full px-3 text-sm border rounded bg-background"
                value={local.browserSearchEngine}
                onChange={(e) => setLocal(prev => ({
                  ...prev,
                  browserSearchEngine: e.target.value as AppSettings['browserSearchEngine'],
                }))}
              >
                <option value="auto">自动</option>
                <option value="google">Google</option>
                <option value="bing">Bing</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">代理地址</label>
              <p className="text-xs text-muted-foreground">
                Google / DuckDuckGo 走代理，其余直连；留空只用 Bing。
              </p>
              <input
                type="text"
                className={inputCls}
                value={local.browserProxyServer ?? ''}
                onChange={(e) => setLocal(prev => ({ ...prev, browserProxyServer: e.target.value }))}
                placeholder="127.0.0.1:7890"
              />
            </div>
          </div>
        </div>

        {/* 扩展 */}
        <div className="space-y-3">
          <label className="text-sm font-medium">扩展</label>
          <p className="text-xs text-muted-foreground">连接后可读取当前标签页标题、网址与正文预览。</p>
          <div className="space-y-2 rounded-lg border p-4">
            <ExtensionStatusLine />
            <ExtensionActionPolicyNote />
            {isMac && (
              <div className="flex items-center gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={handleRegisterNmHost}>
                  注册到浏览器
                </Button>
                <Button size="sm" variant="outline" onClick={handleUnregisterNmHost}>
                  注销
                </Button>
                <span className="text-xs text-muted-foreground">
                  写入 Chrome / Edge 的 NativeMessagingHosts 清单（换目录安装后请重新注册）
                </span>
              </div>
            )}
          </div>
        </div>

        <TaskBrowserSection local={local} setLocal={setLocal} />

        {/* 联网搜索 */}
        <div className="space-y-3">
          <label className="text-sm font-medium">联网搜索</label>
          <div className="space-y-1.5 rounded-lg border p-4">
            <label className="text-sm font-medium">API Key（GLM Coding Plan）</label>
            <p className="text-xs text-muted-foreground">联网搜索工具的 Key，在智谱套餐页创建。</p>
            <input
              type="password"
              className={inputCls}
              value={local.webMcpApiKey ?? ''}
              onChange={(e) => setLocal(prev => ({ ...prev, webMcpApiKey: e.target.value }))}
              placeholder="API Key"
              autoComplete="off"
            />
          </div>
        </div>

        <PaymentBlockedHostsSection local={local} setLocal={setLocal} />
      </div>
    </div>
  );
}
