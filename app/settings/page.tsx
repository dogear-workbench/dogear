/**
 * 设置页壳：加载 / 脏检查 / 防抖自动保存 / Tab 骨架
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { useSettingsStore } from '@/stores/settings-store';
import type { AppSettings } from '@/types/settings';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { SettingsSearchProvider } from './SettingsSearchProvider';
import { WorkspaceManagementTab } from './WorkspaceManagementTab';
import { AbilityTab } from './AbilityTab';
import { SceneTab } from './scene/SceneTab';
import { SubAgentTab } from './SubAgentTab';
import { ShortcutsTab } from './ShortcutsTab';
import { AboutTab } from './AboutTab';
import { BehaviorTab } from './BehaviorTab';
import { BrowserTab } from './BrowserTab';
import { ProfilesTab } from './ProfilesTab';

const AUTOSAVE_DELAY_MS = 500;

// 顶部横向导航项：覆盖 underline trigger 的收紧间距态（active 下划线沿用 variant 自带 border-primary）
const NAV_TRIGGER_CLS = 'px-3.5 py-2.5 text-sm rounded-t-md hover:bg-muted/50 data-[state=active]:font-semibold';

export default function SettingsPage() {
  const savedSettings = useSettingsStore((s) => s.settings);
  const loaded = useSettingsStore((s) => s.loaded);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const saveToStore = useSettingsStore((s) => s.saveSettings);

  const [activeTab, setActiveTab] = useState('behavior');
  const subTabFocusReq = useSettingsStore((s) => s.subTabFocusReq);
  const consumeSubTabFocus = useSettingsStore((s) => s.consumeSubTabFocus);

  // 外部跳转请求（顶栏设置项搜索命中）：切到目标子 tab
  useEffect(() => {
    if (!subTabFocusReq) return;
    setActiveTab(subTabFocusReq.tabId);
    consumeSubTabFocus();
  }, [subTabFocusReq, consumeSubTabFocus]);

  // 本地副本（受控输入即时回显），防抖落盘全量设置。
  // 未落盘改动用显式 dirty 标志追踪（仅用户编辑置脏）：主进程 loadSettings 归一化会让回拉对象与本地副本
  // 存在内容差异，内容比较会被这种差异永久击穿（卡死在旧副本并周期性写回，覆盖其他入口的保存）
  const [local, setLocalRaw] = useState<AppSettings>(DEFAULT_SETTINGS);
  const dirtyRef = useRef(false);
  const localRef = useRef(local);
  localRef.current = local;

  const setLocal = useCallback((update: AppSettings | ((prev: AppSettings) => AppSettings)) => {
    dirtyRef.current = true;
    setLocalRaw(update);
  }, []);

  // 加载设置
  useEffect(() => { loadSettings(); }, [loadSettings]);

  // 外部设置更新时同步到本地：干净态（无未落盘编辑）无条件接受；防抖保存 in-flight 期间 dirty 仍置位，
  // 同样拒绝，保住用户在防抖窗口内的新输入
  useEffect(() => {
    if (!loaded || dirtyRef.current) return;
    setLocalRaw(structuredClone(savedSettings));
  }, [loaded, savedSettings]);

  // 全实时保存：用户编辑后防抖落盘，成功且期间无新编辑才清脏
  useEffect(() => {
    if (!loaded || !dirtyRef.current) return;
    const t = setTimeout(() => {
      const snapshot = localRef.current;
      saveToStore(snapshot)
        .then(() => {
          if (localRef.current !== snapshot) return;
          dirtyRef.current = false;
          setLocalRaw(structuredClone(useSettingsStore.getState().settings));
        })
        .catch((e: unknown) => {
          toast.error('设置保存失败，修改仍在页面上，可重试或反馈', { description: String(e) });
        });
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [loaded, local, saveToStore]);

  // 关闭设置页时组件卸载：有未落盘改动则立即写入，避免丢最后一次编辑
  useEffect(() => {
    return () => {
      if (!dirtyRef.current) return;
      const pending = localRef.current;
      const store = useSettingsStore.getState();
      if (store.loaded) {
        store.saveSettings(pending).catch((e: unknown) => {
          toast.error('设置保存失败', { description: String(e) });
        });
      }
    };
  }, []);

  // ── 加载中 ──
  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">加载设置...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <SettingsSearchProvider />
      {/* ── 主体：顶部导航 + 内容 ── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <TabsList
          variant="underline"
          aria-label="设置导航"
          className="flex w-full h-auto flex-shrink-0 justify-start gap-1 rounded-none border-b border-border px-4 overflow-x-auto"
        >
          <TabsTrigger variant="underline" value="behavior" className={NAV_TRIGGER_CLS}>基础</TabsTrigger>
          <TabsTrigger variant="underline" value="browser" className={NAV_TRIGGER_CLS}>浏览器</TabsTrigger>
          <TabsTrigger variant="underline" value="abilities" className={NAV_TRIGGER_CLS}>能力</TabsTrigger>
          <TabsTrigger variant="underline" value="scene" className={NAV_TRIGGER_CLS}>场景</TabsTrigger>
          <TabsTrigger variant="underline" value="profiles" className={NAV_TRIGGER_CLS}>模型方案</TabsTrigger>
          <TabsTrigger variant="underline" value="workspace-management" className={NAV_TRIGGER_CLS}>工作区管理</TabsTrigger>
          <TabsTrigger variant="underline" value="sub-agent" className={NAV_TRIGGER_CLS}>子会话派遣</TabsTrigger>
          <TabsTrigger variant="underline" value="shortcuts" className={NAV_TRIGGER_CLS}>快捷键</TabsTrigger>
          <TabsTrigger variant="underline" value="about" className={NAV_TRIGGER_CLS}>关于</TabsTrigger>
        </TabsList>

        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* ── Tab: 基础设置 ── */}
        <TabsContent value="behavior" className="flex-1 overflow-hidden mt-0 p-0 data-[state=inactive]:hidden">
          <BehaviorTab local={local} setLocal={setLocal} />
        </TabsContent>

        {/* ── Tab: 浏览器 ── */}
        <TabsContent value="browser" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <BrowserTab local={local} setLocal={setLocal} />
        </TabsContent>

        {/* ── Tab: 能力 ── */}
        <TabsContent value="abilities" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <AbilityTab />
        </TabsContent>

        {/* ── Tab: 场景 ── */}
        <TabsContent value="scene" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <SceneTab onGoToSubAgent={() => setActiveTab('sub-agent')} />
        </TabsContent>

        {/* ── Tab: 模型方案 ── */}
        <TabsContent value="profiles" className="flex-1 overflow-hidden mt-0 p-0 data-[state=inactive]:hidden">
          <ProfilesTab local={local} setLocal={setLocal} />
        </TabsContent>

        {/* ── Tab: 工作区管理 ── */}
        <TabsContent value="workspace-management" className="flex-1 overflow-hidden mt-0 p-0 data-[state=inactive]:hidden">
          <WorkspaceManagementTab local={local} setLocal={setLocal} />
        </TabsContent>

        {/* ── Tab: 子会话派遣 ── */}
        <TabsContent value="sub-agent" className="flex-1 overflow-hidden mt-0 p-0 data-[state=inactive]:hidden">
          <SubAgentTab local={local} setLocal={setLocal} />
        </TabsContent>

        {/* ── Tab: 快捷键 ── */}
        <TabsContent value="shortcuts" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <ShortcutsTab />
        </TabsContent>

        {/* ── Tab: 关于 ── */}
        <TabsContent value="about" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <AboutTab />
        </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
