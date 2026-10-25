// electron/main/tipc/settings.ts
import { tipc } from '@egoist/tipc/main';
import { loadSettings, saveSettings } from '../services/settings-service.js';
import type { AppSettings } from '../services/settings-service.js';
import { diffSettings, hasSnapshotChange } from '../services/settings-diff.js';
import { getPiSessionManager } from '../agents/pi-session/pi-session-manager.js';

const t = tipc.create();

export const settingsRouter = {
  /**
   * 获取应用设置
   */
  getSettings: t.procedure
    .action(async () => {
      try {
        const settings = await loadSettings();
        return { settings };
      } catch (error) {
        console.error('获取设置失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 更新应用设置：落盘后 diff 新旧设置分层生效——
   * 纯 UI/按次读取域仅广播 settingsChanged（渲染层刷 store 热更）；
   * agent 启动快照域由 PiSessionManager 对受影响会话标脏（permissionMode 热更），
   * 各会话在下轮 sendMessage 前自行重建，不再无差别杀会话
   */
  updateSettings: t.procedure
    .input<{ settings: AppSettings }>()
    .action(async ({ input }) => {
      try {
        const prev = await loadSettings();
        await saveSettings(input.settings);
        getPiSessionManager().invalidateAliveWindowCache();
        const diff = diffSettings(prev, input.settings);
        if (hasSnapshotChange(diff)) {
          getPiSessionManager().applySettingsSnapshotDiff(diff, input.settings);
        }
        const { broadcastSettingsChanged } = await import('../main-app.js');
        broadcastSettingsChanged();
        return { success: true };
      } catch (error) {
        console.error('更新设置失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 从上游拉取可用模型列表（通用：anthropic-messages 走 {baseUrl}/v1/models，openai 系走 {baseUrl}/models）。
   * 只做探测不落盘，勾选后的合并由前端写回 settings。
   */
  fetchUpstreamModels: t.procedure
    .input<{ baseUrl: string; apiKey: string; piWireApi: string }>()
    .action(async ({ input }) => fetchUpstreamModelList(input.baseUrl, input.apiKey, input.piWireApi)),
};

type UpstreamModelListResult =
  | { ok: true; models: Array<{ id: string; label?: string }> }
  | { ok: false; error: string };

async function fetchUpstreamModelList(
  baseUrl: string,
  apiKey: string,
  piWireApi: string,
): Promise<UpstreamModelListResult> {
  const base = baseUrl.trim().replace(/\/+$/, '');
  const isAnthropic = piWireApi === 'anthropic-messages';
  const url = isAnthropic
    ? `${base.endsWith('/v1') ? base : `${base}/v1`}/models?limit=1000`
    : `${base}/models`;
  const headers: Record<string, string> = isAnthropic
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    : { Authorization: `Bearer ${apiKey}` };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `上游返回 HTTP ${res.status}${body ? `：${body.slice(0, 200)}` : ''}` };
    }
    const json = (await res.json()) as { data?: Array<{ id?: unknown; display_name?: unknown }> };
    const models = (json.data ?? [])
      .filter((m): m is { id: string; display_name?: string } => typeof m?.id === 'string' && m.id.length > 0)
      .map((m) => ({ id: m.id, ...(typeof m.display_name === 'string' && m.display_name ? { label: m.display_name } : {}) }))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (models.length === 0) return { ok: false, error: '上游未返回任何模型' };
    return { ok: true, models };
  } catch (err) {
    const message = err instanceof Error && err.name === 'AbortError'
      ? '请求超时（15s）'
      : err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
