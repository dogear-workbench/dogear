import { toast } from 'sonner';
import { playDogearSound } from '@/lib/dogear-sound';

export function formatDurationMs(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours} 小时 ${remMinutes} 分` : `${hours} 小时`;
}

export function setupManualTaskToasts() {
  import('@/lib/events').then(({ rendererEvents }) => {
    rendererEvents.manualTaskDone.listen((p) => {
      if (p.status === 'failed') {
        playDogearSound('error');
        toast.error(`${p.planName}失败`, { description: p.error ?? '未知错误' });
        return;
      }
      if (p.status === 'cancelled') {
        toast.info(`${p.planName}已取消`);
        return;
      }
      toast.success(`${p.planName}完成，耗时 ${formatDurationMs(p.durationMs)}`, {
        description: p.summary,
      });
      playDogearSound('complete');
    });
  });
}
