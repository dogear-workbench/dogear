/**
 * 设置页壳：加载 / 脏检查 / 防抖自动保存 / Tab 骨架
 */
import { useEffect, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { useSettingsStore } from '@/stores/settings-store';
import { useUIStore } from '@/stores/ui-store';
import type { AppSettings } from '@/types/settings';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { WorkspaceManagementTab } from './WorkspaceManagementTab';
import { AbilityTab } from './AbilityTab';
import { SceneTab } from './scene/SceneTab';
import { SubAgentTab } from './SubAgentTab';
import { ShortcutsTab } from './ShortcutsTab';
import { AboutTab } from './AboutTab';
import { BehaviorTab } from './BehaviorTab';
import { ProfilesTab } from './ProfilesTab';

// 与 electron/main/services/settings-diff.ts 的 deepEqual 为同源双副本（主/渲染 tsconfig 隔离，不可共享），改动需两侧同步
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;

  return keysA.every(key => deepEqual(objA[key], objB[key]));
}

const AUTOSAVE_DELAY_MS = 500;

export default function SettingsPage() {
  const savedSettings = useSettingsStore((s) => s.settings);
  const loaded = useSettingsStore((s) => s.loaded);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const saveToStore = useSettingsStore((s) => s.saveSettings);
  const closeSettings = useUIStore((s) => s.closeSettings);

  const [activeTab, setActiveTab] = useState('behavior');

  // 本地副本（受控输入即时回显），防抖落盘全量设置
  const [local, setLocal] = useState<AppSettings>(DEFAULT_SETTINGS);

  const savedSnapshotRef = useRef<AppSettings | null>(null);
  const localRef = useRef(local);
  localRef.current = local;

  // 加载设置
  useEffect(() => { loadSettings(); }, [loadSettings]);

  // 外部设置更新时同步到本地；仅当本地无未落盘改动时接受，
  // 防止防抖写入完成触发的同步吃掉用户在防抖窗口内的新输入
  useEffect(() => {
    if (!loaded) return;
    setLocal((prev) => {
      const base = savedSnapshotRef.current ?? DEFAULT_SETTINGS;
      return deepEqual(prev, base) ? structuredClone(savedSettings) : prev;
    });
    savedSnapshotRef.current = savedSettings;
  }, [loaded, savedSettings]);

  // 全实时保存：local 变化后防抖落盘
  useEffect(() => {
    if (!loaded) return;
    if (deepEqual(local, savedSettings)) return;
    const t = setTimeout(() => {
      saveToStore(local).catch((e: unknown) => {
        toast.error('设置保存失败，修改仍在页面上，可重试或反馈', { description: String(e) });
      });
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [loaded, local, savedSettings, saveToStore]);

  // 关闭设置页时组件卸载：有未落盘改动则立即写入，避免丢最后一次编辑
  useEffect(() => {
    return () => {
      const pending = localRef.current;
      const store = useSettingsStore.getState();
      if (store.loaded && !deepEqual(pending, store.settings)) {
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
      {/* ── 顶部固定栏：设置已全实时保存，返回即退出 ── */}
      <header className="h-12 border-b flex items-center px-4 gap-3 bg-background flex-shrink-0">
        <Button variant="ghost" size="sm" onClick={closeSettings}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="font-semibold flex-1">设置</h1>
      </header>

      {/* ── 主体：顶部下划线 Tabs ── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList variant="underline" className="justify-start px-6 flex-shrink-0">
          <TabsTrigger variant="underline" value="behavior">基础设置</TabsTrigger>
          <TabsTrigger variant="underline" value="abilities">能力</TabsTrigger>
          <TabsTrigger variant="underline" value="scene">场景</TabsTrigger>
          <TabsTrigger variant="underline" value="profiles">模型方案</TabsTrigger>
          <TabsTrigger variant="underline" value="workspace-management">工作区管理</TabsTrigger>
          <TabsTrigger variant="underline" value="sub-agent">子会话派遣</TabsTrigger>
          <TabsTrigger variant="underline" value="shortcuts">快捷键</TabsTrigger>
          <TabsTrigger variant="underline" value="about">关于</TabsTrigger>
        </TabsList>

        {/* ── Tab: 基础设置 ── */}
        <TabsContent value="behavior" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <BehaviorTab local={local} setLocal={setLocal} />
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
        <TabsContent value="profiles" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <ProfilesTab local={local} setLocal={setLocal} />
        </TabsContent>

        {/* ── Tab: 工作区管理 ── */}
        <TabsContent value="workspace-management" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <WorkspaceManagementTab />
        </TabsContent>

        {/* ── Tab: 子会话派遣 ── */}
        <TabsContent value="sub-agent" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
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
      </Tabs>
    </div>
  );
}
