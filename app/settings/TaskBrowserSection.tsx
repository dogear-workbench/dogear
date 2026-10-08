/**
 * 设置页「任务浏览器」区块：扩展通道断连时自动拉起的浏览器与账户
 */
import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import type { AppSettings } from '@/types/settings';
import type { TaskBrowserId } from '@/electron/main/services/settings-types';

type ListTaskBrowsersResult = Awaited<ReturnType<typeof client.listTaskBrowsers>>;

interface TaskBrowserSectionProps {
  local: AppSettings;
  setLocal: Dispatch<SetStateAction<AppSettings>>;
}

export function TaskBrowserSection({ local, setLocal }: TaskBrowserSectionProps) {
  const [browsers, setBrowsers] = useState<ListTaskBrowsersResult['browsers'] | null>(null);

  useEffect(() => {
    let cancelled = false;
    client.listTaskBrowsers().then((res) => {
      if (cancelled) return;
      setBrowsers(res.browsers);
      if (res.cleared) {
        toast.warning('已配置的任务浏览器账户不存在，已清除，请重新选择');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const current = local.taskBrowser ?? null;
  const installed = browsers ?? [];
  const selected = current?.browser ?? '';
  const profiles = installed.find((b) => b.browser === selected)?.profiles ?? [];
  const selectedProfile = profiles.find((p) => p.directory === current?.profileDirectory);

  const selectBrowser = (value: string) => {
    if (value === '') {
      setLocal((prev) => ({ ...prev, taskBrowser: undefined }));
      return;
    }
    const browserId = value as TaskBrowserId;
    const first = installed.find((b) => b.browser === browserId)?.profiles[0];
    setLocal((prev) => ({
      ...prev,
      taskBrowser: first
        ? { browser: browserId, profileDirectory: first.directory, profileName: first.name }
        : undefined,
    }));
  };

  const selectProfile = (directory: string) => {
    const profile = profiles.find((p) => p.directory === directory);
    if (!profile || current === null) return;
    setLocal((prev) => ({
      ...prev,
      taskBrowser: { browser: current.browser, profileDirectory: profile.directory, profileName: profile.name },
    }));
  };

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">任务浏览器</label>
      <p className="text-xs text-muted-foreground">
        扩展通道不可用（浏览器未启动或扩展休眠）时自动拉起此浏览器与账户继续任务；不配置则失败时仅提示。
        账户列表来自浏览器本机数据，是否已装扩展无法探测，装了扩展的账户拉起后即可自动连接。
      </p>
      {browsers === null ? (
        <p className="text-xs text-muted-foreground">正在检测已安装的浏览器...</p>
      ) : installed.length === 0 ? (
        <p className="text-xs text-muted-foreground">未检测到已安装的 Chrome 或 Edge，请先安装其一再配置。</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <select
            className="h-9 w-full px-3 text-sm border rounded bg-background"
            value={selected}
            onChange={(e) => selectBrowser(e.target.value)}
          >
            <option value="">不配置</option>
            {installed.map((b) => (
              <option key={b.browser} value={b.browser}>
                {b.name}
              </option>
            ))}
          </select>
          <select
            className="h-9 w-full px-3 text-sm border rounded bg-background disabled:opacity-50"
            value={selectedProfile?.directory ?? ''}
            disabled={selected === '' || profiles.length === 0}
            onChange={(e) => selectProfile(e.target.value)}
          >
            {profiles.length === 0 ? (
              <option value="">无可用账户</option>
            ) : (
              profiles.map((p) => (
                <option key={p.directory} value={p.directory}>
                  {p.name}
                </option>
              ))
            )}
          </select>
        </div>
      )}
    </div>
  );
}
