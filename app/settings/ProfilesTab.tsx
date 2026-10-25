/**
 * 设置页「模型方案」Tab：左列方案列表 / 右栏选中方案表单
 */
import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useConfirmStore } from '@/stores/confirm-store';
import type { AppSettings, ModelProfile } from '@/types/settings';
import { isProfileComplete } from '@/types/settings';
import { ProfileForm } from './ProfileForm';
import type { SettingsSearchEntry } from './search-index';

export const PROFILES_SEARCH_ENTRIES: SettingsSearchEntry[] = [
  { label: '模型方案', description: 'API 供应商配置：名称/API Key/Base URL/上游协议', keywords: ['profile', '供应商'] },
  { label: '模型清单', description: '方案内可用模型 ID、上下文窗口与执行力度' },
  { label: '拉取上游模型', description: '探测兼容端点模型列表并合并入清单' },
  { label: 'API 超时时间', description: '方案请求超时毫秒数' },
  { label: '自动压缩阈值', description: '上下文占用达到阈值后自动压缩会话' },
];

interface ProfilesTabProps {
  local: AppSettings;
  setLocal: Dispatch<SetStateAction<AppSettings>>;
}

export function ProfilesTab({ local, setLocal }: ProfilesTabProps) {
  const confirmDialog = useConfirmStore((s) => s.confirm);
  const [selectedId, setSelectedId] = useState<string>('default');

  const profileIds = Object.keys(local.profiles);

  // 首次挂载选中第一个方案；选中项被删除后回退到第一个
  const initializedRef = useRef(false);
  useEffect(() => {
    if (profileIds.length === 0) return;
    if (!initializedRef.current || !profileIds.includes(selectedId)) {
      initializedRef.current = true;
      setSelectedId(profileIds[0]);
    }
  }, [profileIds, selectedId]);

  const addNewProfile = () => {
    const id = crypto.randomUUID();
    const newProfile: ModelProfile = {
      id, name: '新方案', apiKey: '', baseUrl: '',
      apiTimeoutMs: 3000000, piWireApi: 'anthropic-messages',
    };
    setLocal(prev => ({
      ...prev,
      profiles: { ...prev.profiles, [id]: newProfile },
    }));
    setSelectedId(id);
  };

  const updateProfileField = (profileId: string, updates: Partial<ModelProfile>) => {
    setLocal(prev => ({
      ...prev,
      profiles: {
        ...prev.profiles,
        [profileId]: { ...prev.profiles[profileId], ...updates },
      },
    }));
  };

  const deleteProfileById = async (profileId: string) => {
    if (profileId === 'default') return;
    const name = local.profiles[profileId]?.name ?? profileId;
    const result = await confirmDialog({
      title: '删除模型方案',
      description: `「${name}」将立即删除且无法恢复，确定继续？`,
      buttons: [
        { label: '取消', value: 'cancel', variant: 'outline' },
        { label: '删除', value: 'delete', variant: 'destructive' },
      ],
    });
    if (result !== 'delete') return;
    setLocal(prev => {
      const { [profileId]: _removed, ...rest } = prev.profiles;
      const newAi = { ...prev.ai };
      const clearIfMatch = (key: 'defaultModelSelection' | 'parseModelSelection' | 'visionModelSelection') => {
        if (newAi[key]?.profileId === profileId) newAi[key] = null;
      };
      clearIfMatch('defaultModelSelection');
      clearIfMatch('parseModelSelection');
      clearIfMatch('visionModelSelection');
      return { ...prev, profiles: rest, ai: newAi };
    });
    setSelectedId('default');
  };

  const selectedProfile = local.profiles[selectedId];

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-6 pb-4 shrink-0">
        <h2 className="text-lg font-semibold mb-1">模型方案</h2>
        <p className="text-sm text-muted-foreground">管理 API 服务配置，多个方案随时切换</p>
      </div>

      <div className="flex-1 min-h-0 flex items-stretch">
        <nav aria-label="方案列表" className="w-[220px] shrink-0 border-r border-border/40">
          <div className="py-3 pr-3 flex flex-col gap-0.5">
            {profileIds.map(id => {
              const profile = local.profiles[id];
              const selected = id === selectedId;
              return (
                <button
                  key={id}
                  type="button"
                  className={cn(
                    'flex items-center gap-2 text-left text-sm px-3 py-1.5 rounded-md transition-colors',
                    selected
                      ? 'bg-primary/10 text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                  onClick={() => setSelectedId(id)}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'w-[7px] h-[7px] rounded-full shrink-0',
                      isProfileComplete(profile) ? 'bg-emerald-500' : 'bg-red-500',
                    )}
                  />
                  <span className="truncate">{profile.name}</span>
                </button>
              );
            })}
            <Button variant="outline" size="sm" className="mt-2 justify-start" onClick={addNewProfile}>
              <Plus className="w-4 h-4 mr-1" />
              新增方案
            </Button>
          </div>
        </nav>

        <div className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-[820px] pl-6 pr-6 pb-6">
          {selectedProfile && (
            <ProfileForm
              key={selectedProfile.id}
              profile={selectedProfile}
              isDefault={selectedId === 'default'}
              onUpdate={(updates) => updateProfileField(selectedId, updates)}
              onDelete={() => void deleteProfileById(selectedId)}
            />
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
