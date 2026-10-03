import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import type { AppSettings } from '@/types/settings';

interface PaymentBlockedHostsSectionProps {
  local: AppSettings;
  setLocal: Dispatch<SetStateAction<AppSettings>>;
}

const inputCls = 'h-9 w-full px-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring';

const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

function normalizeInput(raw: string): string {
  let host = raw.trim().toLowerCase();
  if (host.startsWith('*.')) host = host.slice(2);
  return host;
}

export function PaymentBlockedHostsSection({ local, setLocal }: PaymentBlockedHostsSectionProps) {
  const [builtinHosts, setBuiltinHosts] = useState<string[]>([]);
  const [input, setInput] = useState('');

  useEffect(() => {
    let cancelled = false;
    client.getBrowserActionPolicy().then((p) => {
      if (!cancelled) setBuiltinHosts(p.builtinPaymentBlockedHosts);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const userHosts = local.paymentBlockedHosts ?? [];

  const addHost = () => {
    const host = normalizeInput(input);
    if (!HOST_PATTERN.test(host)) {
      toast.error('域名格式不正确', { description: '请输入形如 example.com 的域名，无需协议与路径' });
      return;
    }
    if (userHosts.includes(host)) {
      toast.error('该域名已在自定义列表中');
      return;
    }
    if (builtinHosts.includes(host)) {
      toast.error('该域名已在内置黑名单中');
      return;
    }
    setLocal((prev) => ({ ...prev, paymentBlockedHosts: [...(prev.paymentBlockedHosts ?? []), host] }));
    setInput('');
  };

  const removeHost = (host: string) => {
    setLocal((prev) => ({
      ...prev,
      paymentBlockedHosts: (prev.paymentBlockedHosts ?? []).filter((h) => h !== host),
    }));
  };

  return (
    <div className="space-y-3">
      <label className="text-sm font-medium">支付与网银黑名单</label>
      <p className="text-xs text-muted-foreground">
        命中黑名单域名的页面禁止 Agent 操作（确认也不放行）。内置名单只读，可追加自定义域名；
        输入 example.com 会同时拦截其所有子域名。
      </p>
      <div className="space-y-4 rounded-lg border p-4">
        <div className="space-y-1.5">
          <p className="text-sm font-medium">内置默认（{builtinHosts.length} 个，只读）</p>
          <div className="flex flex-wrap gap-1.5">
            {builtinHosts.map((host) => (
              <span key={host} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                {host}
              </span>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">自定义追加</p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              className={inputCls}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addHost();
                }
              }}
              placeholder="example.com"
            />
            <Button variant="outline" size="sm" onClick={addHost}>
              <Plus className="w-4 h-4 mr-1" />
              添加
            </Button>
          </div>
          {userHosts.length === 0 ? (
            <p className="text-xs text-muted-foreground">暂无自定义域名</p>
          ) : (
            <div className="space-y-1.5 pt-1">
              {userHosts.map((host) => (
                <div key={host} className="flex items-center justify-between rounded-md border px-2.5 py-1.5">
                  <span className="font-mono text-sm">{host}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    title="删除此域名"
                    onClick={() => removeHost(host)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
