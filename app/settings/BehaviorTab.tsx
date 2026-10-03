/**
 * 设置页「基础设置」Tab
 */
import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Volume2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import type { AppSettings } from '@/types/settings';
import { ModelSelector } from '@/components/ModelSelector';
import { ExtensionActionPolicyNote, ExtensionStatusLine } from './ExtensionStatusLine';
import { PaymentBlockedHostsSection } from './PaymentBlockedHostsSection';
import { WebAiSitesSection } from './WebAiSitesSection';
import { playDogearSound } from '@/lib/dogear-sound';

const EFFORT_OPTIONS = [
  { value: null, label: '默认' },
  { value: 'off', label: '关闭' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'max', label: '最高' },
] as const;

const PERMISSION_MODE_OPTIONS = [
  { value: 'default', label: '默认', description: '已注册工具包自动放行；基础工具按映射决定；其余需确认（推荐）' },
  { value: 'autoExecute', label: '自动执行', description: '⚠️ 无条件放行所有工具调用，仅在受控环境中使用' },
] as const;

const FONT_SIZE_OPTIONS = [
  { value: 'small' as const, label: '小' },
  { value: 'medium' as const, label: '中' },
  { value: 'large' as const, label: '大' },
];

const THEME_OPTIONS = [
  { value: 'light' as const, label: '亮色', description: '柔雾浅灰底色，适合长时间阅读' },
  { value: 'dark' as const, label: '暗色', description: '墨蓝底色，适合夜间与暗光环境' },
  { value: 'system' as const, label: '跟随系统', description: '随操作系统深浅模式自动切换' },
];

const inputCls = "h-9 w-full px-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring";

interface BehaviorTabProps {
  local: AppSettings;
  setLocal: Dispatch<SetStateAction<AppSettings>>;
}

export function BehaviorTab({ local, setLocal }: BehaviorTabProps) {
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
        ...(prev.ui ?? { messageDisplayMode: 'compact' }),
        sound: {
          enabled: prev.ui?.sound?.enabled ?? true,
          volume: prev.ui?.sound?.volume ?? 0.25,
          backgroundOnly: prev.ui?.sound?.backgroundOnly ?? true,
          ...patch,
        },
      },
    }));
  };

  return (
    <div className="max-w-2xl mx-auto py-6 px-6">
      <h2 className="text-lg font-semibold mb-1">基础设置</h2>
      <p className="text-sm text-muted-foreground mb-6">配置 Agent 的思考模式、执行力度和权限策略</p>
      <div className="space-y-6">
        {/* Effort 级别 */}
        <div className="space-y-2">
          <label className="text-sm font-medium">执行力度（effort）</label>
          <p className="text-xs text-muted-foreground">
            「默认」由模型自决思考深度；「关闭」不产生思考；其余级别控制思考投入程度。
          </p>
          <div className="inline-flex h-10 items-center justify-center rounded-md bg-muted p-1">
            {EFFORT_OPTIONS.map(opt => (
              <button key={String(opt.value)}
                className={cn(
                  'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-4 py-1.5 text-sm font-medium transition-all',
                  (local.ai.effort ?? null) === opt.value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                onClick={() => updateAI({ effort: opt.value })}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 默认模型 */}
        <div className="space-y-2">
          <label className="text-sm font-medium">默认模型</label>
          <p className="text-xs text-muted-foreground">
            新建对话将使用此模型；选「不指定」时新对话需手动选择模型才能发送消息。
            此处的修改仅影响之后新建的对话，不会改动已存在对话的模型设置。
          </p>
          <ModelSelector
            settings={local}
            value={local.ai.defaultModelSelection}
            onChange={(v) => updateAI({ defaultModelSelection: v })}
            allowUnset={true}
            triggerVariant="block"
          />
        </div>

        {/* 文章解析模型 */}
        <div className="space-y-2">
          <label className="text-sm font-medium">文章解析模型</label>
          <p className="text-xs text-muted-foreground">
            文章导入固定解析不达标时的 AI 兑底任务使用此模型，适合配置便宜档；选「不指定」时回退到默认模型。
          </p>
          <ModelSelector
            settings={local}
            value={local.ai.parseModelSelection}
            onChange={(v) => updateAI({ parseModelSelection: v })}
            allowUnset={true}
            triggerVariant="block"
          />
        </div>

        {/* 话题状态提炼模型 */}
        <div className="space-y-2">
          <label className="text-sm font-medium">话题状态提炼模型</label>
          <p className="text-xs text-muted-foreground">
            会话中同步提炼话题状态卡的后台任务使用此模型，运行频繁，适合配置便宜档；选「不指定」时回退到默认模型。
          </p>
          <ModelSelector
            settings={local}
            value={local.ai.stateModelSelection}
            onChange={(v) => updateAI({ stateModelSelection: v })}
            allowUnset={true}
            triggerVariant="block"
          />
        </div>

        {/* 默认权限模式 */}
        <div className="space-y-3">
          <label className="text-sm font-medium">默认权限模式</label>
          <div className="space-y-2">
            {PERMISSION_MODE_OPTIONS.map(opt => (
              <label key={opt.value} className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                <input type="radio" name="permissionMode" className="mt-0.5"
                  checked={local.ai.permissionMode === opt.value}
                  onChange={() => updateAI({ permissionMode: opt.value })}
                />
                <div>
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-xs text-muted-foreground">{opt.description}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
        {/* 消息显示模式 */}
        <div className="space-y-3">
          <label className="text-sm font-medium">消息显示模式</label>
          <p className="text-xs text-muted-foreground">控制工具调用和思考过程的默认展开态</p>
          <div className="space-y-2">
            <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
              <input
                type="radio"
                name="messageDisplayMode"
                className="mt-0.5"
                checked={(local.ui?.messageDisplayMode ?? 'compact') === 'compact'}
                onChange={() => updateUI({ messageDisplayMode: 'compact' })}
              />
              <div>
                <div className="text-sm font-medium">简化（推荐）</div>
                <div className="text-xs text-muted-foreground">工具调用和思考块默认折叠，只显示标题</div>
              </div>
            </label>
            <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
              <input
                type="radio"
                name="messageDisplayMode"
                className="mt-0.5"
                checked={local.ui?.messageDisplayMode === 'detailed'}
                onChange={() => updateUI({ messageDisplayMode: 'detailed' })}
              />
              <div>
                <div className="text-sm font-medium">详细</div>
                <div className="text-xs text-muted-foreground">工具调用和思考块默认展开，显示完整输入/输出</div>
              </div>
            </label>
          </div>
        </div>

        {/* 界面大小 */}
        <div className="space-y-2">
          <label className="text-sm font-medium">界面大小</label>
          <p className="text-xs text-muted-foreground">
            全局缩放文字、图标和间距（图表与终端字号不变），对所有窗口生效；默认为「中」。
          </p>
          <div className="inline-flex h-10 items-center justify-center rounded-md bg-muted p-1">
            {FONT_SIZE_OPTIONS.map(opt => (
              <button key={opt.value}
                className={cn(
                  'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-4 py-1.5 text-sm font-medium transition-all',
                  (local.ui?.fontSize ?? 'medium') === opt.value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                onClick={() => updateUI({ fontSize: opt.value })}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Dogear 提示音 */}
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <label className="text-sm font-medium flex items-center gap-2">
                <Volume2 className="w-4 h-4" />
                Dogear 提示音
              </label>
              <p className="text-xs text-muted-foreground mt-1">
                使用应用内合成音效，不调用 Windows 通知或系统提示音。主会话完成、任务完成/失败、等待授权时触发；仅应用后台时响（可关）。
              </p>
            </div>
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={local.ui?.sound?.enabled ?? true}
              onChange={(e) => updateSound({ enabled: e.target.checked })}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 pl-0">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={local.ui?.sound?.backgroundOnly ?? true}
                onChange={(e) => updateSound({ backgroundOnly: e.target.checked })}
              />
              仅当 Dogear 不在前台时播放
            </label>
            <label className="flex items-center gap-2 text-sm">
              音量
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                className="w-28"
                value={Math.round((local.ui?.sound?.volume ?? 0.25) * 100)}
                onChange={(e) => updateSound({ volume: Number(e.target.value) / 100 })}
              />
              <span className="w-9 text-xs text-muted-foreground">{Math.round((local.ui?.sound?.volume ?? 0.25) * 100)}%</span>
            </label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => playDogearSound('complete', { force: true, volume: local.ui?.sound?.volume })}
              disabled={(local.ui?.sound?.enabled ?? true) === false}
            >
              试听
            </Button>
          </div>
        </div>

        {/* 主题 */}
        <div className="space-y-3">
          <label className="text-sm font-medium">主题</label>
          <p className="text-xs text-muted-foreground">切换亮/暗配色，保存后立即应用到所有窗口；默认为「亮色」。</p>
          <div className="space-y-2">
            {THEME_OPTIONS.map(opt => (
              <label key={opt.value} className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                <input type="radio" name="appearanceTheme" className="mt-0.5"
                  checked={(local.appearance?.theme ?? 'light') === opt.value}
                  onChange={() => updateAppearance({ theme: opt.value })}
                />
                <div>
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-xs text-muted-foreground">{opt.description}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* 浏览器 */}
        <div className="space-y-3">
          <label className="text-sm font-medium">浏览器</label>
          <p className="text-xs text-muted-foreground">
            Agent 内嵌浏览器工具（读文章 / 网页搜索）共用的代理与搜索引擎配置。
          </p>
          <div className="space-y-4 rounded-lg border p-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">代理地址</label>
              <p className="text-xs text-muted-foreground">
                仅 Google / DuckDuckGo 搜索请求经此代理分流，读文章与 Bing 直连不受影响；
                留空 = 禁用代理引擎，搜索仅使用 Bing。
              </p>
              <input
                type="text"
                className={inputCls}
                value={local.browserProxyServer ?? ''}
                onChange={(e) => setLocal(prev => ({ ...prev, browserProxyServer: e.target.value }))}
                placeholder="127.0.0.1:7890"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">默认搜索引擎</label>
              <p className="text-xs text-muted-foreground">
                auto = 代理可用时用 Google，不可用时自动改用 Bing；搜索失败时按 Google → DuckDuckGo → Bing 自动降级。
              </p>
              <select
                className="h-9 w-full px-3 text-sm border rounded bg-background"
                value={local.browserSearchEngine}
                onChange={(e) => setLocal(prev => ({
                  ...prev,
                  browserSearchEngine: e.target.value as AppSettings['browserSearchEngine'],
                }))}
              >
                <option value="auto">auto（智能选择）</option>
                <option value="google">Google</option>
                <option value="bing">Bing</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">浏览器扩展</label>
              <p className="text-xs text-muted-foreground">
                连接后 Dogear 可读取扩展所在浏览器当前标签页的标题、网址与正文预览。
              </p>
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
        </div>

        <PaymentBlockedHostsSection local={local} setLocal={setLocal} />

        <WebAiSitesSection local={local} setLocal={setLocal} />

        {/* 联网搜索（GLM MCP） */}
        <div className="space-y-3">
          <label className="text-sm font-medium">联网搜索（GLM MCP）</label>
          <p className="text-xs text-muted-foreground">
            能力页「联网搜索」工具包（bigmodel__webSearch / bigmodel__webReader）的 API Key，
            在智谱个人编程套餐 → 套餐概览页创建；消耗套餐专属 MCP 额度。
          </p>
          <div className="space-y-1.5 rounded-lg border p-4">
            <label className="text-sm font-medium">GLM Coding Plan API Key</label>
            <p className="text-xs text-muted-foreground">
              留空时开启工具包也会因缺 Key 在调用时返回提示（不会崩溃）。
            </p>
            <input
              type="password"
              className={inputCls}
              value={local.webMcpApiKey ?? ''}
              onChange={(e) => setLocal(prev => ({ ...prev, webMcpApiKey: e.target.value }))}
              placeholder="GLM Coding Plan API Key"
              autoComplete="off"
            />
          </div>
        </div>

        {/* 通用级 agent.md：唯一编辑入口在能力页「全局规则」包详情 */}
        <div className="space-y-2">
          <label className="text-sm font-medium">通用级 Agent 指令</label>
          <p className="text-xs text-muted-foreground">
            位于 <code className="text-[0.9em] bg-muted px-1 py-0.5 rounded">.dogear/agent.md</code>，
            对所有工作区生效。在「能力」页选择「全局规则」包进行编辑。
          </p>
        </div>
      </div>
    </div>
  );
}
