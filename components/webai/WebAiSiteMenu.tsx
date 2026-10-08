import { Check, ChevronDown, Globe } from 'lucide-react';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings-store';
import { useSessionStore, WEB_AI_TAB_ID } from '@/stores/session-store';
import { DEFAULT_WEB_AI_SITES, type WebAiSite } from '@/types/settings';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function resolveWebAiSites(webAiSites: WebAiSite[] | undefined): WebAiSite[] {
  return webAiSites && webAiSites.length > 0 ? webAiSites : DEFAULT_WEB_AI_SITES;
}

/** 选中站点归一化：id 不在列表（含 null）时落第一项，过期 id 无需主动清理 */
export function resolveSelectedSite(sites: WebAiSite[], selectedId: string | null): WebAiSite {
  return sites.find((s) => s.id === selectedId) ?? sites[0];
}

/**
 * 网页 AI tab 项内容：Globe 图标 + 小箭头弹站点菜单，站点名收进菜单（tab 图标化省宽）。
 * 点图标冒泡到外层 tab 项照常激活；点箭头只弹菜单，选中后写 store + 导航 + 切到网页 AI tab。
 */
export function WebAiSiteMenu() {
  const sites = resolveWebAiSites(useSettingsStore((s) => s.settings.webAiSites));
  const selectedSiteId = useSessionStore((s) => s.webAiSelectedSiteId);
  const setWebAiSelectedSiteId = useSessionStore((s) => s.setWebAiSelectedSiteId);
  const switchTab = useSessionStore((s) => s.switchTab);
  const current = resolveSelectedSite(sites, selectedSiteId);

  const handleSelect = (site: WebAiSite) => {
    setWebAiSelectedSiteId(site.id);
    switchTab(WEB_AI_TAB_ID);
    client.openWebAiSite({ url: site.url }).catch((err) => console.error('切换网页 AI 站点失败:', err));
  };

  return (
    <>
      <Globe className="w-3.5 h-3.5 shrink-0" />
      <DropdownMenu>
        <DropdownMenuTrigger
          title="切换站点"
          onClick={(e) => e.stopPropagation()}
          className="ml-0.5 p-0.5 rounded hover:bg-muted shrink-0 cursor-pointer outline-none"
        >
          <ChevronDown className="w-3 h-3 transition-transform data-[state=open]:rotate-180" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {sites.map((site) => (
            <DropdownMenuItem key={site.id} title={site.url} onClick={() => handleSelect(site)}>
              <Check
                className={cn(
                  'w-3.5 h-3.5 text-foreground',
                  current.id === site.id ? 'opacity-100' : 'opacity-0',
                )}
              />
              {site.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
