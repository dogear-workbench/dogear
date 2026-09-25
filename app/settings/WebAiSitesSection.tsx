import type { Dispatch, SetStateAction } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AppSettings, WebAiSite } from '@/types/settings';
import { DEFAULT_WEB_AI_SITES } from '@/types/settings';

interface WebAiSitesSectionProps {
  local: AppSettings;
  setLocal: Dispatch<SetStateAction<AppSettings>>;
}

const inputCls = 'h-9 w-full px-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring';

function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function WebAiSitesSection({ local, setLocal }: WebAiSitesSectionProps) {
  const sites = local.webAiSites ?? DEFAULT_WEB_AI_SITES;

  const updateSites = (next: WebAiSite[]) => {
    setLocal((prev) => ({ ...prev, webAiSites: next }));
  };

  const updateSite = (id: string, patch: Partial<WebAiSite>) => {
    updateSites(sites.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const addSite = () => {
    updateSites([...sites, { id: crypto.randomUUID(), name: '新站点', url: '' }]);
  };

  const removeSite = (id: string) => {
    if (sites.length <= 1) return;
    updateSites(sites.filter((s) => s.id !== id));
  };

  return (
    <div className="space-y-3">
      <label className="text-sm font-medium">网页 AI 站点</label>
      <p className="text-xs text-muted-foreground">
        「网页 AI」标签页顶部切换器的站点列表，至少保留一条；删除当前打开的站点时，网页 AI 会自动切到列表第一项。
      </p>
      <div className="space-y-2 rounded-lg border p-4">
        {sites.map((site) => {
          const urlInvalid = !isValidHttpUrl(site.url.trim());
          return (
            <div key={site.id} className="flex items-start gap-2">
              <input
                type="text"
                className={cn(inputCls, 'w-32 shrink-0')}
                value={site.name}
                onChange={(e) => updateSite(site.id, { name: e.target.value })}
                placeholder="名称"
              />
              <div className="flex-1 min-w-0 space-y-1">
                <input
                  type="text"
                  className={cn(inputCls, urlInvalid && 'border-destructive focus:ring-destructive')}
                  value={site.url}
                  onChange={(e) => updateSite(site.id, { url: e.target.value })}
                  placeholder="https://example.com"
                />
                {urlInvalid && <p className="text-xs text-destructive">URL 需以 http:// 或 https:// 开头</p>}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                disabled={sites.length <= 1}
                title={sites.length <= 1 ? '至少保留一个站点' : '删除此站点'}
                onClick={() => removeSite(site.id)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          );
        })}
        <Button variant="outline" size="sm" onClick={addSite}>
          <Plus className="w-4 h-4 mr-1" />
          添加站点
        </Button>
      </div>
    </div>
  );
}
