import { useEffect, useState, type CSSProperties } from 'react';
import { PanelRightClose, PanelRightOpen, PictureInPicture2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { client } from '@/lib/client';
import { NotificationCenter } from '@/components/NotificationCenter';
import { TopBarSearch } from '@/components/TopBarSearch';
import { TopBarStatusBadge } from '@/components/TopBarStatusBadge';
import { useUIStore } from '@/stores/ui-store';

export function TopBar() {
  const workbenchWindowOpen = useUIStore((s) => s.workbenchWindowOpen);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add('has-topbar');
    return () => document.documentElement.classList.remove('has-topbar');
  }, []);

  useEffect(() => {
    client.getPlatform()
      .then((platform) => setIsMac(platform === 'darwin'))
      .catch(() => {});
  }, []);

  return (
    <div
      className="relative z-40 h-9 flex-none flex items-center border-b bg-sidebar"
      style={{
        // WCO 条由 #root padding-top 让位，负 margin 把通栏顶栏拉进条内，两平台内容区都自然从顶栏下方开始
        marginTop: 'calc(env(titlebar-area-height, 0px) * -1)',
        paddingLeft: isMac ? 80 : 8,
        paddingRight: 'calc(100% - env(titlebar-area-width, 100%) + 8px)',
        WebkitAppRegion: 'drag',
      } as CSSProperties}
    >
      <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
        <NotificationCenter />
        <TopBarStatusBadge />
      </div>
      {/* 搜索框相对窗口几何绝对居中，不受左右窗控让位 padding 影响 */}
      <TopBarSearch />
      <div className="ml-auto flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
        <Button
          variant={workbenchWindowOpen ? 'default' : 'ghost'}
          size="sm"
          className="h-7 px-2.5"
          onClick={() => {
            client.openWorkbenchWindow().catch((err) => console.error('打开工作台失败:', err));
          }}
          title={workbenchWindowOpen ? '聚焦工作台窗口' : '打开工作台窗口'}
        >
          <PictureInPicture2 className="w-3.5 h-3.5 mr-1.5" />
          工作台
        </Button>
        {!workbenchWindowOpen && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={toggleRightPanel}
            title={rightPanelOpen ? '折叠右侧面板' : '展开右侧面板'}
          >
            {rightPanelOpen ? (
              <PanelRightClose className="w-3.5 h-3.5" />
            ) : (
              <PanelRightOpen className="w-3.5 h-3.5" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
