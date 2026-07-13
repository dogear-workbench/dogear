import type { AppSettings } from '@/types/settings';
import { ModelSelector } from '@/components/ModelSelector';

interface SubAgentTabProps {
  local: AppSettings;
  setLocal: (updater: (prev: AppSettings) => AppSettings) => void;
}

const SUB_AGENT_PERMISSION_OPTIONS = [
  { value: 'bypassPermissions', label: '自动执行（推荐）', description: '⚡ 跳过权限检查，子会话全自动跑完。适合被信任的派遣任务。' },
  { value: 'acceptEdits',       label: '自动编辑',         description: '文件编辑/Bash 文件系统命令自动通过，其余需要在子会话 tab 内确认。' },
  { value: 'default',           label: '标准',             description: '危险操作都要用户确认（在子会话 tab 内）。会拖慢派遣节奏。' },
] as const;

const CACHE_POLICY_OPTIONS = [
  { value: '5m', label: '5 分钟（推荐）', description: '缓存写入费用低。子会话通常一轮跑完就结束，5m 完全够用。' },
  { value: '1h', label: '1 小时',         description: '写入费用是 5m 的 1.6 倍。仅在你的派遣流程会跨很久（>10 分钟）多轮复用子会话时选。' },
] as const;

const CONTEXT_MOUNT_OPTIONS = [
  {
    key: 'loadCoreProfile' as const,
    label: '注入工作区用户画像',
    description: '让子会话读到 .dogear/memory/core-profile.md 里的用户偏好。执行类任务通常用不到，占 5-15K tokens。',
  },
  {
    key: 'loadSkills' as const,
    label: '加载 .claude/skills',
    description: 'brainstorming / staged-impl / doc-sync 等流程 skill。执行器只干活不做规划，通常不需要。',
  },
  {
    key: 'loadArticleParse' as const,
    label: '挂载 dogear-article-parse',
    description: '网络文章解析工具集。只有让子会话去抓/解析文章时才需要。',
  },
];

const MIN_TIMEOUT = 1;
const MAX_TIMEOUT = 180;

function clampTimeout(n: number): number {
  if (!Number.isFinite(n)) return 30;
  return Math.min(MAX_TIMEOUT, Math.max(MIN_TIMEOUT, Math.round(n)));
}

export function SubAgentTab({ local, setLocal }: SubAgentTabProps) {
  const sub = local.subAgent;

  const updateSub = (patch: Partial<AppSettings['subAgent']>) => {
    setLocal((prev) => ({
      ...prev,
      subAgent: { ...prev.subAgent, ...patch },
    }));
  };

  return (
    <div className="max-w-2xl py-6 px-6">
      <h2 className="text-lg font-semibold mb-1">子会话派遣</h2>
      <p className="text-sm text-muted-foreground mb-6">
        当 Agent 调 CreateSession / CreateSessionBatch 派出独立子会话时的默认行为。下列配置只在「派遣时」生效，单次派遣的工具调用不可覆盖。
      </p>

      <div className="space-y-6">
        {/* 默认模型 */}
        <div className="space-y-2">
          <label className="text-sm font-medium">默认模型</label>
          <p className="text-xs text-muted-foreground">
            子会话拉起时使用的模型。「不指定」时回退到上级 AI 行为里的「默认模型」。父对话级 modelSelection 优先级最高。
          </p>
          <ModelSelector
            settings={local}
            value={sub.modelSelection ?? null}
            onChange={(v) => updateSub({ modelSelection: v })}
            allowUnset={true}
            triggerVariant="block"
          />
        </div>

        {/* 权限模式 */}
        <div className="space-y-3">
          <label className="text-sm font-medium">默认权限模式</label>
          <div className="space-y-2">
            {SUB_AGENT_PERMISSION_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors"
              >
                <input
                  type="radio"
                  name="subAgentPermissionMode"
                  className="mt-0.5"
                  checked={(sub.permissionMode ?? 'bypassPermissions') === opt.value}
                  onChange={() => updateSub({ permissionMode: opt.value })}
                />
                <div>
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-xs text-muted-foreground">{opt.description}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* 超时分钟数 */}
        <div className="space-y-2">
          <label className="text-sm font-medium">超时（分钟）</label>
          <p className="text-xs text-muted-foreground">
            单个子会话允许独立运行的最长时间。超时会被强制 abort，状态变为 timeout。Agent 调 WaitForMessage 时可传 timeoutMs 显式覆盖此默认值。范围 {MIN_TIMEOUT}–{MAX_TIMEOUT}。
          </p>
          <input
            type="number"
            min={MIN_TIMEOUT}
            max={MAX_TIMEOUT}
            step={1}
            className="h-9 w-32 px-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            value={sub.timeoutMinutes}
            onChange={(e) => {
              const raw = e.target.value.trim();
              if (raw === '') return;
              updateSub({ timeoutMinutes: clampTimeout(Number(raw)) });
            }}
            onBlur={(e) => {
              updateSub({ timeoutMinutes: clampTimeout(Number(e.target.value)) });
            }}
          />
        </div>

        {/* 缓存策略 */}
        <div className="space-y-3">
          <label className="text-sm font-medium">缓存策略</label>
          <p className="text-xs text-muted-foreground">
            子会话启动时的 prompt cache TTL。1h 写入费用是 5m 的约 1.6 倍，而子会话通常单轮跑完就结束、多余的 TTL 是浪费。
          </p>
          <div className="space-y-2">
            {CACHE_POLICY_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors"
              >
                <input
                  type="radio"
                  name="subAgentCachePolicy"
                  className="mt-0.5"
                  checked={(sub.cachePolicy ?? '5m') === opt.value}
                  onChange={() => updateSub({ cachePolicy: opt.value })}
                />
                <div>
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-xs text-muted-foreground">{opt.description}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* 上下文挂载 */}
        <div className="space-y-3">
          <label className="text-sm font-medium">上下文挂载</label>
          <p className="text-xs text-muted-foreground">
            子会话默认精简，只挂交付/共享区/引用等核心工具。以下项按需勾选，勾越少子会话 baseline 越小、cache 命中率越高。核心的 dogear-group / dogear-delegation / dogear-reference 不在此列，始终挂载。
          </p>
          <div className="space-y-2">
            {CONTEXT_MOUNT_OPTIONS.map((opt) => (
              <label
                key={opt.key}
                className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors"
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={sub[opt.key] === true}
                  onChange={(e) => updateSub({ [opt.key]: e.target.checked })}
                />
                <div>
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-xs text-muted-foreground">{opt.description}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
