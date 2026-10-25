/**
 * 设置页「基础」Tab：左锚点导航 + 分组
 */
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { AppSettings, EffortLevel, ModelSelection } from '@/types/settings';
import type { SettingsSearchEntry } from './search-index';
import { ModelSelector } from '@/components/ModelSelector';
import { EffortSelector } from '@/components/EffortSelector';
import { playDogearSound } from '@/lib/dogear-sound';
import { FailoverSection } from './FailoverSection';
import { Segmented, SettingRow, SettingsGroup } from './SettingsControls';
import { useAnchorSpy } from './use-anchor-spy';

export const BEHAVIOR_SEARCH_ENTRIES: SettingsSearchEntry[] = [
  { label: '默认模型', description: '新建对话使用的模型', keywords: ['model'] },
  { label: '文章解析模型', description: '文章导入解析不过关时兜底，适合配便宜档' },
  { label: '识图转派模型', description: '模型看不了图时，转给它识图' },
  { label: '模型故障转移', description: '主模型限流/欠费时自动切到备用供应商', keywords: ['failover', '限流', '备用'] },
  { label: '工具放行', description: '默认：白名单内自动放行，其余问你；自动执行：全部放行', keywords: ['权限', '工具'] },
  { label: '无人值守', description: '人不在电脑前时自动处理确认与介入，事件推飞书', keywords: ['无人值守', '离开', '自动'] },
  { label: '消息显示', description: '工具与思考过程默认收起还是展开' },
  { label: '主题', description: '亮色 / 暗色 / 跟随系统', keywords: ['theme', '暗色', '亮色'] },
  { label: '界面大小', description: '缩放文字与间距，对所有窗口生效' },
  { label: '提示音', description: '会话完成、等确认时播放', keywords: ['音效', '声音'] },
  { label: '仅后台时播放', description: '应用切到后台才播放提示音' },
  { label: '音量', description: '提示音音量，可试听', keywords: ['volume'] },
  { label: '需要确认时跳转焦点', description: '出现确认卡时自动切到对应窗口' },
  { label: '活跃标记', description: '近期有活动的会话亮一个小点', keywords: ['活跃'] },
  { label: '上滚时消息吸顶', description: '往上翻聊天时，你最近一条消息固定在顶部' },
];

const ANCHOR_GROUPS = [
  { id: 'basic-model', label: '模型' },
  { id: 'basic-chat', label: '对话' },
  { id: 'basic-look', label: '外观' },
  { id: 'basic-notify', label: '提示' },
  { id: 'basic-list', label: '会话列表' },
] as const;

const PERMISSION_MODE_OPTIONS = [
  { value: 'default', label: '默认' },
  { value: 'autoExecute', label: '自动执行' },
] as const;

const MESSAGE_DISPLAY_OPTIONS = [
  { value: 'compact', label: '简化' },
  { value: 'detailed', label: '详细' },
] as const;

const THEME_OPTIONS = [
  { value: 'light', label: '亮色' },
  { value: 'dark', label: '暗色' },
  { value: 'system', label: '跟随系统' },
] as const;

const FONT_SIZE_OPTIONS = [
  { value: 'small', label: '小' },
  { value: 'medium', label: '中' },
  { value: 'large', label: '大' },
] as const;

const ALIVE_WINDOW_OPTIONS = [
  { value: 'off', label: '不显示' },
  { value: '30m', label: '30 分' },
  { value: '1h', label: '1 小时' },
  { value: '4h', label: '4 小时' },
] as const;

interface ModelPickProps {
  local: AppSettings;
  value: ModelSelection | null;
  onModel: (v: ModelSelection | null) => void;
  effort?: EffortLevel | null;
  effortUnsetLabel?: string;
  effortDisabled?: boolean;
  onEffort?: (v: EffortLevel | null) => void;
}

function ModelPick({ local, value, onModel, effort, effortUnsetLabel, effortDisabled, onEffort }: ModelPickProps) {
  return (
    <div className="flex gap-2 w-[340px]">
      <div className="flex-1 min-w-0">
        <ModelSelector
          settings={local}
          value={value}
          onChange={onModel}
          allowUnset={true}
          triggerVariant="block"
        />
      </div>
      {onEffort && (
        <div className="w-[104px] shrink-0">
          <EffortSelector
            variant="block"
            value={effort ?? null}
            unsetLabel={effortUnsetLabel}
            disabled={effortDisabled}
            onChange={onEffort}
          />
        </div>
      )}
    </div>
  );
}

interface BehaviorTabProps {
  local: AppSettings;
  setLocal: Dispatch<SetStateAction<AppSettings>>;
}

export function BehaviorTab({ local, setLocal }: BehaviorTabProps) {
  const { rootRef, activeId, scrollTo } = useAnchorSpy(ANCHOR_GROUPS);

  const updateAI = (patch: Partial<AppSettings['ai']>) => {
    setLocal(prev => ({ ...prev, ai: { ...prev.ai, ...patch } }));
  };

  const updateUI = (patch: Partial<NonNullable<AppSettings['ui']>>) => {
    setLocal(prev => ({
      ...prev,
      ui: { ...(prev.ui ?? { messageDisplayMode: 'compact' }), ...patch }
    }));
  };

  const updateAppearance = (patch: Partial<NonNullable<AppSettings['appearance']>>) => {
    setLocal(prev => ({
      ...prev,
      appearance: { ...(prev.appearance ?? { theme: 'light' }), ...patch }
    }));
  };

  const updateSound = (patch: Partial<NonNullable<NonNullable<AppSettings['ui']>['sound']>>) => {
    setLocal(prev => ({
      ...prev,
      ui: {
        ...prev.ui,
        messageDisplayMode: prev.ui?.messageDisplayMode ?? 'compact',
        sound: {
          enabled: prev.ui?.sound?.enabled ?? true,
          volume: prev.ui?.sound?.volume ?? 0.25,
          backgroundOnly: prev.ui?.sound?.backgroundOnly ?? true,
          ...patch,
        },
      },
    }));
  };

  const updateInterventionFocusJump = (enabled: boolean) => {
    setLocal(prev => ({
      ...prev,
      ui: {
        ...prev.ui,
        messageDisplayMode: prev.ui?.messageDisplayMode ?? 'compact',
        interventionFocusJump: enabled,
      },
    }));
  };

  const soundOn = local.ui?.sound?.enabled ?? true;
  const volume = local.ui?.sound?.volume ?? 0.25;

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-6 pb-4 shrink-0">
        <h2 className="text-lg font-semibold mb-1">基础</h2>
        <p className="text-sm text-muted-foreground">应用全局的默认配置</p>
      </div>
      <div className="flex-1 min-h-0 flex items-stretch">
        <nav aria-label="基础设置分组" className="w-40 shrink-0 border-r border-border/40">
          <div className="py-3 pr-3 flex flex-col gap-0.5">
            {ANCHOR_GROUPS.map(g => (
              <button
                key={g.id}
                type="button"
                className={cn(
                  'text-left text-sm px-3 py-1.5 rounded-r-md border-l-2 transition-colors',
                  activeId === g.id
                    ? 'border-primary bg-primary/10 text-foreground font-medium'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
                )}
                onClick={() => scrollTo(g.id)}
              >
                {g.label}
              </button>
            ))}
          </div>
        </nav>

        <div ref={rootRef} className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-[760px] pl-6 pr-6 pb-6">
          <SettingsGroup id="basic-model" title="模型">
            <SettingRow title="默认模型" desc="新建对话使用的模型">
              <ModelPick
                local={local}
                value={local.ai.defaultModelSelection}
                onModel={(v) => updateAI({ defaultModelSelection: v })}
              />
            </SettingRow>
            <SettingRow title="文章解析模型" desc="文章导入解析不过关时兜底，适合配便宜档">
              <ModelPick
                local={local}
                value={local.ai.parseModelSelection}
                onModel={(v) => updateAI({ parseModelSelection: v })}
                effort={local.ai.parseModelSelection?.effort ?? null}
                effortUnsetLabel="跟随预设"
                effortDisabled={!local.ai.parseModelSelection}
                onEffort={(v) => {
                  const sel = local.ai.parseModelSelection;
                  if (sel) updateAI({ parseModelSelection: { ...sel, effort: v } });
                }}
              />
            </SettingRow>
            <SettingRow title="识图转派模型" desc="模型看不了图时，转给它识图">
              <ModelPick
                local={local}
                value={local.ai.visionModelSelection ?? null}
                onModel={(v) => updateAI({ visionModelSelection: v })}
                effort={local.ai.visionModelSelection?.effort ?? null}
                effortUnsetLabel="跟随预设"
                effortDisabled={!local.ai.visionModelSelection}
                onEffort={(v) => {
                  const sel = local.ai.visionModelSelection;
                  if (sel) updateAI({ visionModelSelection: { ...sel, effort: v } });
                }}
              />
            </SettingRow>
            <FailoverSection local={local} setLocal={setLocal} />
          </SettingsGroup>

          <SettingsGroup id="basic-chat" title="对话">
            <SettingRow title="工具放行" desc="默认：白名单内自动放行，其余问你；自动执行：全部放行，慎用">
              <Segmented
                value={local.ai.permissionMode}
                options={PERMISSION_MODE_OPTIONS}
                onChange={(v) => updateAI({ permissionMode: v })}
              />
            </SettingRow>
            <SettingRow title="无人值守" desc="人不在电脑前时：确认自动放行、浏览器人工介入自动跳过、断联自动重试，事件推飞书">
              <Switch
                checked={local.ai.unattended}
                onCheckedChange={(v) => updateAI({ unattended: v })}
                aria-label="无人值守"
              />
            </SettingRow>
            <SettingRow title="消息显示" desc="工具与思考过程默认收起还是展开">
              <Segmented
                value={local.ui?.messageDisplayMode ?? 'compact'}
                options={MESSAGE_DISPLAY_OPTIONS}
                onChange={(v) => updateUI({ messageDisplayMode: v })}
              />
            </SettingRow>
          </SettingsGroup>

          <SettingsGroup id="basic-look" title="外观">
            <SettingRow title="主题">
              <Segmented
                value={local.appearance?.theme ?? 'light'}
                options={THEME_OPTIONS}
                onChange={(v) => updateAppearance({ theme: v })}
              />
            </SettingRow>
            <SettingRow title="界面大小" desc="缩放文字与间距，对所有窗口生效">
              <Segmented
                value={local.ui?.fontSize ?? 'medium'}
                options={FONT_SIZE_OPTIONS}
                onChange={(v) => updateUI({ fontSize: v })}
              />
            </SettingRow>
          </SettingsGroup>

          <SettingsGroup id="basic-notify" title="提示">
            <SettingRow title="提示音" desc="会话完成、等确认时播放">
              <Switch
                checked={soundOn}
                onCheckedChange={(v) => updateSound({ enabled: v })}
                aria-label="启用提示音"
              />
            </SettingRow>
            <SettingRow title="仅后台时播放">
              <Switch
                checked={local.ui?.sound?.backgroundOnly ?? true}
                onCheckedChange={(v) => updateSound({ backgroundOnly: v })}
                aria-label="仅后台时播放提示音"
              />
            </SettingRow>
            <SettingRow title="音量">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                className="w-28 accent-primary"
                value={Math.round(volume * 100)}
                onChange={(e) => updateSound({ volume: Number(e.target.value) / 100 })}
              />
              <span className="w-9 text-xs text-muted-foreground">{Math.round(volume * 100)}%</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!soundOn}
                onClick={() => playDogearSound('complete', { force: true, volume })}
              >
                试听
              </Button>
            </SettingRow>
            <SettingRow title="需要确认时跳转焦点" desc="出现确认卡时自动切到对应窗口">
              <Switch
                checked={local.ui?.interventionFocusJump ?? true}
                onCheckedChange={updateInterventionFocusJump}
                aria-label="需要确认时跳转焦点"
              />
            </SettingRow>
          </SettingsGroup>

          <SettingsGroup id="basic-list" title="会话列表">
            <SettingRow title="活跃标记" desc="近期有活动的会话亮一个小点">
              <Segmented
                value={local.ui?.aliveWindow ?? '1h'}
                options={ALIVE_WINDOW_OPTIONS}
                onChange={(v) => updateUI({ aliveWindow: v })}
              />
            </SettingRow>
            <SettingRow title="上滚时消息吸顶" desc="往上翻聊天时，你最近一条消息固定在顶部">
              <Switch
                checked={local.ui?.stickyUserMessage ?? true}
                onCheckedChange={(v) => updateUI({ stickyUserMessage: v })}
                aria-label="上滚时消息吸顶"
              />
            </SettingRow>
          </SettingsGroup>
          </div>
        </div>
      </div>
    </div>
  );
}
