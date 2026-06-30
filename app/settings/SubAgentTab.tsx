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
        当 Agent 调 DelegateTo / DelegateBatch 派出独立子会话时的默认行为。下列配置只在「派遣时」生效，单次派遣的工具调用不可覆盖。
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
            单个子会话允许独立运行的最长时间。超时会被强制 abort 且 WaitForDeliveries 收到 status:timeout。Agent 调 WaitForDeliveries 时可传 timeoutMs 显式覆盖此默认值。范围 {MIN_TIMEOUT}–{MAX_TIMEOUT}。
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
      </div>
    </div>
  );
}
