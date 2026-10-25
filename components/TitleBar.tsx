import type { CSSProperties } from 'react';

interface TitleBarProps {
  title?: string;
}

// 无 TopBar 窗口面（数据中心独立窗口、主窗口无工作区兑底态）的顶部拖拽条：整条即拖拽区
// （app-region 元素不能 pointer-events-none，不参与命中即失去拖拽）。主窗口常规布局不用本组件——拖拽由 TopBar 内部分区承担
export function TitleBar({ title }: TitleBarProps) {
  return (
    <div
      className="fixed top-0 left-0 right-0 z-40 flex items-center pl-4"
      style={{
        height: 'env(titlebar-area-height, 36px)',
        paddingRight: 'calc(100% - env(titlebar-area-width, 100%) + 8px)',
        WebkitAppRegion: 'drag',
      } as CSSProperties}
    >
      {title && <span className="text-xs font-medium text-muted-foreground truncate">{title}</span>}
    </div>
  );
}
